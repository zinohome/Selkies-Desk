import { matchesOrigin, type Connection } from './model';

export function isClipboardPermission(permission: string) {
  return ['clipboard-read', 'clipboard-sanitized-write', 'deprecated-sync-clipboard-read'].includes(permission);
}

export class Permissions {
  private decisions = new Map<string, boolean>();
  private pending = new Map<string, { promise: Promise<boolean>; cancel: () => void }>();
  private queue = Promise.resolve();
  grant(connection: Connection, permission: string, mediaTypes: string[] = []) {
    for (const kind of permission === 'media' ? mediaTypes : ['']) this.decisions.set(this.key(connection, permission, kind), true);
  }
  allows(connection: Connection, requestingOrigin: string, permission: string, mediaType = '') {
    return matchesOrigin(requestingOrigin, connection.url)
      && this.decisions.get(this.key(connection, permission, mediaType)) === true;
  }
  request(connection: Connection, requestingOrigin: string, permission: string, mediaTypes: string[], ask: (signal: AbortSignal) => Promise<boolean>): Promise<boolean> {
    if (!matchesOrigin(requestingOrigin, connection.url)) return Promise.resolve(false);
    const kinds = permission === 'media' ? [...new Set(mediaTypes)].sort() : [''];
    if (!kinds.length || (permission === 'media' && kinds.some(kind => !['audio', 'video'].includes(kind)))) return Promise.resolve(false);
    const keys = kinds.map(kind => this.key(connection, permission, kind));
    if (keys.some(key => this.decisions.get(key) === false)) return Promise.resolve(false);
    if (keys.every(key => this.decisions.get(key) === true)) return Promise.resolve(true);
    const key = JSON.stringify(keys);
    const existing = this.pending.get(key);
    if (existing) return existing.promise;
    const controller = new AbortController();
    let resolve!: (allowed: boolean) => void;
    const promise = new Promise<boolean>(fulfill => { resolve = fulfill; });
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (allowed: boolean, remember = true) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (remember) for (const item of keys) this.decisions.set(item, allowed);
      this.pending.delete(key);
      resolve(allowed);
    };
    this.pending.set(key, { promise, cancel: () => { finish(false, false); controller.abort(); } });
    // Different permissions wait their turn; identical concurrent requests share a promise.
    this.queue = this.queue.then(async () => {
      if (settled) return;
      timer = setTimeout(() => { finish(false); controller.abort(); }, 120000);
      timer.unref();
      try { finish(await ask(controller.signal)); } catch { finish(false); }
    });
    return promise;
  }
  clear() {
    for (const item of this.pending.values()) item.cancel();
    this.pending.clear();
    this.decisions.clear();
    this.queue = Promise.resolve();
  }
  private key(connection: Connection, permission: string, mediaType: string) {
    const kind = permission === 'deprecated-sync-clipboard-read' ? 'clipboard-read' : permission;
    return JSON.stringify([connection.id, new URL(connection.url).origin, kind, mediaType]);
  }
}
