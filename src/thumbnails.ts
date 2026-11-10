import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Small previews of the last session, kept only on this computer with private file modes. */
export class Thumbnails {
  private readonly directory: string;
  constructor(userData: string) { this.directory = join(userData, 'thumbnails'); }
  private file(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw Error('invalid thumbnail id');
    return join(this.directory, `${id}.jpg`);
  }
  /** Modification time, used by the UI as a cache key; 0 when there is no preview. */
  stamp(id: string) {
    try { return Math.round(statSync(this.file(id)).mtimeMs); } catch { return 0; }
  }
  write(id: string, jpeg: Buffer) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    writeFileSync(this.file(id), jpeg, { mode: 0o600 });
  }
  dataURL(id: string) {
    const file = this.file(id);
    return existsSync(file) ? `data:image/jpeg;base64,${readFileSync(file).toString('base64')}` : '';
  }
  remove(id: string) { rmSync(this.file(id), { force: true }); }
  clear() { rmSync(this.directory, { recursive: true, force: true }); }
}
