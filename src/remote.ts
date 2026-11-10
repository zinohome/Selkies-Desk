import { app, dialog, shell, session, WebContentsView, type BrowserWindow, type WebContents, type Session, type AuthenticationResponseDetails, type AuthInfo, type Certificate } from 'electron';
import { X509Certificate, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { matchesOrigin, matchesNetworkOrigin, Store, trustedCertificate, type Connection } from './model';
import { Vault } from './vault';
import type { Answer, Prompt, RemoteStatus } from './protocol';
import { Permissions, isClipboardPermission } from './permissions';
import { desktopBounds } from './layout';

export class Remote {
  status: RemoteStatus = { phase: 'idle', detail: '选择一个连接，打开远程桌面。' };
  prompt?: Prompt;
  private view?: WebContentsView;
  private active?: Connection;
  private generation = 0;
  private modal = false;
  private attempts = 0;
  private pending?: { promise: Promise<Answer>; resolve: (answer: Answer) => void; timer: NodeJS.Timeout };
  private permissions = new Permissions();
  constructor(private window: BrowserWindow, private store: Store, private vault: Vault, private changed: () => void) {
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
  get visible() { return !!this.view && !this.modal && !this.prompt && ['loading', 'loaded'].includes(this.status.phase); }
  focus() { if (this.visible) this.view?.webContents.focus(); }
  setModal(open: boolean) {
    this.modal = open;
    this.visibility();
  }
  layout() {
    if (!this.view || this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    this.view.setBounds(desktopBounds(width, height, this.store.layout));
  }
  async connect(id: string) {
    const connection = this.store.get(id);
    await this.disconnect();
    this.active = connection;
    const generation = this.generation;
    this.attempts = 0;
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
    contents.setBackgroundThrottling(false);
    contents.setWindowOpenHandler(({ url }) => {
      void this.external(url, generation);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (!matchesOrigin(url, connection.url)) {
        event.preventDefault();
        this.notice('已阻止跨来源页面跳转。请为新地址单独建立连接。');
      }
    });
    contents.on('will-redirect', (event, url) => {
      if (!matchesOrigin(url, connection.url)) {
        event.preventDefault();
        this.update('failed', '服务器尝试跳转到其他来源，已阻止。请核对连接地址。');
      }
    });
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('did-start-loading', () => {
      if (this.valid(generation)) this.update('loading', '正在加载服务器页面…');
    });
    contents.on('did-start-navigation', (_event, url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace && this.valid(generation)) {
        this.permissions.clear();
        if (matchesOrigin(url, connection.url)) loadFailed = false;
      }
    });
    contents.on('did-finish-load', () => {
      if (this.valid(generation) && !loadFailed) this.update('loaded', '网页已就绪；视频、输入和画质状态请查看 Selkies 自带面板。');
    });
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3 && this.valid(generation)) {
        loadFailed = true;
        this.update('failed', `页面加载失败：${description}（${code}）。请检查网络、认证或证书后重连。`);
      }
    });
    contents.on('render-process-gone', () => {
      if (this.valid(generation)) {
        this.permissions.clear();
        this.cancelPrompt();
        this.update('failed', '远端页面进程已退出，请重连。');
      }
    });
    contents.once('destroyed', () => {
      if (generation === this.generation && this.view === view) {
        this.permissions.clear();
        this.cancelPrompt();
        this.view = undefined;
        this.window.contentView.removeChildView(view);
        this.update('failed', '远端页面已关闭，请重连。');
      }
    });
    contents.on('enter-html-full-screen', () => this.window.setFullScreen(true));
    contents.on('leave-html-full-screen', () => this.window.setFullScreen(false));
    this.update('loading', '正在加载服务器页面…');
    void contents.loadURL(connection.url).catch(() => {});
  }
  async disconnect() {
    this.generation++;
    this.permissions.clear();
    this.cancelPrompt();
    const view = this.view;
    this.view = undefined;
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
    this.update(this.active ? 'disconnected' : 'idle', this.active ? '流已关闭；远端应用继续运行。' : '选择一个连接，打开远程桌面。');
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
      this.update('idle', '选择一个连接，打开远程桌面。');
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
    if (!this.prompt || this.prompt.token !== answer.token || !this.pending) throw Error('此确认已过期，请重新连接。');
    this.pending.resolve(answer);
    clearTimeout(this.pending.timer);
    this.pending = undefined;
    this.prompt = undefined;
    this.visibility();
    this.changed();
  }
  private valid(generation: number) { return generation === this.generation && !!this.view && !this.view.webContents.isDestroyed(); }
  private update(phase: RemoteStatus['phase'], detail: string) {
    this.status = { id: this.active?.id, phase, detail };
    this.visibility();
    this.changed();
  }
  private notice(detail: string) {
    this.status = { ...this.status, detail };
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
        this.notice('确认已超时，请重连后重试。');
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
      this.notice('已拒绝代理、非 Basic 或其他来源的凭据请求。');
      return;
    }
    const attempt = this.attempts++;
    const saved = attempt === 0 ? await this.vault.get(connection) : undefined;
    if (!this.valid(generation) || contents !== this.view?.webContents) { callback(); return; }
    if (saved) { callback(saved.username, saved.password); return; }
    const answer = await this.ask({ type: 'auth', origin: new URL(connection.url).origin, username: connection.username, retry: attempt > 0 });
    if (!answer.accept || !this.valid(generation)) {
      callback();
      if (this.valid(generation)) this.update('failed', '认证已取消，请重连后重新输入。');
      return;
    }
    if (!answer.username?.trim() || answer.username.includes(':') || answer.password === undefined) {
      callback();
      this.update('failed', '请输入有效用户名（不能含冒号）及密码后重连。');
      return;
    }
    const updated = this.store.save({ ...connection, username: answer.username.trim() });
    this.active = updated;
    const savedToDisk = await this.vault.set(updated, answer.password, !!answer.remember);
    if (!this.valid(generation)) { callback(); return; }
    if (answer.remember && !savedToDisk) this.notice('加密存储暂不可用；密码仅用于本次会话，没有明文落盘。');
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
      if (this.valid(generation)) this.update('failed', '证书未获信任，已拒绝连接。核对指纹后可重连。');
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
        && (isClipboardPermission(permission) || this.permissions.allows(connection, origin, permission, permission === 'media' ? details.mediaType || 'unknown' : ''));
    });
    partition.setPermissionRequestHandler((contents, permission, callback, details) => {
      const safe = ['clipboard-read', 'clipboard-sanitized-write', 'deprecated-sync-clipboard-read', 'media', 'pointerLock', 'keyboardLock', 'fullscreen', 'speaker-selection', 'local-network', 'local-network-access', 'loopback-network'];
      const requested = details.requestingUrl;
      if (!requested || !this.valid(generation) || contents !== this.view?.webContents || !matchesOrigin(requested, connection.url) || !safe.includes(permission)) { callback(false); return; }
      // Clipboard sharing is enabled for the configured active origin by product policy.
      if (isClipboardPermission(permission)) { callback(true); return; }
      const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined;
      const labels: Record<string, string> = { media: `音视频设备（${mediaTypes?.join('、') || '摄像头 / 麦克风'}）`, pointerLock: '锁定鼠标指针', keyboardLock: '捕获键盘', fullscreen: '进入全屏', 'speaker-selection': '选择音频输出设备', 'local-network': '访问局域网', 'local-network-access': '访问局域网', 'loopback-network': '访问本机网络' };
      void this.permissions.request(connection, requested, permission, mediaTypes || [], async signal => {
        if (!this.valid(generation) || contents !== this.view?.webContents) return false;
        const result = await dialog.showMessageBox(this.window, {
          type: 'question', title: '远端权限请求',
          message: `允许“${connection.name}”${labels[permission]}？`,
          detail: `${new URL(connection.url).origin}\n仅在您信任该服务器时允许。允许或拒绝将用于当前页面会话；重连、切换、断开或刷新页面后失效。要重新授权，请使用“重连”。`,
          buttons: ['拒绝', '允许'], defaultId: 0, cancelId: 0, signal
        });
        return result.response === 1 && !signal.aborted && this.valid(generation) && contents === this.view?.webContents;
      }).then(allowed => callback(allowed && this.valid(generation) && contents === this.view?.webContents));
    });
    partition.removeAllListeners('will-download');
    partition.on('will-download', (event, item, contents) => {
      if (!this.valid(generation) || contents !== this.view?.webContents) { event.preventDefault(); return; }
      item.setSaveDialogOptions({ title: '保存远端下载文件', defaultPath: basename(item.getFilename()) });
      item.on('done', (_event, state) => {
        if (this.valid(generation)) this.notice(state === 'completed' ? '下载已保存到您选择的位置。' : `下载${state === 'cancelled' ? '已取消' : '未完成，请重试'}。`);
      });
    });
  }
  private async external(url: string, generation: number) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return; }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return;
    const choice = await dialog.showMessageBox(this.window, {
      type: 'question', title: '打开外部链接', message: '在系统浏览器中打开此链接？',
      detail: parsed.href, buttons: ['取消', '打开浏览器'], defaultId: 0, cancelId: 0
    });
    if (choice.response === 1 && this.valid(generation)) await shell.openExternal(parsed.href);
  }
}
