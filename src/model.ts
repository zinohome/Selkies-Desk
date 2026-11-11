import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ballSchema, defaultBall, defaultLayout, layoutSchema, type Ball, type Layout } from './layout';
import { t } from './i18n';
import { commands } from './platform';
import { videoEncoders } from './video';

const httpURL = z.string().trim().max(2048).transform((value, context) => {
  try {
    const parsed = new URL(value.includes('://') ? value : `https://${value}`);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) throw Error();
    return parsed.href;
  } catch {
    context.addIssue({ code: 'custom', message: t('model.url') });
    return z.NEVER;
  }
});

export const connectionSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(80),
  url: httpURL,
  group: z.string().trim().max(60).default(''),
  notes: z.string().max(1000).default(''),
  username: z.string().trim().max(200).default(''),
  fullscreen: z.boolean().default(false),
  autoConnect: z.boolean().default(false)
}).strict();

export type Connection = z.output<typeof connectionSchema> & { id: string };
export const connectionID = z.uuid();
const importSchema = z.object({
  version: z.literal(1),
  connections: z.array(connectionSchema).max(200)
}).strict();
const languageSetting = z.enum(['system', 'zh', 'en']);
const themeSetting = z.enum(['system', 'light', 'dark']);
export const settingsSchema = z.object({
  language: languageSetting.default('system'),
  theme: themeSetting.default('system'),
  autoFocus: z.boolean().default(true),
  autoReconnect: z.boolean().default(true),
  /** How many times a lost connection is retried before giving up. */
  retryCount: z.number().int().min(1).max(20).default(6),
  /** Seconds to wait for the server to answer before a connection attempt counts as failed. */
  connectTimeout: z.number().int().min(3).max(120).default(20),
  thumbnails: z.boolean().default(true),
  passSystemKeys: z.boolean().default(false),
  /** Video settings applied to every connection when it starts. */
  videoApply: z.boolean().default(true),
  videoEncoder: z.enum(videoEncoders).default('h264enc'),
  videoFramerate: z.number().int().min(10).max(240).default(45),
  videoRateControl: z.enum(['cbr', 'crf']).default('cbr'),
  /** Megabits per second, used with constant bitrate. */
  videoBitrate: z.number().int().min(1).max(200).default(15),
  /** auto: find and download new versions, then ask to restart. notify: only tell. off: never look. */
  updateMode: z.enum(['auto', 'notify', 'off']).default('auto'),
  shortcuts: z.partialRecord(z.enum(commands), z.string().max(60)).default({})
}).strict();
export type Settings = z.infer<typeof settingsSchema>;
// A patch carries only the fields the user changed. It is declared without defaults on purpose:
// defaults inside optional fields would be filled in and silently reset every other setting.
export const settingsPatchSchema = z.object({
  language: languageSetting.optional(),
  theme: themeSetting.optional(),
  autoFocus: z.boolean().optional(),
  autoReconnect: z.boolean().optional(),
  retryCount: z.number().int().min(1).max(20).optional(),
  connectTimeout: z.number().int().min(3).max(120).optional(),
  thumbnails: z.boolean().optional(),
  passSystemKeys: z.boolean().optional(),
  videoApply: z.boolean().optional(),
  videoEncoder: z.enum(videoEncoders).optional(),
  videoFramerate: z.number().int().min(10).max(240).optional(),
  videoRateControl: z.enum(['cbr', 'crf']).optional(),
  videoBitrate: z.number().int().min(1).max(200).optional(),
  updateMode: z.enum(['auto', 'notify', 'off']).optional()
}).strict();
const stateSchema = z.object({
  version: z.literal(1),
  connections: z.array(connectionSchema.extend({ id: z.uuid() })).max(200),
  certificates: z.record(z.string(), z.object({ origin: z.string(), fingerprint: z.string() }).strict()).default({}),
  layout: layoutSchema.default(defaultLayout),
  ball: ballSchema.optional(),
  settings: settingsSchema.optional(),
  window: z.object({
    width: z.number().int().min(900).max(10000),
    height: z.number().int().min(620).max(10000)
  }).optional()
}).strict();
type State = z.infer<typeof stateSchema>;

export function parseConnection(value: unknown) { return connectionSchema.parse(value); }
export function parseImport(text: string) {
  if (Buffer.byteLength(text) > 1024 * 1024) throw Error(t('import.tooLarge'));
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
    if (new Set(this.state.connections.map(connection => connection.id)).size !== this.state.connections.length) throw Error(t('model.duplicateID'));
  }
  get connections(): Connection[] { return this.state.connections.map(connection => ({ ...connection })); }
  get window() { return this.state.window; }
  get layout() { return { ...this.state.layout }; }
  get settings(): Settings { return settingsSchema.parse(this.state.settings ?? {}); }
  setSettings(patch: Partial<Settings>) {
    this.state.settings = settingsSchema.parse({ ...this.settings, ...patch });
    this.flush();
  }
  get ball(): Ball { return { ...(this.state.ball ?? defaultBall) }; }
  setBall(ball: Ball) {
    this.state.ball = ballSchema.parse(ball);
    this.flush();
  }
  setLayout(layout: Layout) {
    this.state.layout = layoutSchema.parse(layout);
    this.flush();
  }
  get(id: string) {
    const connection = this.connections.find(connection => connection.id === id);
    if (!connection) throw Error(t('model.missing'));
    return connection;
  }
  save(value: unknown): Connection {
    const parsed = parseConnection(value);
    const index = this.state.connections.findIndex(connection => connection.id === parsed.id);
    if (parsed.id && index < 0) throw Error(t('model.updateMissing'));
    if (index < 0 && this.state.connections.length >= 200) throw Error(t('model.limit'));
    const connection = { ...parsed, id: parsed.id || randomUUID() };
    if (index >= 0) {
      if (!matchesOrigin(connection.url, this.state.connections[index].url)) delete this.state.certificates[connection.id];
      this.state.connections[index] = connection;
    } else this.state.connections.push(connection);
    // Only one desktop is active at a time, so only one connection can start with the app.
    if (connection.autoConnect) for (const other of this.state.connections) if (other.id !== connection.id) other.autoConnect = false;
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
    if (data.connections.length + this.connections.length > 200) throw Error(t('model.importLimit'));
    const names = new Set(this.connections.map(connection => connection.name));
    const added: Connection[] = [];
    for (const entry of data.connections) {
      let name = entry.name;
      let suffix = 2;
      while (names.has(name)) name = `${entry.name.slice(0, 64)}${t('model.importSuffix', { n: suffix++ })}`;
      names.add(name);
      added.push({ ...entry, id: randomUUID(), name, autoConnect: false });
    }
    this.state.connections.push(...added);
    this.flush();
    return added;
  }
  trust(id: string, origin: string, fingerprint: string) {
    if (!matchesOrigin(origin, this.get(id).url)) throw Error(t('model.certOrigin'));
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
