import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConnection, parseImport, settingsPatchSchema, Store, matchesOrigin, matchesNetworkOrigin, trustedCertificate } from '../src/model';
import { Vault } from '../src/vault';
import { Permissions } from '../src/permissions';
import { ballBounds, defaultBall, desktopBounds, draggedBall, effectiveLayout, fullscreenInset, snapBall } from '../src/layout';
import { acceleratorFromInput, defaultShortcuts, effectiveShortcuts, matchShortcut, shortcutLabel, trustedStorage, validShortcut } from '../src/platform';
import { retryable, retryDelay } from '../src/retry';
import { dictionary, messageKeys, resolveLanguage, setLanguage, t } from '../src/i18n';

const input = { name: '工作台', url: 'https://example.test:8443', group: '开发', notes: '', username: 'alice' };

test('地址只接受 HTTP(S) 且不接受 URL 凭据或可能泄露凭据的参数', () => {
  assert.equal(parseConnection(input).url, 'https://example.test:8443/');
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://alice:secret@example.test', 'https://example.test/?token=secret', 'https://example.test/#secret']) {
    assert.throws(() => parseConnection({ ...input, url }));
  }
  assert.throws(() => parseConnection({ ...input, name: '' }));
});

test('同主机不同端口保留为独立连接，导入冲突不覆盖或复用会话 ID', () => {
  const directory = mkdtempSync(join(tmpdir(), 'selkies-model-'));
  try {
    const store = new Store(directory);
    const first = store.save(input);
    store.save({ ...input, url: 'https://example.test:8444' });
    const exported = store.export();
    const imported = store.import(parseImport(exported));
    assert.equal(store.connections.length, 4);
    assert.equal(imported.length, 2);
    assert.notEqual(imported[0].id, first.id);
    assert.equal(imported[0].name, '工作台（导入 2）');
    assert.equal(new Store(directory).connections.length, 4);
    assert.ok(!exported.includes('password'));
    assert.ok(!exported.includes('certificate'));
    assert.throws(() => parseImport('{"version":2,"connections":[]}'));
    assert.throws(() => parseImport(JSON.stringify({ version: 1, connections: [{ ...first, password: 'never-export' }] })));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('信任同时绑定连接、精确 origin 与 SHA256 指纹，改址会撤销', () => {
  const directory = mkdtempSync(join(tmpdir(), 'selkies-trust-'));
  try {
    const store = new Store(directory);
    const connection = store.save(input);
    store.trust(connection.id, 'https://example.test:8443', 'AB:CD');
    assert.equal(trustedCertificate(store, connection.id, 'https://example.test:8443', 'AB:CD'), true);
    assert.equal(trustedCertificate(store, connection.id, 'https://example.test:8444', 'AB:CD'), false);
    assert.equal(trustedCertificate(store, connection.id, 'https://example.test:8443', 'EF:01'), false);
    assert.equal(trustedCertificate(store, 'another-id', 'https://example.test:8443', 'AB:CD'), false);
    store.save({ ...connection, url: 'https://example.test:8444' });
    assert.equal(trustedCertificate(store, connection.id, 'https://example.test:8443', 'AB:CD'), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('origin 比较包含协议和端口，拒绝异常地址', () => {
  assert.equal(matchesOrigin('https://example.test:8443/path', 'https://example.test:8443/'), true);
  assert.equal(matchesOrigin('https://example.test:8444/', 'https://example.test:8443/'), false);
  assert.equal(matchesOrigin('http://example.test:8443/', 'https://example.test:8443/'), false);
  assert.equal(matchesOrigin('not a url', input.url), false);
});

test('同来源 WebSocket 握手沿用 HTTP(S) 来源，其他端口仍被排除', () => {
  assert.equal(matchesNetworkOrigin('wss://example.test:8443/socket', input.url), true);
  assert.equal(matchesNetworkOrigin('wss://example.test:8444/socket', input.url), false);
  assert.equal(matchesNetworkOrigin('ws://example.test:8443/socket', input.url), false);
});

test('加密不可用只存本次会话；更新 origin、用户名或清除后不再返回密码', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'selkies-vault-'));
  try {
    const unavailable = { isAsyncEncryptionAvailable: async () => false, encryptStringAsync: async () => { throw Error('unavailable'); }, decryptStringAsync: async () => { throw Error('unavailable'); } };
    const store = new Store(directory);
    const connection = store.save(input);
    const vault = new Vault(directory, unavailable);
    assert.equal(await vault.set(connection, 'test-only-secret', true), false);
    assert.equal((await vault.get(connection))?.password, 'test-only-secret');
    assert.equal(await new Vault(directory, unavailable).get(connection), undefined);
    assert.equal(await vault.get({ ...connection, username: 'bob' }), undefined);
    assert.equal(await vault.get({ ...connection, url: 'https://elsewhere.test' }), undefined);
    assert.ok(!readFileSync(join(directory, 'connections.json'), 'utf8').includes('test-only-secret'));
    vault.clear(connection.id);
    assert.equal(await vault.get(connection), undefined);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('异步加密过程中清除密码不会被迟到的保存重新写回', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'selkies-race-'));
  try {
    let complete!: (buffer: Buffer) => void;
    let started!: () => void;
    const encrypting = new Promise<void>(resolve => { started = resolve; });
    const cipher = {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async () => {
        started();
        return new Promise<Buffer>(resolve => { complete = resolve; });
      },
      decryptStringAsync: async () => { throw Error('unused'); }
    };
    const connection = new Store(directory).save(input);
    const vault = new Vault(directory, cipher);
    const saving = vault.set(connection, 'fixture-race-secret', true);
    await encrypting;
    vault.clear(connection.id);
    complete(Buffer.from('encrypted-fixture'));
    await saving;
    assert.equal(vault.hasSaved(connection.id), false);
    assert.equal(await vault.get(connection), undefined);
    assert.equal(readFileSync(join(directory, 'credentials.enc.json'), 'utf8'), '{}');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('权限绑定连接及 origin，允许音频不会隐式允许摄像头', () => {
  const permissions = new Permissions();
  const connection = { ...parseConnection(input), id: 'fixture-connection' };
  assert.equal(permissions.allows(connection, input.url, 'clipboard-read'), false);
  permissions.grant(connection, 'clipboard-read');
  permissions.grant(connection, 'media', ['audio']);
  assert.equal(permissions.allows(connection, input.url, 'clipboard-read'), true);
  assert.equal(permissions.allows(connection, input.url, 'media', 'audio'), true);
  assert.equal(permissions.allows(connection, input.url, 'media', 'video'), false);
  assert.equal(permissions.allows(connection, 'https://example.test:8444', 'clipboard-read'), false);
  assert.equal(permissions.allows({ ...connection, id: 'other' }, input.url, 'clipboard-read'), false);
  assert.equal(permissions.allows({ ...connection, url: 'https://elsewhere.test' }, 'https://elsewhere.test', 'clipboard-read'), false);
});

test('并发读取共用决定，拒绝结果在轮询中复用；两种读取事件一致，写权限独立', async () => {
  const permissions = new Permissions();
  const connection = { ...parseConnection(input), id: 'clipboard-poll' };
  let prompts = 0;
  let finish!: (allowed: boolean) => void;
  const ask = () => { prompts++; return new Promise<boolean>(resolve => { finish = resolve; }); };
  const requests = Array.from({ length: 20 }, (_, i) => permissions.request(connection, input.url,
    i % 2 ? 'clipboard-read' : 'deprecated-sync-clipboard-read', [], ask));
  await Promise.resolve();
  assert.equal(prompts, 1);
  finish(false);
  assert.deepEqual(await Promise.all(requests), Array(20).fill(false));
  for (let i = 0; i < 20; i++) assert.equal(await permissions.request(connection, input.url, 'clipboard-read', [], ask), false);
  assert.equal(prompts, 1);
  assert.equal(permissions.allows(connection, input.url, 'deprecated-sync-clipboard-read'), false);
  assert.equal(await permissions.request(connection, input.url, 'clipboard-sanitized-write', [], async () => true), true);
  assert.equal(permissions.allows(connection, input.url, 'clipboard-read'), false);
  permissions.clear();
  assert.equal(await permissions.request(connection, input.url, 'deprecated-sync-clipboard-read', [], async () => true), true);
  assert.equal(permissions.allows(connection, input.url, 'clipboard-read'), true);
  assert.equal(permissions.allows(connection, input.url, 'clipboard-sanitized-write'), false);
});

test('断开立即完成所有待决请求为拒绝，取消弹窗；迟到允许不污染下个会话', async () => {
  const permissions = new Permissions();
  const connection = { ...parseConnection(input), id: 'pending' };
  let finish!: (allowed: boolean) => void;
  let aborted = false;
  let secondPrompts = 0;
  const pending = permissions.request(connection, input.url, 'clipboard-read', [], signal => {
    signal.addEventListener('abort', () => { aborted = true; });
    return new Promise<boolean>(resolve => { finish = resolve; });
  });
  const queued = permissions.request(connection, input.url, 'media', ['audio'], async () => { secondPrompts++; return true; });
  await Promise.resolve();
  permissions.clear();
  assert.deepEqual(await Promise.all([pending, queued]), [false, false]);
  assert.equal(aborted, true);
  finish(true);
  await Promise.resolve();
  assert.equal(secondPrompts, 0);
  assert.equal(permissions.allows(connection, input.url, 'clipboard-read'), false);
  assert.equal(await permissions.request(connection, input.url, 'clipboard-read', [], async () => false), false);
});

test('请求来源、连接和媒体类型隔离，异常弹窗按拒绝复用', async () => {
  const permissions = new Permissions();
  const connection = { ...parseConnection(input), id: 'isolated' };
  assert.equal(await permissions.request(connection, 'https://foreign.test', 'clipboard-read', [], async () => { throw Error('must not ask'); }), false);
  assert.equal(await permissions.request(connection, input.url, 'media', ['audio'], async () => true), true);
  assert.equal(permissions.allows(connection, input.url, 'media', 'video'), false);
  assert.equal(permissions.allows(connection, input.url, 'media', 'unknown'), false);
  assert.equal(permissions.allows({ ...connection, id: 'other' }, input.url, 'media', 'audio'), false);
  assert.equal(await permissions.request(connection, input.url, 'clipboard-read', [], async () => { throw Error('cancelled'); }), false);
  assert.equal(await permissions.request(connection, input.url, 'clipboard-read', [], async () => { throw Error('must not ask again'); }), false);
});

test('侧栏和工具栏分别收起后，远端获得全部释放的真实视图空间', () => {
  assert.deepEqual(desktopBounds(1280, 800, { sidebar: true, toolbar: true }), { x: 232, y: 52, width: 1048, height: 748 });
  assert.deepEqual(desktopBounds(1280, 800, { sidebar: false, toolbar: true }), { x: 0, y: 52, width: 1280, height: 748 });
  assert.deepEqual(desktopBounds(1280, 800, { sidebar: true, toolbar: false }), { x: 232, y: 0, width: 1048, height: 800 });
  assert.deepEqual(desktopBounds(1280, 800, { sidebar: false, toolbar: false }), { x: 0, y: 0, width: 1280, height: 800 });
  // Where the app draws its own title bar, a 28 px drag strip stays above the desktop in windowed focus mode.
  assert.deepEqual(desktopBounds(1280, 800, { sidebar: false, toolbar: false }, 28), { x: 0, y: 28, width: 1280, height: 772 });
  assert.deepEqual(desktopBounds(1280, 800, { sidebar: false, toolbar: true }, 28), { x: 0, y: 52, width: 1280, height: 748 });
});

test('布局选择在重启后恢复，配置导出不包含本机布局偏好', () => {
  const directory = mkdtempSync(join(tmpdir(), 'selkies-layout-'));
  try {
    const store = new Store(directory);
    assert.deepEqual(store.layout, { sidebar: true, toolbar: true });
    store.setLayout({ sidebar: false, toolbar: false });
    assert.deepEqual(new Store(directory).layout, { sidebar: false, toolbar: false });
    assert.equal(store.export().includes('layout'), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('各系统默认快捷键互不重复，避开 Ubuntu 终端快捷键，并按系统显示', () => {
  for (const os of ['mac', 'windows', 'linux'] as const) {
    const accelerators = Object.values(defaultShortcuts(os));
    assert.equal(new Set(accelerators).size, accelerators.length);
    for (const accelerator of accelerators) assert.equal(validShortcut(accelerator), true, accelerator);
    assert.equal(accelerators.includes('Control+Alt+T'), false);
  }
  assert.equal(shortcutLabel('mac', defaultShortcuts('mac').toolbar), '⌘⌥T');
  assert.equal(shortcutLabel('mac', defaultShortcuts('mac').fullscreen), '⌃⌘F');
  assert.equal(shortcutLabel('windows', defaultShortcuts('windows').toolbar), 'Ctrl+Alt+H');
  assert.equal(shortcutLabel('linux', defaultShortcuts('linux').fullscreen), 'F11');
});

test('按物理按键匹配快捷键：Option 改变字符时仍能识别，普通输入不被拦截', () => {
  const keys = defaultShortcuts('mac');
  // On macOS Option+B types “∫”; matching uses the physical key code instead.
  assert.equal(matchShortcut({ code: 'KeyB', meta: true, alt: true }, keys), 'sidebar');
  assert.equal(matchShortcut({ code: 'Enter', meta: true, alt: true }, keys), 'focus');
  assert.equal(matchShortcut({ code: 'KeyF', control: true, meta: true }, keys), 'fullscreen');
  assert.equal(matchShortcut({ code: 'KeyB', meta: true }, keys), undefined);
  assert.equal(matchShortcut({ code: 'KeyB', meta: true, alt: true, shift: true }, keys), undefined);
  assert.equal(matchShortcut({ code: 'KeyB' }, keys), undefined);
  assert.equal(matchShortcut({ code: 'AltLeft', alt: true, meta: true }, keys), undefined);
  assert.equal(matchShortcut({ code: 'F11' }, defaultShortcuts('linux')), 'fullscreen');
});

test('自定义快捷键必须带修饰键或为功能键；无效覆盖回落到默认值', () => {
  assert.equal(acceleratorFromInput({ code: 'KeyJ', control: true, shift: true }), 'Control+Shift+J');
  assert.equal(acceleratorFromInput({ code: 'ShiftLeft', shift: true }), undefined);
  for (const valid of ['Control+Shift+J', 'Alt+1', 'F9', 'Command+Alt+,']) assert.equal(validShortcut(valid), true, valid);
  for (const invalid of ['J', 'Shift+J', 'Control+', 'Control+Control+J', 'Hyper+J', 'Control+Escape']) assert.equal(validShortcut(invalid), false, invalid);
  const keys = effectiveShortcuts('windows', { sidebar: 'Control+Shift+J', toolbar: 'J' });
  assert.equal(keys.sidebar, 'Control+Shift+J');
  assert.equal(keys.toolbar, defaultShortcuts('windows').toolbar);
});

test('中英文词条一一对应，占位符一致；语言跟随系统或手动指定', () => {
  for (const key of messageKeys) {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join();
    assert.ok(dictionary('en')[key], key);
    assert.equal(placeholders(dictionary('en')[key]), placeholders(dictionary('zh')[key]), key);
  }
  assert.equal(resolveLanguage('system', 'zh-CN'), 'zh');
  assert.equal(resolveLanguage('system', 'zh-TW'), 'zh');
  assert.equal(resolveLanguage('system', 'en-US'), 'en');
  assert.equal(resolveLanguage('system', 'de'), 'en');
  assert.equal(resolveLanguage('en', 'zh-CN'), 'en');
  setLanguage('en');
  try { assert.equal(t('import.confirmMessage', { count: 3 }), 'Add 3 entries as new connections?'); } finally { setLanguage('zh'); }
  assert.equal(t('import.confirmMessage', { count: 3 }), '将 3 个条目作为新连接添加？');
});

test('设置有默认值并持久化，不随连接配置导出；旧配置文件可直接读取', () => {
  const directory = mkdtempSync(join(tmpdir(), 'selkies-settings-'));
  try {
    const store = new Store(directory);
    assert.deepEqual(store.settings, { language: 'system', theme: 'system', autoFocus: true, autoReconnect: true, thumbnails: true, passSystemKeys: false, shortcuts: {} });
    store.setSettings({ theme: 'dark', language: 'en', shortcuts: { sidebar: 'Control+Shift+J' } });
    const reopened = new Store(directory);
    assert.equal(reopened.settings.theme, 'dark');
    assert.equal(reopened.settings.language, 'en');
    assert.equal(reopened.settings.shortcuts.sidebar, 'Control+Shift+J');
    assert.equal(store.export().includes('theme'), false);
    assert.throws(() => store.setSettings({ theme: 'sepia' as never }));
    // Changing one setting must leave the others alone.
    assert.deepEqual(settingsPatchSchema.parse({ theme: 'light' }), { theme: 'light' });
    store.setSettings({ autoFocus: false });
    store.setSettings(settingsPatchSchema.parse({ theme: 'light' }));
    assert.equal(store.settings.autoFocus, false);
    assert.throws(() => settingsPatchSchema.parse({ shortcuts: {} }));
    // A 0.3.0 file has neither settings nor the per-connection options.
    writeFileSync(join(directory, 'connections.json'), JSON.stringify({
      version: 1, certificates: {}, layout: { sidebar: true, toolbar: true },
      connections: [{ id: '6f1f3a52-7f0e-4c58-9d55-0d4a1c6f2b11', name: '旧连接', url: 'https://old.test:8443/', group: '', notes: '', username: '' }]
    }));
    const old = new Store(directory);
    assert.equal(old.settings.autoFocus, true);
    assert.deepEqual([old.connections[0].fullscreen, old.connections[0].autoConnect], [false, false]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('启动时自动连接只能指定一个连接，导入的条目不继承该选项', () => {
  const directory = mkdtempSync(join(tmpdir(), 'selkies-auto-'));
  try {
    const store = new Store(directory);
    const first = store.save({ ...input, name: '甲', autoConnect: true });
    const second = store.save({ ...input, name: '乙', autoConnect: true, fullscreen: true });
    assert.equal(store.get(first.id).autoConnect, false);
    assert.equal(store.get(second.id).autoConnect, true);
    assert.equal(store.get(second.id).fullscreen, true);
    const added = store.import(parseImport(store.export()));
    assert.equal(added.some(connection => connection.autoConnect), false);
    assert.equal(store.connections.filter(connection => connection.autoConnect).length, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('自动重连只针对网络类错误，等待时间逐次加长并封顶', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(retryDelay), [2, 4, 8, 16, 30, 30]);
  // Connection refused and network changes are retried; certificate errors and aborts are not.
  assert.deepEqual([-102, -106, -21, -202, -3, -501].map(retryable), [true, true, true, false, false, false]);
});

test('Linux 没有系统密钥环时不把密码写入磁盘，其他系统沿用系统加密', async () => {
  assert.equal(trustedStorage('linux', true, () => 'basic_text'), false);
  assert.equal(trustedStorage('linux', true, () => 'unknown'), false);
  assert.equal(trustedStorage('linux', true, () => 'gnome_libsecret'), true);
  assert.equal(trustedStorage('linux', true, () => 'kwallet6'), true);
  assert.equal(trustedStorage('linux', false, () => 'gnome_libsecret'), false);
  assert.equal(trustedStorage('darwin', true, () => { throw Error('Linux only'); }), true);
  assert.equal(trustedStorage('win32', true, () => { throw Error('Linux only'); }), true);
  const directory = mkdtempSync(join(tmpdir(), 'selkies-linux-vault-'));
  try {
    const vault = new Vault(directory, {
      isAsyncEncryptionAvailable: async () => trustedStorage('linux', true, () => 'basic_text'),
      encryptStringAsync: async () => { throw Error('must not encrypt with a hard-coded key'); },
      decryptStringAsync: async () => { throw Error('unused'); }
    });
    const connection = { ...parseConnection(input), id: 'linux' };
    assert.equal(await vault.set(connection, 'fixture-pass', true), false);
    assert.equal(vault.hasSaved('linux'), false);
    assert.equal(readFileSync(join(directory, 'credentials.enc.json'), 'utf8').includes('fixture-pass'), false);
    assert.equal((await vault.get(connection))?.password, 'fixture-pass');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('全屏只显示桌面；悬浮球靠边停放、可拖动吸附，展开的按钮向内生长，并避开 macOS 全屏顶部被遮挡的区域', () => {
  // The saved layout preference is untouched; only what is drawn changes.
  const preferred = { sidebar: true, toolbar: true };
  assert.deepEqual(effectiveLayout(preferred, true), { sidebar: false, toolbar: false });
  assert.deepEqual(effectiveLayout(preferred, false), preferred);
  const desktop = desktopBounds(1440, 900, effectiveLayout(preferred, true));
  assert.deepEqual(desktop, { x: 0, y: 0, width: 1440, height: 900 });
  // Resting: a 44 px ball against the right edge, 30 % down.
  assert.deepEqual(defaultBall, { side: 'right', y: 0.3 });
  assert.deepEqual(ballBounds(desktop, defaultBall, false), { x: 1440 - 44 - 10, y: 270, width: 44, height: 44 });
  // Opened: same height, same edge; the row grows inwards so the ball's place does not jump.
  assert.deepEqual(ballBounds(desktop, defaultBall, true), { x: 1440 - 320 - 10, y: 270, width: 320, height: 44 });
  assert.deepEqual(ballBounds(desktop, { side: 'left', y: 0.3 }, true), { x: 10, y: 270, width: 320, height: 44 });
  // It follows the sidebar: positions are relative to the desktop, not the window.
  const beside = desktopBounds(1440, 900, { sidebar: true, toolbar: false }, 28);
  assert.deepEqual(ballBounds(beside, { side: 'left', y: 0 }, false), { x: 242, y: 38, width: 44, height: 44 });
  // What macOS covers at the top of a full-screen window: the title strip (31 px measured), plus
  // the menu bar where it slides over the window instead of sitting in the camera-housing band.
  assert.equal(fullscreenInset(33, 0), 34);
  assert.equal(fullscreenInset(0, 0), 58);
  // A ball parked at the very top or bottom is kept clear of that strip and of the screen edge.
  assert.equal(ballBounds(desktop, { side: 'right', y: 0 }, false, 34).y, 44);
  assert.equal(ballBounds(desktop, { side: 'right', y: 1 }, false).y, 900 - 44 - 10);
  // Dragging follows the pointer but stays on the desktop; dropping snaps to the nearer side.
  const start = ballBounds(desktop, defaultBall, false);
  assert.deepEqual(draggedBall(desktop, start, -900, 200), { x: 486, y: 470, width: 44, height: 44 });
  assert.deepEqual(draggedBall(desktop, start, 500, -5000, 34), { x: 1396, y: 34, width: 44, height: 44 });
  assert.deepEqual(snapBall(desktop, draggedBall(desktop, start, -900, 200)), { side: 'left', y: 470 / 900 });
  assert.equal(snapBall(desktop, draggedBall(desktop, start, -300, 0)).side, 'right');
  assert.equal(ballBounds({ x: 0, y: 0, width: 200, height: 300 }, defaultBall, true).width, 180);
});

test('悬浮球位置随配置保存，不随连接配置导出', () => {
  const directory = mkdtempSync(join(tmpdir(), 'selkies-ball-'));
  try {
    const store = new Store(directory);
    assert.deepEqual(store.ball, defaultBall);
    store.setBall({ side: 'left', y: 0.62 });
    assert.deepEqual(new Store(directory).ball, { side: 'left', y: 0.62 });
    assert.equal(store.export().includes('ball'), false);
    assert.throws(() => store.setBall({ side: 'top' as never, y: 0.5 }));
    assert.throws(() => store.setBall({ side: 'left', y: 3 }));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
