import { app, dialog, shell, session, WebContentsView, type BrowserWindow, type WebContents, type Session, type AuthenticationResponseDetails, type AuthInfo, type Certificate, type Event, type Input } from 'electron';
import { X509Certificate, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { matchesOrigin, matchesNetworkOrigin, Store, trustedCertificate, type Connection, type Settings } from './model';
import { t, type Message } from './i18n';
import type { Thumbnails } from './thumbnails';
import { maxRetries, retryable, retryDelay } from './retry';
import { Vault } from './vault';
import type { Answer, Prompt, RemoteStatus } from './protocol';
import { Permissions, isClipboardPermission } from './permissions';
import { desktopBounds, type Layout } from './layout';

export type RemoteOptions = {
  settings: () => Settings;
  /** Height reserved above the desktop when the toolbar is hidden. */
  strip: () => number;
  /** Layout actually on screen, which can differ from the saved preference in full screen. */
  layout: () => Layout;
  thumbnails: Thumbnails;
  /** Called once per connection attempt, when the server page first finishes loading. */
  onLoaded: (connection: Connection) => void;
  /** Lets the main process handle management shortcuts before the remote page sees the key. */
  onInput: (event: Event, input: Input) => void;
};

export class Remote {
  private phase: RemoteStatus['phase'] = 'idle';
  private message: Message = ['detail.choose'];
  private retries = 0;
  private retryTimer?: NodeJS.Timeout;
  private thumbnailTimer?: NodeJS.Timeout;
  get status(): RemoteStatus { return { id: this.active?.id, phase: this.phase, detail: t(...this.message) }; }
  prompt?: Prompt;
  private view?: WebContentsView;
  private active?: Connection;
  private generation = 0;
  private modal = false;
  private attempts = 0;
  private pending?: { promise: Promise<Answer>; resolve: (answer: Answer) => void; timer: NodeJS.Timeout };
  private permissions = new Permissions();
  constructor(private window: BrowserWindow, private store: Store, private vault: Vault, private changed: () => void, private options: RemoteOptions) {
    app.on('login', (event, contents, request, auth, callback) => {
      if (contents !== this.view?.webContents) return;
      event.preventDefault();
      void this.login(contents, request, auth, callback).catch(() => callback());
    });
    app.on('certificate-error', (event, contents, url, error, certificate, callback) => {
      if (contents !== this.view?.webContents) return;
      event.preventDefault();
      void this.certificate(contents, url, error, certificate).then(callback, () => callback(false));
    });
  }
  get activeID() { return this.active?.id; }
  get visible() { return !!this.view && !this.modal && !this.prompt && ['loading', 'loaded'].includes(this.phase); }
  /** Applies the “send app shortcuts to the remote desktop” setting to the active page. */
  applyKeyPolicy() {
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.setIgnoreMenuShortcuts(this.options.settings().passSystemKeys);
  }
  focus() { if (this.visible) this.view?.webContents.focus(); }
  setModal(open: boolean) {
    this.modal = open;
    this.visibility();
  }
  layout() {
    if (!this.view || this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    this.view.setBounds(desktopBounds(width, height, this.options.layout(), this.options.strip()));
  }
  async connect(id: string) {
    const connection = this.store.get(id);
    await this.disconnect();
    this.active = connection;
    const generation = this.generation;
    this.attempts = 0;
    this.retries = 0;
    const partition = session.fromPartition(`persist:selkies-${connection.id}`);
    this.configureSession(partition, connection, generation);
    const view = new WebContentsView({
      webPreferences: {
        session: partition, nodeIntegration: false, nodeIntegrationInSubFrames: false,
        contextIsolation: true, sandbox: true, webSecurity: true,
        allowRunningInsecureContent: false, webviewTag: false,
        navigateOnDragDrop: false, spellcheck: false
      }
    });
    this.view = view;
    this.window.contentView.addChildView(view);
    this.layout();
    this.visibility();
    const contents = view.webContents;
    let loadFailed = false;
    let loadedOnce = false;
    let crashReloaded = false;
    contents.setBackgroundThrottling(false);
    this.applyKeyPolicy();
    contents.on('before-input-event', (event, input) => this.options.onInput(event, input));
    contents.setWindowOpenHandler(({ url }) => {
      void this.external(url, generation);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (!matchesOrigin(url, connection.url)) {
        event.preventDefault();
        this.notice(['detail.crossNavigation']);
      }
    });
    contents.on('will-redirect', (event, url) => {
      if (!matchesOrigin(url, connection.url)) {
        event.preventDefault();
        this.update('failed', ['detail.crossRedirect']);
      }
    });
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('did-start-loading', () => {
      if (this.valid(generation)) this.update('loading', ['detail.loading']);
    });
    contents.on('did-start-navigation', (_event, url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace && this.valid(generation)) {
        this.permissions.clear();
        if (matchesOrigin(url, connection.url)) loadFailed = false;
      }
    });
    contents.on('did-finish-load', () => {
      if (!this.valid(generation) || loadFailed) return;
      this.retries = 0;
      this.update('loaded', ['detail.loaded']);
      if (!loadedOnce) {
        loadedOnce = true;
        this.options.onLoaded(connection);
      }
      clearTimeout(this.thumbnailTimer);
      this.thumbnailTimer = setTimeout(() => { if (this.valid(generation)) void this.capture(); }, 4000);
      this.thumbnailTimer.unref();
    });
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3 && this.valid(generation)) {
        loadFailed = true;
        const details = { description, code };
        if (!this.options.settings().autoReconnect || !retryable(code)) { this.update('failed', ['detail.loadFailed', details]); return; }
        if (this.retries >= maxRetries) { this.update('failed', ['detail.retryExhausted', { ...details, max: maxRetries }]); return; }
        const attempt = ++this.retries;
        const seconds = retryDelay(attempt);
        this.update('waiting', ['detail.retrying', { ...details, seconds, attempt, max: maxRetries }]);
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => {
          if (!this.valid(generation)) return;
          this.update('loading', ['detail.loading']);
          void contents.loadURL(connection.url).catch(() => {});
        }, seconds * 1000);
      }
    });
    contents.on('render-process-gone', () => {
      if (this.valid(generation)) {
        this.permissions.clear();
        this.cancelPrompt();
        if (this.options.settings().autoReconnect && !crashReloaded) {
          crashReloaded = true;
          this.update('loading', ['detail.crashRetry']);
          contents.reload();
        } else this.update('failed', ['detail.crashed']);
      }
    });
    contents.once('destroyed', () => {
      if (generation === this.generation && this.view === view) {
        this.permissions.clear();
        this.cancelPrompt();
        this.view = undefined;
        this.window.contentView.removeChildView(view);
        this.update('failed', ['detail.closed']);
      }
    });
    contents.on('enter-html-full-screen', () => this.window.setFullScreen(true));
    contents.on('leave-html-full-screen', () => this.window.setFullScreen(false));
    this.update('loading', ['detail.loading']);
    void contents.loadURL(connection.url).catch(() => {});
  }
  /** Saves a small preview of the visible desktop for the connection card. */
  async capture() {
    const view = this.view;
    const connection = this.active;
    if (!view || !connection || this.phase !== 'loaded' || !this.visible || !this.options.settings().thumbnails) return;
    try {
      const image = await Promise.race([
        view.webContents.capturePage(),
        new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 1500))
      ]);
      if (!image || image.isEmpty()) return;
      this.options.thumbnails.write(connection.id, image.resize({ width: 480, quality: 'good' }).toJPEG(72));
      this.changed();
    } catch { /* A missing preview is not worth interrupting the session. */ }
  }
  async disconnect() {
    // Start the preview capture first, then report the new state at once so the
    // interface never shows the old session as live while it is being closed.
    const snapshot = this.capture();
    clearTimeout(this.retryTimer);
    clearTimeout(this.thumbnailTimer);
    this.generation++;
    this.permissions.clear();
    this.cancelPrompt();
    const view = this.view;
    this.view = undefined;
    this.update(this.active ? 'disconnected' : 'idle', this.active ? ['detail.streamClosed'] : ['detail.choose']);
    await snapshot;
    if (view && !view.webContents.isDestroyed()) {
      const partition = view.webContents.session;
      this.window.contentView.removeChildView(view);
      const closed = new Promise<void>(resolve => view.webContents.once('destroyed', () => resolve()));
      view.webContents.close({ waitForBeforeUnload: false });
      await closed;
      await partition.closeAllConnections();
      await partition.flushStorageData();
      await partition.cookies.flushStore();
    }
  }
  async clearPassword(id: string) {
    if (this.activeID === id) await this.disconnect();
    this.vault.clear(id);
    await session.fromPartition(`persist:selkies-${id}`).clearAuthCache();
    this.changed();
  }
  forget(id: string) {
    if (this.active?.id === id) {
      this.active = undefined;
      this.update('idle', ['detail.choose']);
    }
  }
  async revoke(id: string) {
    if (this.activeID === id) await this.disconnect();
    this.store.revoke(id);
    const partition = session.fromPartition(`persist:selkies-${id}`);
    partition.setCertificateVerifyProc((_request, callback) => callback(-3));
    await partition.closeAllConnections();
    await partition.clearCache();
    this.changed();
  }
  answer(answer: Answer) {
    if (!this.prompt || this.prompt.token !== answer.token || !this.pending) throw Error(t('detail.promptExpired'));
    this.pending.resolve(answer);
    clearTimeout(this.pending.timer);
    this.pending = undefined;
    this.prompt = undefined;
    this.visibility();
    this.changed();
  }
  private valid(generation: number) { return generation === this.generation && !!this.view && !this.view.webContents.isDestroyed(); }
  private update(phase: RemoteStatus['phase'], message: Message) {
    this.phase = phase;
    this.message = message;
    this.visibility();
    this.changed();
  }
  private notice(message: Message) {
    this.message = message;
    this.changed();
  }
  private visibility() {
    this.view?.setVisible(this.visible);
  }
  private cancelPrompt() {
    if (this.pending && this.prompt) {
      this.pending.resolve({ type: 'answer', token: this.prompt.token, accept: false });
      clearTimeout(this.pending.timer);
    }
    this.pending = undefined;
    this.prompt = undefined;
  }
  private ask(value: Omit<Prompt, 'token'>): Promise<Answer> {
    if (this.pending && this.prompt?.type === value.type && this.prompt.origin === value.origin && this.prompt.fingerprint === value.fingerprint) return this.pending.promise;
    this.cancelPrompt();
    const token = randomUUID();
    let resolve!: (answer: Answer) => void;
    const promise = new Promise<Answer>(fulfill => { resolve = fulfill; });
    const timer = setTimeout(() => {
      if (this.prompt?.token === token) {
        this.cancelPrompt();
        this.visibility();
        this.notice(['detail.promptTimeout']);
      }
    }, 120000);
    timer.unref();
    this.pending = { promise, resolve, timer };
    this.prompt = { ...value, token };
    this.visibility();
    this.changed();
    return promise;
  }
  private async login(contents: WebContents, request: AuthenticationResponseDetails, auth: AuthInfo, callback: (username?: string, password?: string) => void) {
    const connection = this.active;
    const generation = this.generation;
    if (!connection || auth.isProxy || auth.scheme.toLowerCase() !== 'basic' || !matchesNetworkOrigin(request.url, connection.url)) {
      callback();
      this.notice(['detail.credentialRejected']);
      return;
    }
    const attempt = this.attempts++;
    const saved = attempt === 0 ? await this.vault.get(connection) : undefined;
    if (!this.valid(generation) || contents !== this.view?.webContents) { callback(); return; }
    if (saved) { callback(saved.username, saved.password); return; }
    const answer = await this.ask({ type: 'auth', origin: new URL(connection.url).origin, username: connection.username, retry: attempt > 0 });
    if (!answer.accept || !this.valid(generation)) {
      callback();
      if (this.valid(generation)) this.update('failed', ['detail.authCancelled']);
      return;
    }
    if (!answer.username?.trim() || answer.username.includes(':') || answer.password === undefined) {
      callback();
      this.update('failed', ['detail.authInvalid']);
      return;
    }
    const updated = this.store.save({ ...connection, username: answer.username.trim() });
    this.active = updated;
    const savedToDisk = await this.vault.set(updated, answer.password, !!answer.remember);
    if (!this.valid(generation)) { callback(); return; }
    if (answer.remember && !savedToDisk) this.notice(['detail.storageUnavailable']);
    this.changed();
    callback(updated.username, answer.password);
  }
  private async certificate(contents: WebContents, url: string, error: string, certificate: Certificate) {
    const connection = this.active;
    const generation = this.generation;
    if (!connection || contents !== this.view?.webContents || !matchesNetworkOrigin(url, connection.url)) return false;
    const origin = new URL(connection.url).origin;
    const fingerprint = new X509Certificate(certificate.data).fingerprint256;
    if (trustedCertificate(this.store, connection.id, origin, fingerprint)) return true;
    const answer = await this.ask({
      type: 'certificate', origin, fingerprint, error,
      subject: certificate.subjectName, issuer: certificate.issuerName, validExpiry: certificate.validExpiry
    });
    if (!answer.accept || !this.valid(generation)) {
      if (this.valid(generation)) this.update('failed', ['detail.certRejected']);
      return false;
    }
    this.store.trust(connection.id, origin, fingerprint);
    this.changed();
    return true;
  }
  private configureSession(partition: Session, connection: Connection, generation: number) {
    partition.webRequest.onBeforeRequest((_details, callback) => {
      callback({ cancel: !this.valid(generation) });
    });
    partition.setCertificateVerifyProc((request, callback) => {
      const pin = this.store.certificate(connection.id);
      try {
        const fingerprint = new X509Certificate(request.certificate.data).fingerprint256;
        if (pin && pin.fingerprint !== fingerprint && request.hostname === new URL(connection.url).hostname) return callback(-202);
      } catch { return callback(-202); }
      callback(-3);
    });
    partition.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders };
      const sameOrigin = matchesNetworkOrigin(details.url, connection.url);
      for (const key of Object.keys(headers)) {
        const name = key.toLowerCase();
        if (name === 'proxy-authorization' || (!sameOrigin && ['authorization', 'cookie'].includes(name))) delete headers[key];
      }
      callback({ requestHeaders: headers });
    });
    partition.setPermissionCheckHandler((contents, permission, origin, details) => {
      return this.valid(generation) && contents === this.view?.webContents
        && (!details.requestingUrl || matchesOrigin(details.requestingUrl, connection.url))
        && (!details.securityOrigin || matchesOrigin(details.securityOrigin, connection.url))
        && matchesOrigin(origin, connection.url)
        && (this.granted(permission) || this.permissions.allows(connection, origin, permission, permission === 'media' ? details.mediaType || 'unknown' : ''));
    });
    partition.setPermissionRequestHandler((contents, permission, callback, details) => {
      const safe = ['clipboard-read', 'clipboard-sanitized-write', 'deprecated-sync-clipboard-read', 'media', 'pointerLock', 'keyboardLock', 'fullscreen', 'speaker-selection', 'local-network', 'local-network-access', 'loopback-network'];
      const requested = details.requestingUrl;
      if (!requested || !this.valid(generation) || contents !== this.view?.webContents || !matchesOrigin(requested, connection.url) || !safe.includes(permission)) { callback(false); return; }
      // Clipboard sharing is enabled for the configured active origin by product policy.
      if (this.granted(permission)) { callback(true); return; }
      const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined;
      const labels: Record<string, string> = {
        media: t('perm.media', { types: mediaTypes?.join(', ') || t('perm.mediaDefault') }), pointerLock: t('perm.pointerLock'),
        keyboardLock: t('perm.keyboardLock'), fullscreen: t('perm.fullscreen'), 'speaker-selection': t('perm.speaker'),
        'local-network': t('perm.localNetwork'), 'local-network-access': t('perm.localNetwork'), 'loopback-network': t('perm.loopback')
      };
      void this.permissions.request(connection, requested, permission, mediaTypes || [], async signal => {
        if (!this.valid(generation) || contents !== this.view?.webContents) return false;
        const result = await dialog.showMessageBox(this.window, {
          type: 'question', title: t('perm.title'),
          message: t('perm.message', { name: connection.name, what: labels[permission] }),
          detail: t('perm.detail', { origin: new URL(connection.url).origin }),
          buttons: [t('perm.deny'), t('perm.allow')], defaultId: 0, cancelId: 0, signal
        });
        return result.response === 1 && !signal.aborted && this.valid(generation) && contents === this.view?.webContents;
      }).then(allowed => callback(allowed && this.valid(generation) && contents === this.view?.webContents));
    });
    partition.removeAllListeners('will-download');
    partition.on('will-download', (event, item, contents) => {
      if (!this.valid(generation) || contents !== this.view?.webContents) { event.preventDefault(); return; }
      item.setSaveDialogOptions({ title: t('download.title'), defaultPath: basename(item.getFilename()) });
      item.on('done', (_event, state) => {
        if (this.valid(generation)) this.notice([state === 'completed' ? 'detail.downloadSaved' : state === 'cancelled' ? 'detail.downloadCancelled' : 'detail.downloadFailed']);
      });
    });
  }
  /** Permissions granted by product policy: clipboard always, keyboard capture when system keys are forwarded. */
  private granted(permission: string) {
    return isClipboardPermission(permission) || (permission === 'keyboardLock' && this.options.settings().passSystemKeys);
  }
  private async external(url: string, generation: number) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return; }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return;
    const choice = await dialog.showMessageBox(this.window, {
      type: 'question', title: t('external.title'), message: t('external.message'),
      detail: parsed.href, buttons: [t('ui.cancel'), t('external.open')], defaultId: 0, cancelId: 0
    });
    if (choice.response === 1 && this.valid(generation)) await shell.openExternal(parsed.href);
  }
}
