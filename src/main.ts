import { app, BrowserWindow, WebContentsView, dialog, ipcMain, Menu, nativeTheme, safeStorage, screen, session, type Event, type Input, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { Store, matchesOrigin, parseImport } from './model';
import { Vault } from './vault';
import { Remote } from './remote';
import { actionSchema, type Action, type AppState, type Result } from './protocol';
import { ballBounds, defaultLayout, desktopBounds, draggedBall, effectiveLayout, fullscreenInset, homeLayout, snapBall, stripHeight } from './layout';
import { commands, effectiveShortcuts, matchShortcut, osOf, platformName, shortcutLabel, trustedStorage, validShortcut, type Command, type Shortcuts } from './platform';
import { resolveLanguage, setLanguage, language, t } from './i18n';
import { Thumbnails } from './thumbnails';

app.setName('Selkies Desk');
const os = osOf(process.platform);
// macOS lets the toolbar double as the title bar. Windows and Linux keep the native frame until that is tested there.
const integratedTitleBar = os === 'mac';
if (os === 'windows') app.setAppUserModelId('local.selkies.desk');
const explicitProfile = app.commandLine.getSwitchValue('user-data-dir');
if (explicitProfile && isAbsolute(explicitProfile)) app.setPath('userData', explicitProfile);
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
let window: BrowserWindow;
let store: Store;
let vault: Vault;
let remote: Remote;
let encryptionAvailable = false;
let quitting = false;
let transitions = Promise.resolve();
let controls: WebContentsView;
let controlsExpanded = false;
let thumbnails: Thumbnails;
let recording = false;
let buttonPosition = '';
/** Set while the assistive ball is being dragged: where it started and how far it has moved. */
let ballDrag: { start: Electron.Rectangle; dx: number; dy: number } | undefined;
const uiURL = pathToFileURL(join(__dirname, 'ui/index.html')).href;
const controlsURL = pathToFileURL(join(__dirname, 'ui/controls.html')).href;
const controlActions = new Set(['state', 'layout', 'controls', 'ballDrag', 'fullscreen', 'reconnect', 'disconnect']);

const settings = () => store.settings;
const shortcuts = () => effectiveShortcuts(os, settings().shortcuts);
/** Space kept above the desktop for the drag strip when the toolbar is hidden. */
const strip = () => integratedTitleBar && !window.isFullScreen() ? stripHeight : 0;
const macFullscreen = () => os === 'mac' && window.isFullScreen();
/** Layout actually on screen: the saved preference, except that full screen shows the desktop alone. */
const layout = () => effectiveLayout(store.layout, window.isFullScreen());
const controlsInset = () => {
  if (!macFullscreen()) return 0;
  const bounds = window.getBounds();
  return fullscreenInset(bounds.y, screen.getDisplayMatching(bounds).bounds.y);
};
function applyLanguage() { setLanguage(resolveLanguage(settings().language, app.getLocale())); }
function applyTheme() {
  nativeTheme.themeSource = settings().theme;
  if (window && !window.isDestroyed()) window.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1b1c1f' : '#f5f5f7');
}
function state(): AppState {
  const keys = shortcuts();
  const showThumbnails = settings().thumbnails;
  return {
    connections: store.connections.map(connection => ({
      ...connection, savedPassword: vault.hasSaved(connection.id), certificateTrusted: !!store.certificate(connection.id),
      thumbnail: showThumbnails ? thumbnails.stamp(connection.id) : 0
    })),
    status: remote.status, prompt: remote.prompt,
    fullscreen: window.isFullScreen(), encryptionAvailable,
    layout: remote.visible ? layout() : homeLayout, preferredLayout: store.layout, controlsExpanded, controlsInset: controlsInset(), ballSide: store.ball.side,
    platform: { os, name: platformName(os), integratedTitleBar },
    version: app.getVersion(), language: language(), settings: settings(), shortcuts: keys,
    shortcutLabels: Object.fromEntries(commands.map(command => [command, shortcutLabel(os, keys[command])])) as Shortcuts
  };
}
function publish() {
  if (window && !window.isDestroyed() && remote) {
    window.webContents.send('desk:state', state());
    if (controls && !controls.webContents.isDestroyed()) {
      controls.webContents.send('desk:state', state());
      layoutControls();
    }
    placeWindowButtons();
  }
}
/** Keeps the macOS window buttons centred in whichever bar is at the top: the 52 px toolbar or the 28 px strip. */
function placeWindowButtons() {
  if (!integratedTitleBar || window.isFullScreen()) return;
  const slim = remote.visible && !layout().toolbar;
  const position = slim ? { x: 10, y: 7 } : { x: 16, y: 19 };
  const key = `${position.x},${position.y}`;
  if (key === buttonPosition) return;
  buttonPosition = key;
  window.setWindowButtonPosition(position);
}
function trustedSender(event: IpcMainInvokeEvent) {
  return event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === uiURL;
}
function controlSender(event: IpcMainInvokeEvent) {
  return controls && event.sender === controls.webContents && event.senderFrame === controls.webContents.mainFrame && event.senderFrame.url === controlsURL;
}
function layoutControls() {
  // The ball is there whenever the toolbar is not: focus mode in a window as well as full screen.
  const visible = remote.visible && !layout().toolbar;
  controls.setVisible(visible);
  if (!visible) controlsExpanded = false;
  const [width, height] = window.getContentSize();
  const desktop = desktopBounds(width, height, layout(), strip());
  controls.setBounds(ballDrag ? draggedBall(desktop, ballDrag.start, ballDrag.dx, ballDrag.dy, controlsInset()) : ballBounds(desktop, store.ball, controlsExpanded, controlsInset()));
  window.contentView.addChildView(controls);
}
function transition(action: () => Promise<void>) {
  const operation = transitions.then(action);
  transitions = operation.catch(() => {});
  return operation;
}
async function perform(action: Action): Promise<Result> {
  switch (action.type) {
    case 'state': return { ok: true, state: state() };
    case 'save': {
      const old = action.connection.id ? store.get(action.connection.id) : undefined;
      if (old && (old.url !== action.connection.url || old.username !== action.connection.username)) {
        await transition(async () => {
          if (remote.activeID === old.id) await remote.disconnect();
          if (!matchesOrigin(old.url, action.connection.url) || old.username !== action.connection.username) await remote.clearPassword(old.id);
        });
      }
      const connection = store.save(action.connection);
      publish();
      return { ok: true, id: connection.id, state: state() };
    }
    case 'delete':
      await transition(async () => {
        store.get(action.id);
        if (remote.activeID === action.id) await remote.disconnect();
        await remote.clearPassword(action.id);
        await session.fromPartition(`persist:selkies-${action.id}`).clearStorageData();
        store.delete(action.id);
        thumbnails.remove(action.id);
        remote.forget(action.id);
      });
      publish();
      return { ok: true, state: state() };
    case 'connect': await transition(() => remote.connect(action.id)); break;
    case 'disconnect': await transition(() => remote.disconnect()); break;
    case 'reconnect': {
      const id = remote.activeID;
      if (id) await transition(() => remote.connect(id));
      break;
    }
    case 'modal':
      remote.setModal(action.open);
      if (!action.open) recording = false;
      publish();
      break;
    case 'settings': {
      const hadThumbnails = settings().thumbnails;
      store.setSettings(action.settings);
      if (hadThumbnails && !settings().thumbnails) thumbnails.clear();
      applyLanguage();
      applyTheme();
      menu();
      remote.applyKeyPolicy();
      publish();
      break;
    }
    case 'shortcut': {
      const overrides = { ...settings().shortcuts };
      if (action.accelerator === null) delete overrides[action.command];
      else if (!validShortcut(action.accelerator)) throw Error(t('shortcut.invalid'));
      else overrides[action.command] = action.accelerator;
      const next = effectiveShortcuts(os, overrides);
      const clash = commands.find(command => command !== action.command && next[command] === next[action.command]);
      if (clash) throw Error(t('shortcut.duplicate', { name: t(`command.${clash}`) }));
      store.setSettings({ shortcuts: overrides });
      menu();
      publish();
      break;
    }
    case 'recording': recording = action.active; break;
    case 'thumbnail': return { ok: true, text: settings().thumbnails ? thumbnails.dataURL(action.id) : '' };
    case 'layout': {
      const layout = store.layout;
      if (action.target === 'restore') store.setLayout(defaultLayout);
      else if (action.target === 'focus') store.setLayout(layout.sidebar || layout.toolbar ? { sidebar: false, toolbar: false } : defaultLayout);
      else store.setLayout({ ...layout, [action.target]: !layout[action.target] });
      controlsExpanded = false;
      remote.layout();
      publish();
      remote.focus();
      break;
    }
    case 'controls':
      controlsExpanded = action.expanded;
      publish();
      if (!action.expanded) remote.focus();
      break;
    case 'ballDrag': {
      // A drag that starts on an open menu closes it first, so the drag starts from the ball itself.
      if (controlsExpanded) { controlsExpanded = false; layoutControls(); publish(); }
      ballDrag = { start: ballDrag?.start ?? controls.getBounds(), dx: action.dx, dy: action.dy };
      layoutControls();
      if (action.done) {
        const [width, height] = window.getContentSize();
        store.setBall(snapBall(desktopBounds(width, height, layout(), strip()), controls.getBounds()));
        ballDrag = undefined;
        publish();
      }
      return { ok: true };
    }
    case 'fullscreen': window.setFullScreen(!window.isFullScreen()); break;
    case 'answer': remote.answer(action); break;
    case 'clearPassword': store.get(action.id); await transition(() => remote.clearPassword(action.id)); break;
    case 'revokeCertificate': store.get(action.id); await transition(() => remote.revoke(action.id)); break;
    case 'export': {
      const chosen = await dialog.showSaveDialog(window, {
        title: t('export.title'),
        defaultPath: 'selkies-desk-connections.json', filters: [{ name: t('export.filter'), extensions: ['json'] }]
      });
      if (!chosen.canceled && chosen.filePath) {
        writeFileSync(chosen.filePath, store.export(), { mode: 0o600 });
        return { ok: true, message: t('export.done') };
      }
      break;
    }
    case 'import': {
      const chosen = await dialog.showOpenDialog(window, {
        title: t('import.title'), properties: ['openFile'], filters: [{ name: t('export.filter'), extensions: ['json'] }]
      });
      if (chosen.canceled || !chosen.filePaths[0]) break;
      if (statSync(chosen.filePaths[0]).size > 1024 * 1024) throw Error(t('import.tooLarge'));
      const data = parseImport(readFileSync(chosen.filePaths[0], 'utf8'));
      const confirm = await dialog.showMessageBox(window, {
        type: 'question', title: t('import.confirmTitle'), message: t('import.confirmMessage', { count: data.connections.length }),
        detail: t('import.confirmDetail'),
        buttons: [t('ui.cancel'), t('import.add')], defaultId: 0, cancelId: 0
      });
      if (confirm.response === 1) {
        store.import(data);
        publish();
        return { ok: true, state: state(), message: t('import.done', { count: data.connections.length }) };
      }
      break;
    }
  }
  return { ok: true, state: state() };
}
function manage(command: string) {
  window.webContents.send('desk:command', command);
  window.webContents.focus();
}
function run(command: Command) {
  switch (command) {
    case 'new': case 'switcher': case 'settings': manage(command); break;
    case 'reconnect': void perform({ type: 'reconnect' }); break;
    case 'sidebar': case 'toolbar': case 'focus': void perform({ type: 'layout', target: command }); break;
    case 'fullscreen': window.setFullScreen(!window.isFullScreen()); break;
  }
}
/**
 * Management shortcuts are handled here, before any page sees the key. A remote
 * desktop page captures every key press for the remote side, so menu
 * accelerators alone never fire while it has focus.
 */
function intercept(event: Event, input: Input) {
  if (recording || input.type !== 'keyDown') return;
  const command = matchShortcut(input, shortcuts());
  if (!command) return;
  event.preventDefault();
  if (!input.isAutoRepeat) run(command);
}
function menu() {
  const keys = shortcuts();
  const mac = os === 'mac';
  const item = (command: Command, label: string): MenuItemConstructorOptions => ({ label, accelerator: keys[command], click: () => run(command) });
  const manageItems: MenuItemConstructorOptions[] = [item('new', t('menu.new')), item('switcher', t('menu.switcher')), item('settings', t('menu.settings'))];
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    mac ? { label: 'Selkies Desk', submenu: [
      { role: 'about', label: t('menu.about') }, { type: 'separator' }, ...manageItems,
      { type: 'separator' }, { role: 'hide', label: t('menu.hide') },
      { role: 'hideOthers', label: t('menu.hideOthers') }, { role: 'unhide', label: t('menu.unhide') },
      { type: 'separator' }, { role: 'quit', label: t('menu.quit') }
    ] } : { label: t('menu.file'), submenu: [
      ...manageItems, { type: 'separator' }, { role: 'about', label: t('menu.about') },
      { type: 'separator' }, { role: 'quit', label: t('menu.quit') }
    ] },
    { label: t('menu.edit'), submenu: [
      { role: 'undo', label: t('menu.undo') }, { role: 'redo', label: t('menu.redo') }, { type: 'separator' },
      { role: 'cut', label: t('menu.cut') }, { role: 'copy', label: t('menu.copy') }, { role: 'paste', label: t('menu.paste') },
      { role: 'selectAll', label: t('menu.selectAll') }
    ] },
    { label: t('menu.connection'), submenu: [
      item('reconnect', t('menu.reconnect')),
      { label: t('menu.disconnect'), click: () => { void perform({ type: 'disconnect' }); } },
      { type: 'separator' }, { label: t('menu.import'), click: () => { void perform({ type: 'import' }).catch(() => manage('importError')); } },
      { label: t('menu.export'), click: () => { void perform({ type: 'export' }).catch(() => manage('exportError')); } }
    ] },
    { label: t('menu.view'), submenu: [
      item('sidebar', t('menu.sidebar')), item('toolbar', t('menu.toolbar')), item('focus', t('menu.focus')),
      { label: t('menu.regular'), click: () => { void perform({ type: 'layout', target: 'restore' }); } },
      { type: 'separator' }, item('fullscreen', t('menu.fullscreen'))
    ] },
    { label: t('menu.window'), submenu: [{ role: 'minimize', label: t('menu.minimize') }, ...(mac ? [{ role: 'zoom', label: t('menu.zoom') } as MenuItemConstructorOptions] : [])] }
  ]));
}
async function start() {
  store = new Store(app.getPath('userData'));
  thumbnails = new Thumbnails(app.getPath('userData'));
  applyLanguage();
  nativeTheme.themeSource = settings().theme;
  vault = new Vault(app.getPath('userData'), {
    isAsyncEncryptionAvailable: async () => trustedStorage(process.platform, await safeStorage.isAsyncEncryptionAvailable(), () => safeStorage.getSelectedStorageBackend()),
    encryptStringAsync: text => safeStorage.encryptStringAsync(text),
    decryptStringAsync: buffer => safeStorage.decryptStringAsync(buffer)
  });
  // The first Keychain request from a newly signed build can wait on a system prompt.
  // The window must not wait with it, so availability is filled in when it is known.
  void vault.available().then(available => { encryptionAvailable = available; publish(); });
  window = new BrowserWindow({
    title: 'Selkies Desk', width: store.window?.width || 1280, height: store.window?.height || 820,
    minWidth: 960, minHeight: 680, backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1c1f' : '#f5f5f7', show: false,
    ...(integratedTitleBar ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 16, y: 19 } } : {}),
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, navigateOnDragDrop: false }
  });
  // Windows and Linux draw the menu bar inside the window. Keep it hidden so the
  // remote desktop gets the space; shortcuts and toolbar buttons stay available.
  if (os !== 'mac') window.setMenuBarVisibility(false);
  remote = new Remote(window, store, vault, publish, {
    settings, strip, layout, thumbnails, onInput: intercept,
    onLoaded: connection => {
      if (settings().autoFocus) {
        store.setLayout({ sidebar: false, toolbar: false });
        controlsExpanded = false;
        remote.layout();
      }
      if (connection.fullscreen && !window.isFullScreen()) window.setFullScreen(true);
      publish();
    }
  });
  controls = new WebContentsView({
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, navigateOnDragDrop: false }
  });
  controls.setBackgroundColor('#00000000');
  controls.setVisible(false);
  window.contentView.addChildView(controls);
  controls.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  controls.webContents.on('will-navigate', event => event.preventDefault());
  controls.webContents.on('will-attach-webview', event => event.preventDefault());
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('before-input-event', intercept);
  controls.webContents.on('before-input-event', intercept);
  nativeTheme.on('updated', () => { applyTheme(); publish(); });
  ipcMain.handle('desk:invoke', async (event, input: unknown): Promise<Result> => {
    if (!trustedSender(event) && !controlSender(event)) return { ok: false, error: t('error.sender') };
    try {
      const action = actionSchema.parse(input);
      if (controlSender(event) && !controlActions.has(action.type)) return { ok: false, error: t('error.controls') };
      return await perform(action);
    } catch (error) {
      const message = error instanceof z.ZodError
        ? t('error.validation', { issues: error.issues.map(issue => `${issue.path.join('.')} ${issue.message}`).join('; ') })
        : error instanceof SyntaxError ? t('error.json')
        : error instanceof Error && !('code' in error) ? error.message : t('error.generic');
      return { ok: false, error: message };
    }
  });
  window.on('resize', () => { remote.layout(); layoutControls(); });
  window.on('enter-full-screen', () => { controlsExpanded = false; remote.layout(); publish(); });
  window.on('leave-full-screen', () => { buttonPosition = ''; controlsExpanded = false; remote.layout(); publish(); });
  window.on('closed', () => { if (!controls.webContents.isDestroyed()) controls.webContents.close(); });
  window.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    const [width, height] = window.getNormalBounds() ? [window.getNormalBounds().width, window.getNormalBounds().height] : window.getSize();
    store.setWindow(width, height);
    void transition(() => remote.disconnect()).finally(() => window.destroy());
  });
  window.once('ready-to-show', () => window.show());
  menu();
  await controls.webContents.loadURL(controlsURL);
  await window.loadURL(uiURL);
  const automatic = store.connections.find(connection => connection.autoConnect);
  if (automatic) void perform({ type: 'connect', id: automatic.id }).catch(() => {});
}
if (locked) {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(start).catch(() => {
    dialog.showErrorBox(t('error.startTitle'), t('error.startBody'));
    app.quit();
  });
}
