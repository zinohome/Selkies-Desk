import { app, dialog, session, WebContentsView, type BrowserWindow } from 'electron';
import { X509Certificate } from 'node:crypto';
import { join } from 'node:path';
import { matchesOrigin, matchesNetworkOrigin, trustedCertificate, type Connection, type Store } from './model';
import { t, type Message } from './i18n';
import type { RemoteStatus } from './protocol';
import { desktopBounds, type Layout } from './layout';

type Tab = { view: WebContentsView; generation: number; status: RemoteStatus['phase']; detail: Message; certificateResolvers: Map<string, (allowed: boolean) => void> };

export type MagpieOptions = { settings: () => { strip: number; layout: Layout }; strip: () => number; layout: () => Layout };
export type MagpieState = { tabs: string[]; active?: string; status: Record<string, { phase: RemoteStatus['phase']; detail: string }> };

export class Magpie {
  private tabs = new Map<string, Tab>();
  private activeID?: string;
  constructor(private window: BrowserWindow, private store: Store, private changed: () => void) {
    app.on('certificate-error', (event, contents, url, error, certificate, callback) => {
      const tab = [...this.tabs.values()].find(tab => tab.view.webContents === contents);
      if (!tab) return;
      event.preventDefault();
      void this.certificate(tab, url, error, certificate).then(callback, () => callback(false));
    });
  }
  get state(): MagpieState {
    const status: MagpieState['status'] = {};
    for (const [id, tab] of this.tabs) status[id] = { phase: tab.status, detail: t(...tab.detail) };
    return { tabs: [...this.tabs.keys()], active: this.activeID, status };
  }
  get active() { return this.activeID ? this.store.get(this.activeID) : undefined; }
  get visible() { return !!this.activeID && !this.window.isFullScreen(); }
  layout() {
    const id = this.activeID;
    const tab = id && this.tabs.get(id);
    if (!tab || this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    tab.view.setBounds(desktopBounds(width, height, this.window.isFullScreen() ? { sidebar: false, toolbar: false } : this.store.layout, this.window.isFullScreen() ? 0 : 28));
  }
  async open(id: string) {
    const connection = this.store.get(id);
    if (connection.kind !== 'magpie') throw Error(t('magpie.wrongKind'));
    if (!this.tabs.has(id) && this.tabs.size >= 12) throw Error(t('magpie.limit'));
    if (!this.tabs.has(id)) {
      const generation = Math.floor(Math.random() * 1e9);
      const tab: Tab = { view: this.view(connection, generation), generation, status: 'loading', detail: ['detail.loading'], certificateResolvers: new Map() };
      this.tabs.set(id, tab);
      this.window.contentView.addChildView(tab.view);
      void tab.view.webContents.loadURL(connection.url).catch(() => this.fail(id, ['detail.loadFailed', { description: 'load rejected' }]));
    }
    this.activeID = id;
    const ids = [...this.tabs.keys()];
    this.store.setMagpieTabs(ids);
    this.layout();
    for (const [tabID, tab] of this.tabs) tab.view.setVisible(tabID === id);
    this.changed();
  }
  select(id: string) {
    if (!this.tabs.has(id)) throw Error(t('model.missing'));
    this.activeID = id;
    for (const [tabID, tab] of this.tabs) tab.view.setVisible(tabID === id);
    this.layout();
    this.changed();
  }
  async close(id: string) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    this.tabs.delete(id);
    for (const resolve of tab.certificateResolvers.values()) resolve(false);
    if (this.activeID === id) this.activeID = [...this.tabs.keys()].at(-1);
    this.store.setMagpieTabs([...this.tabs.keys()]);
    if (this.activeID) this.select(this.activeID);
    this.changed();
    const partition = tab.view.webContents.session;
    if (!tab.view.webContents.isDestroyed()) {
      const closed = new Promise<void>(resolve => tab.view.webContents.once('destroyed', resolve));
      tab.view.webContents.close({ waitForBeforeUnload: false });
      await closed;
    }
    await partition.closeAllConnections();
    await partition.flushStorageData();
    await partition.cookies.flushStore();
  }
  async closeAll() { for (const id of [...this.tabs.keys()]) await this.close(id); }
  forget(id: string) { void this.close(id); }
  private view(connection: Connection, generation: number) {
    const partition = session.fromPartition(`persist:magpie-${connection.id}`);
    this.configure(partition, connection, generation);
    const view = new WebContentsView({ webPreferences: { session: partition, nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, navigateOnDragDrop: false, spellcheck: false } });
    view.setBackgroundColor('#1b1c1f');
    const contents = view.webContents;
    const id = connection.id;
    const valid = () => this.tabs.get(id)?.generation === generation && !contents.isDestroyed();
    contents.setBackgroundThrottling(false);
    contents.setWindowOpenHandler(({ url }) => {
      void shellOpen(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', event => { if (!matchesOrigin(event.url, connection.url)) event.preventDefault(); });
    contents.on('will-redirect', event => { if (!matchesOrigin(event.url, connection.url)) event.preventDefault(); });
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('did-start-loading', () => valid() && this.update(id, 'loading', ['detail.loading']));
    contents.on('did-finish-load', () => valid() && this.update(id, 'loaded', ['detail.loaded']));
    contents.on('did-fail-load', (_event, code, description, _url, mainFrame) => { if (mainFrame && code !== -3 && valid()) this.fail(id, ['detail.loadFailed', { code, description }]); });
    contents.on('render-process-gone', () => valid() && this.fail(id, ['detail.crashed']));
    contents.once('destroyed', () => { if (this.tabs.get(id)?.generation === generation) this.fail(id, ['detail.closed']); });
    return view;
  }
  private update(id: string, phase: RemoteStatus['phase'], detail: Message) {
    const tab = this.tabs.get(id);
    if (!tab) return;
    tab.status = phase;
    tab.detail = detail;
    this.changed();
  }
  private fail(id: string, detail: Message) { this.update(id, 'failed', detail); }
  private async certificate(tab: Tab, url: string, error: string, certificate: Electron.Certificate) {
    const id = [...this.tabs.entries()].find(([, candidate]) => candidate === tab)?.[0];
    const connection = id && this.store.get(id);
    if (!connection || !matchesNetworkOrigin(url, connection.url)) return false;
    const fingerprint = new X509Certificate(certificate.data).fingerprint256;
    if (trustedCertificate(this.store, connection.id, new URL(connection.url).origin, fingerprint)) return true;
    const known = tab.certificateResolvers.get(fingerprint);
    if (known) return new Promise<boolean>(resolve => known(false));
    const { response } = await dialog.showMessageBox(this.window, {
      type: 'warning', title: t('cert.title'), message: t('cert.body'),
      detail: `${new URL(connection.url).origin}\n${fingerprint}\n${error}`,
      buttons: [t('cert.deny'), t('cert.accept')], defaultId: 0, cancelId: 0
    });
    if (response !== 1 || !this.tabs.has(connection.id)) return false;
    this.store.trust(connection.id, new URL(connection.url).origin, fingerprint);
    this.changed();
    return true;
  }
  private configure(partition: Electron.Session, connection: Connection, generation: number) {
    partition.setCertificateVerifyProc((request, callback) => {
      try {
        const pin = this.store.certificate(connection.id);
        const fingerprint = new X509Certificate(request.certificate.data).fingerprint256;
        if (pin && pin.fingerprint !== fingerprint && request.hostname === new URL(connection.url).hostname) return callback(-202);
      } catch { return callback(-202); }
      callback(-3);
    });
    partition.setPermissionCheckHandler((contents, permission, origin, details) => {
      const requesting = 'requestingUrl' in details ? details.requestingUrl : '';
      return this.tabs.get(connection.id)?.generation === generation && contents === this.tabs.get(connection.id)?.view.webContents
        && matchesOrigin(origin, connection.url) && (!requesting || matchesOrigin(requesting, connection.url))
        && ['clipboard-read', 'clipboard-sanitized-write', 'deprecated-sync-clipboard-read', 'fullscreen', 'pointerLock', 'local-network-access', 'loopback-network'].includes(permission);
    });
    partition.setPermissionRequestHandler((contents, permission, callback, details) => {
      const requested = details.requestingUrl;
      const tab = this.tabs.get(connection.id);
      const safe = ['clipboard-read', 'clipboard-sanitized-write', 'deprecated-sync-clipboard-read', 'fullscreen', 'pointerLock', 'local-network-access', 'loopback-network'];
      callback(!!tab && tab.generation === generation && contents === tab.view.webContents && !!requested && matchesOrigin(requested, connection.url) && safe.includes(permission));
    });
    partition.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: this.tabs.get(connection.id)?.generation !== generation }));
  }
}

async function shellOpen(url: string) {
  const { shell } = await import('electron');
  if (!/^https?:/i.test(url)) return;
  await shell.openExternal(url, { activate: false });
}
