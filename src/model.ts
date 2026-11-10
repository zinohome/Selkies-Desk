import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { defaultLayout, layoutSchema, type Layout } from './layout';

const httpURL = z.string().trim().max(2048).transform((value, context) => {
  try {
    const parsed = new URL(value.includes('://') ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) throw Error();
    return parsed.href;
  } catch {
    context.addIssue({ code: 'custom', message: '地址须为 HTTP(S)，不能含用户名、密码、查询参数或片段。' });
    return z.NEVER;
  }
});

export const connectionSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(80),
  url: httpURL,
  group: z.string().trim().max(60).default(''),
  notes: z.string().max(1000).default(''),
  username: z.string().trim().max(200).default('')
}).strict();

export type Connection = z.output<typeof connectionSchema> & { id: string };
export const connectionID = z.uuid();
const importSchema = z.object({
  version: z.literal(1),
  connections: z.array(connectionSchema).max(200)
}).strict();
const stateSchema = z.object({
  version: z.literal(1),
  connections: z.array(connectionSchema.extend({ id: z.uuid() })).max(200),
  certificates: z.record(z.string(), z.object({ origin: z.string(), fingerprint: z.string() }).strict()).default({}),
  layout: layoutSchema.default(defaultLayout),
  window: z.object({
    width: z.number().int().min(900).max(10000),
    height: z.number().int().min(620).max(10000)
  }).optional()
}).strict();
type State = z.infer<typeof stateSchema>;

export function parseConnection(value: unknown) { return connectionSchema.parse(value); }
export function parseImport(text: string) {
  if (Buffer.byteLength(text) > 1024 * 1024) throw Error('配置文件不能大于 1 MB。');
  return importSchema.parse(JSON.parse(text));
}
export function matchesOrigin(candidate: string, configured: string) {
  try {
    const first = new URL(candidate);
    const second = new URL(configured);
    return ['http:', 'https:'].includes(first.protocol) && first.origin === second.origin && !first.username && !first.password;
  } catch { return false; }
}
export function matchesNetworkOrigin(candidate: string, configured: string) {
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
    else if (parsed.protocol === 'wss:') parsed.protocol = 'https:';
    return matchesOrigin(parsed.href, configured);
  } catch { return false; }
}
export function writePrivateJSON(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(temporary, file);
}
export class Store {
  private state: State;
  readonly file: string;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = join(directory, 'connections.json');
    this.state = existsSync(this.file)
      ? stateSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')))
      : { version: 1, connections: [], certificates: {}, layout: { ...defaultLayout } };
    if (new Set(this.state.connections.map(connection => connection.id)).size !== this.state.connections.length) throw Error('配置中存在重复连接 ID，请恢复备份。');
  }
  get connections(): Connection[] { return this.state.connections.map(connection => ({ ...connection })); }
  get window() { return this.state.window; }
  get layout() { return { ...this.state.layout }; }
  setLayout(layout: Layout) {
    this.state.layout = layoutSchema.parse(layout);
    this.flush();
  }
  get(id: string) {
    const connection = this.connections.find(connection => connection.id === id);
    if (!connection) throw Error('连接不存在，可能已被删除。');
    return connection;
  }
  save(value: unknown): Connection {
    const parsed = parseConnection(value);
    const index = this.state.connections.findIndex(connection => connection.id === parsed.id);
    if (parsed.id && index < 0) throw Error('不能更新不存在的连接。');
    if (index < 0 && this.state.connections.length >= 200) throw Error('最多保存 200 个连接。');
    const connection = { ...parsed, id: parsed.id || randomUUID() };
    if (index >= 0) {
      if (!matchesOrigin(connection.url, this.state.connections[index].url)) delete this.state.certificates[connection.id];
      this.state.connections[index] = connection;
    } else this.state.connections.push(connection);
    this.flush();
    return connection;
  }
  delete(id: string) {
    this.get(id);
    this.state.connections = this.state.connections.filter(connection => connection.id !== id);
    delete this.state.certificates[id];
    this.flush();
  }
  export() {
    return JSON.stringify({ version: 1, connections: this.connections }, null, 2);
  }
  import(data: ReturnType<typeof parseImport>) {
    if (data.connections.length + this.connections.length > 200) throw Error('导入后将超过 200 个连接。');
    const names = new Set(this.connections.map(connection => connection.name));
    const added: Connection[] = [];
    for (const entry of data.connections) {
      let name = entry.name;
      let suffix = 2;
      while (names.has(name)) name = `${entry.name.slice(0, 64)}（导入 ${suffix++}）`;
      names.add(name);
      added.push({ ...entry, id: randomUUID(), name });
    }
    this.state.connections.push(...added);
    this.flush();
    return added;
  }
  trust(id: string, origin: string, fingerprint: string) {
    if (!matchesOrigin(origin, this.get(id).url)) throw Error('证书来源不匹配。');
    this.state.certificates[id] = { origin, fingerprint };
    this.flush();
  }
  certificate(id: string) { return this.state.certificates[id]; }
  revoke(id: string) {
    delete this.state.certificates[id];
    this.flush();
  }
  setWindow(width: number, height: number) {
    this.state.window = { width, height };
    this.flush();
  }
  private flush() { writePrivateJSON(this.file, this.state); }
}
export function trustedCertificate(store: Store, id: string, origin: string, fingerprint: string) {
  const trust = store.certificate(id);
  return trust?.origin === origin && trust.fingerprint === fingerprint;
}
