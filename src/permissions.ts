import { matchesOrigin, type Connection } from './model';

export class Permissions {
  private approved = new Set<string>();
  grant(connection: Connection, permission: string, mediaTypes: string[] = []) {
    for (const kind of permission === 'media' ? mediaTypes : ['']) this.approved.add(this.key(connection, permission, kind));
  }
  allows(connection: Connection, requestingOrigin: string, permission: string, mediaType = '') {
    return matchesOrigin(requestingOrigin, connection.url)
      && this.approved.has(this.key(connection, permission, mediaType));
  }
  private key(connection: Connection, permission: string, mediaType: string) {
    return JSON.stringify([connection.id, new URL(connection.url).origin, permission, mediaType]);
  }
}
