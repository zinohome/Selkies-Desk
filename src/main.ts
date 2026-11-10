import { app, BrowserWindow, WebContentsView, dialog, ipcMain, Menu, safeStorage, session, type IpcMainInvokeEvent } from 'electron';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { Store, matchesOrigin, parseImport } from './model';
import { Vault } from './vault';
import { Remote } from './remote';
import { actionSchema, type Action, type AppState, type Result } from './protocol';
import { defaultLayout, desktopBounds } from './layout';

app.setName('Selkies Desk');
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
const uiURL = pathToFileURL(join(__dirname, 'ui/index.html')).href;
const controlsURL = pathToFileURL(join(__dirname, 'ui/controls.html')).href;
const controlActions = new Set(['state', 'layout', 'controls', 'fullscreen', 'reconnect', 'disconnect']);

function state(): AppState {
  return {
    connections: store.connections.map(connection => ({
      ...connection, savedPassword: vault.hasSaved(connection.id), certificateTrusted: !!store.certificate(connection.id)
    })),
    status: remote.status, prompt: remote.prompt,
    fullscreen: window.isFullScreen(), encryptionAvailable,
    layout: remote.visible ? store.layout : defaultLayout, preferredLayout: store.layout, controlsExpanded
  };
}
function publish() {
  if (window && !window.isDestroyed() && remote) {
    window.webContents.send('desk:state', state());
    if (controls && !controls.webContents.isDestroyed()) {
      controls.webContents.send('desk:state', state());
      layoutControls();
    }
  }
}
function trustedSender(event: IpcMainInvokeEvent) {
  return event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === uiURL;
}
function controlSender(event: IpcMainInvokeEvent) {
  return controls && event.sender === controls.webContents && event.senderFrame === controls.webContents.mainFrame && event.senderFrame.url === controlsURL;
}
function layoutControls() {
  const visible = remote.visible && !store.layout.toolbar;
  controls.setVisible(visible);
  if (!visible) controlsExpanded = false;
  const [width, height] = window.getContentSize();
  const desktop = desktopBounds(width, height, store.layout);
  const panelWidth = controlsExpanded ? Math.min(660, desktop.width) : 64;
  controls.setBounds({ x: desktop.x + Math.round((desktop.width - panelWidth) / 2), y: 0, width: panelWidth, height: controlsExpanded ? 48 : 22 });
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
    case 'modal': remote.setModal(action.open); publish(); break;
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
    case 'fullscreen': window.setFullScreen(!window.isFullScreen()); break;
    case 'answer': remote.answer(action); break;
    case 'clearPassword': store.get(action.id); await transition(() => remote.clearPassword(action.id)); break;
    case 'revokeCertificate': store.get(action.id); await transition(() => remote.revoke(action.id)); break;
    case 'export': {
      const chosen = await dialog.showSaveDialog(window, {
        title: '导出连接配置（不含密码、Cookie 或证书信任）',
        defaultPath: 'selkies-desk-connections.json', filters: [{ name: 'JSON 配置', extensions: ['json'] }]
      });
      if (!chosen.canceled && chosen.filePath) {
        writeFileSync(chosen.filePath, store.export(), { mode: 0o600 });
        return { ok: true, message: '配置已导出，不含密码、Cookie 或证书信任。' };
      }
      break;
    }
    case 'import': {
      const chosen = await dialog.showOpenDialog(window, {
        title: '导入连接配置', properties: ['openFile'], filters: [{ name: 'JSON 配置', extensions: ['json'] }]
      });
      if (chosen.canceled || !chosen.filePaths[0]) break;
      if (statSync(chosen.filePaths[0]).size > 1024 * 1024) throw Error('配置文件不能大于 1 MB。');
      const data = parseImport(readFileSync(chosen.filePaths[0], 'utf8'));
      const confirm = await dialog.showMessageBox(window, {
        type: 'question', title: '确认导入', message: `将 ${data.connections.length} 个条目作为新连接添加？`,
        detail: '保留现有连接。重名条目加“导入”后缀；每个导入条目获得新的独立会话，不导入密码、Cookie 或证书信任。',
        buttons: ['取消', '添加新连接'], defaultId: 0, cancelId: 0
      });
      if (confirm.response === 1) {
        store.import(data);
        publish();
        return { ok: true, state: state(), message: `已添加 ${data.connections.length} 个独立连接。` };
      }
      break;
    }
  }
  return { ok: true, state: state() };
}
function menu() {
  const manage = (command: string) => {
    if (command === 'search') {
      store.setLayout({ ...store.layout, sidebar: true });
      remote.layout();
      publish();
    }
    window.webContents.send('desk:command', command);
    window.webContents.focus();
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Selkies Desk', submenu: [
      { role: 'about', label: '关于 Selkies Desk' }, { type: 'separator' },
      { label: '新增连接…', accelerator: 'Command+Alt+N', click: () => manage('new') },
      { label: '搜索连接', accelerator: 'Command+Alt+L', click: () => manage('search') },
      { type: 'separator' }, { role: 'hide', label: '隐藏 Selkies Desk' },
      { role: 'hideOthers', label: '隐藏其他' }, { role: 'unhide', label: '显示全部' },
      { type: 'separator' }, { role: 'quit', label: '退出 Selkies Desk' }
    ] },
    { label: '编辑', submenu: [
      { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' }
    ] },
    { label: '连接', submenu: [
      { label: '重连当前服务器', accelerator: 'Command+Alt+R', click: () => { void perform({ type: 'reconnect' }); } },
      { label: '断开当前服务器', click: () => { void perform({ type: 'disconnect' }); } },
      { type: 'separator' }, { label: '导入配置…', click: () => { void perform({ type: 'import' }).catch(() => manage('importError')); } },
      { label: '导出配置…', click: () => { void perform({ type: 'export' }).catch(() => manage('exportError')); } }
    ] },
    { label: '显示', submenu: [
      { label: '显示或隐藏侧栏', accelerator: 'Command+Alt+B', click: () => { void perform({ type: 'layout', target: 'sidebar' }); } },
      { label: '显示或隐藏工具栏', accelerator: 'Command+Alt+T', click: () => { void perform({ type: 'layout', target: 'toolbar' }); } },
      { label: '切换专注模式', accelerator: 'Command+Alt+Enter', click: () => { void perform({ type: 'layout', target: 'focus' }); } },
      { label: '恢复完整布局', click: () => { void perform({ type: 'layout', target: 'restore' }); } }
    ] },
    { label: '窗口', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放' }, { role: 'togglefullscreen', label: '切换全屏' }] }
  ]));
}
async function start() {
  store = new Store(app.getPath('userData'));
  vault = new Vault(app.getPath('userData'), safeStorage);
  encryptionAvailable = await vault.available();
  window = new BrowserWindow({
    title: 'Selkies Desk', width: store.window?.width || 1280, height: store.window?.height || 820,
    minWidth: 960, minHeight: 680, backgroundColor: '#f4f6f8', show: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false, navigateOnDragDrop: false }
  });
  remote = new Remote(window, store, vault, publish);
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
  ipcMain.handle('desk:invoke', async (event, input: unknown): Promise<Result> => {
    if (!trustedSender(event) && !controlSender(event)) return { ok: false, error: '管理请求来源无效。' };
    try {
      const action = actionSchema.parse(input);
      if (controlSender(event) && !controlActions.has(action.type)) return { ok: false, error: '悬浮操作条无权执行此操作。' };
      return await perform(action);
    } catch (error) {
      const message = error instanceof z.ZodError
        ? `字段校验失败：${error.issues.map(issue => `${issue.path.join('.')} ${issue.message}`).join('；')}`
        : error instanceof SyntaxError ? 'JSON 格式无效。'
        : error instanceof Error && !('code' in error) ? error.message : '操作失败，请检查文件访问权限及磁盘空间。';
      return { ok: false, error: message };
    }
  });
  window.on('resize', () => { remote.layout(); layoutControls(); });
  window.on('enter-full-screen', () => { remote.layout(); publish(); });
  window.on('leave-full-screen', () => { remote.layout(); publish(); });
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
}
if (locked) {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(start).catch(() => {
    dialog.showErrorBox('Selkies Desk 无法启动', '无法读取本地配置或建立窗口。为保护现有数据，应用不会自动覆盖配置。请备份并检查用户数据目录后重试。');
    app.quit();
  });
}
