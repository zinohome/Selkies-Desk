import { app, dialog, session, WebContentsView, type BrowserWindow } from 'electron';
import { X509Certificate } from 'node:crypto';
import { matchesOrigin, matchesNetworkOrigin, trustedCertificate, type Connection, type Store } from './model';
import { t, type Message } from './i18n';
import type { RemoteStatus } from './protocol';
import { desktopBounds, magpieTabsHeight, type Layout } from './layout';

type Tab = { view: WebContentsView; generation: number; status: RemoteStatus['phase']; detail: Message };

type MagpieOptions = { strip: () => number; layout: () => Layout; onInput: (event: Electron.Event, input: Electron.Input) => void };
export type MagpieState = { tabs: string[]; restorable: boolean; active?: string; status: Record<string, { phase: RemoteStatus['phase']; detail: string }> };

export class Magpie {
  private tabs = new Map<string, Tab>();
  private activeID?: string;
  private modal = false;
  private generation = 0;
  constructor(private window: BrowserWindow, private store: Store, private changed: () => void, private options: MagpieOptions) {
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
    return { tabs: [...this.tabs.keys()], restorable: this.store.magpieTabs.some(id => !this.tabs.has(id)), active: this.activeID, status };
  }
  get active() { return this.activeID ? this.store.get(this.activeID) : undefined; }
  setModal(open: boolean) {
    this.modal = open;
    this.layout();
  }
  deactivate() {
    this.activeID = undefined;
    this.layout();
    this.changed();
  }
  layout() {
    if (this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    const bounds = desktopBounds(width, height, this.options.layout(), this.options.strip());
    for (const [id, tab] of this.tabs) {
      const visible = id === this.activeID && !this.modal && tab.status === 'loaded' && !tab.view.webContents.isDestroyed();
      if (visible) tab.view.setBounds({ ...bounds, y: bounds.y + magpieTabsHeight, height: Math.max(1, bounds.height - magpieTabsHeight) });
      tab.view.setVisible(visible);
    }
  }
  open(id: string, reload = false) {
    const connection = this.store.get(id);
    if (connection.kind !== 'magpie') throw Error(t('magpie.wrongKind'));
    let tab = this.tabs.get(id);
    if (!tab && this.tabs.size >= 12) throw Error(t('magpie.limit'));
    const shouldLoad = !tab || tab.status === 'failed' || reload;
    if (!tab || tab.view.webContents.isDestroyed()) {
      if (tab) this.window.contentView.removeChildView(tab.view);
      const generation = ++this.generation;
      tab = { view: this.view(connection, generation), generation, status: 'loading', detail: ['detail.loading'] };
      this.tabs.set(id, tab);
      tab.view.setVisible(false);
      this.window.contentView.addChildView(tab.view);
      this.store.setMagpieTabs([...this.tabs.keys(), ...this.store.magpieTabs]);
    }
    this.select(id);
    if (shouldLoad) {
      this.update(id, 'loading', ['detail.loading']);
      const { generation, view } = tab;
      void view.webContents.loadURL(connection.url).catch((error: { code?: string; errno?: number }) => {
        if (this.tabs.get(id)?.generation === generation && this.tabs.get(id)?.status === 'loading') {
          this.fail(id, ['detail.loadFailed', { code: error.errno ?? '—', description: error.code || 'navigation' }]);
        }
      });
    }
  }
  select(id: string) {
    if (!this.tabs.has(id)) throw Error(t('model.missing'));
    this.activeID = id;
    this.layout();
    this.changed();
  }
  restore() {
    for (const id of this.store.magpieTabs) if (!this.tabs.has(id)) this.open(id);
  }
  async close(id: string, remember = false) {
    const tab = this.tabs.get(id);
    this.tabs.delete(id);
    if (!remember && this.store.magpieTabs.includes(id)) this.store.setMagpieTabs(this.store.magpieTabs.filter(saved => saved !== id));
    if (!tab) return;
    if (this.activeID === id) this.activeID = [...this.tabs.keys()].at(-1);
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view);
    this.layout();
    this.changed();
    const partition = session.fromPartition(`persist:magpie-${id}`);
    if (!tab.view.webContents.isDestroyed()) {
      const closed = new Promise<void>(resolve => tab.view.webContents.once('destroyed', resolve));
      tab.view.webContents.close({ waitForBeforeUnload: false });
      await closed;
    }
    await partition.closeAllConnections();
    await partition.flushStorageData();
    await partition.cookies.flushStore();
  }
  async closeAll() { for (const id of [...this.tabs.keys()]) await this.close(id, true); }
  private view(connection: Connection, generation: number) {
    const partition = session.fromPartition(`persist:magpie-${connection.id}`);
    this.configure(partition, connection, generation);
    const view = new WebContentsView({ webPreferences: { session: partition, nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, navigateOnDragDrop: false, spellcheck: false } });
    view.setBackgroundColor('#1b1c1f');
    const contents = view.webContents;
    const id = connection.id;
    const valid = () => this.tabs.get(id)?.generation === generation && !contents.isDestroyed();
    contents.on('before-input-event', this.options.onInput);
    contents.setBackgroundThrottling(false);
    contents.setWindowOpenHandler(({ url }) => {
      void shellOpen(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', event => { if (!matchesOrigin(event.url, connection.url)) event.preventDefault(); });
    contents.on('will-redirect', event => { if (!matchesOrigin(event.url, connection.url)) event.preventDefault(); });
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('did-start-navigation', event => {
      if (event.isMainFrame && !event.isSameDocument && valid()) this.update(id, 'loading', ['detail.loading']);
    });
    contents.on('did-navigate', (_event, _url, status) => {
      if (status >= 400 && valid()) this.fail(id, ['magpie.httpError', { status }]);
    });
    contents.on('did-finish-load', () => {
      if (valid() && this.tabs.get(id)?.status === 'loading') this.update(id, 'loaded', ['detail.loaded']);
    });
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
    this.layout();
    this.changed();
  }
  private fail(id: string, detail: Message) { this.update(id, 'failed', detail); }
  private async certificate(tab: Tab, url: string, error: string, certificate: Electron.Certificate) {
    const id = [...this.tabs.entries()].find(([, candidate]) => candidate === tab)?.[0];
    const connection = id && this.store.get(id);
    if (!connection || !matchesNetworkOrigin(url, connection.url)) return false;
    const fingerprint = new X509Certificate(certificate.data).fingerprint256;
    if (trustedCertificate(this.store, connection.id, new URL(connection.url).origin, fingerprint)) return true;
    const { response } = await dialog.showMessageBox(this.window, {
      type: 'warning', title: t('cert.title'), message: t('cert.body'),
      detail: `${new URL(connection.url).origin}\n${fingerprint}\n${error}`,
      buttons: [t('cert.deny'), t('cert.accept')], defaultId: 0, cancelId: 0
    });
    if (response !== 1 || this.tabs.get(connection.id) !== tab) return false;
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
