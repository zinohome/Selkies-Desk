import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { type Connection, writePrivateJSON } from './model';

type Cipher = {
  isAsyncEncryptionAvailable: () => Promise<boolean>;
  encryptStringAsync: (text: string) => Promise<Buffer>;
  decryptStringAsync: (buffer: Buffer) => Promise<{ result: string; shouldReEncrypt: boolean }>;
};
const credentialSchema = z.object({ origin: z.string(), username: z.string(), password: z.string() }).strict();
export type Credential = z.infer<typeof credentialSchema>;

export class Vault {
  private encrypted: Record<string, string>;
  private memory = new Map<string, Credential>();
  private revisions = new Map<string, number>();
  private readonly file: string;
  constructor(directory: string, private cipher: Cipher) {
    this.file = join(directory, 'credentials.enc.json');
    this.encrypted = existsSync(this.file)
      ? z.record(z.string(), z.string()).parse(JSON.parse(readFileSync(this.file, 'utf8')))
      : {};
  }
  hasSaved(id: string) { return !!this.encrypted[id]; }
  async available() {
    try { return await this.cipher.isAsyncEncryptionAvailable(); } catch { return false; }
  }
  async get(connection: Connection): Promise<Credential | undefined> {
    const revision = this.revisions.get(connection.id) || 0;
    let credential = this.memory.get(connection.id);
    if (!credential && this.encrypted[connection.id]) {
      try {
        const decrypted = await this.cipher.decryptStringAsync(Buffer.from(this.encrypted[connection.id], 'base64'));
        credential = credentialSchema.parse(JSON.parse(decrypted.result));
        if (decrypted.shouldReEncrypt) {
          const rotated = await this.cipher.encryptStringAsync(decrypted.result);
          if ((this.revisions.get(connection.id) || 0) === revision) {
            this.encrypted[connection.id] = rotated.toString('base64');
            this.flush();
          }
        }
      } catch { return undefined; }
    }
    if ((this.revisions.get(connection.id) || 0) === revision && credential?.origin === new URL(connection.url).origin && credential.username === connection.username) return credential;
    return undefined;
  }
  async set(connection: Connection, password: string, remember: boolean) {
    const revision = (this.revisions.get(connection.id) || 0) + 1;
    this.revisions.set(connection.id, revision);
    const credential = { origin: new URL(connection.url).origin, username: connection.username, password };
    this.memory.set(connection.id, credential);
    delete this.encrypted[connection.id];
    let saved = false;
    if (remember && await this.available()) {
      try {
        const encrypted = await this.cipher.encryptStringAsync(JSON.stringify(credential));
        if (this.revisions.get(connection.id) !== revision) return false;
        this.encrypted[connection.id] = encrypted.toString('base64');
        saved = true;
      } catch { saved = false; }
    }
    if (this.revisions.get(connection.id) !== revision) return false;
    this.flush();
    return saved;
  }
  clear(id: string) {
    this.revisions.set(id, (this.revisions.get(id) || 0) + 1);
    this.memory.delete(id);
    delete this.encrypted[id];
    this.flush();
  }
  private flush() { writePrivateJSON(this.file, this.encrypted); }
}
