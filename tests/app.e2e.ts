import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { MockDesktop, certificate } from './fixtures';

test.describe.serial('客户端真实 Electron 行为', () => {
  let application: ElectronApplication;
  let ui: Page;
  let first: MockDesktop;
  let second: MockDesktop;
  let tls: MockDesktop;
  let directory: string;
  let aliceID: string;
  let bobID: string;
  let tlsID: string;
  const evidence = resolve('.qa/evidence');
  // Where the app draws its own title bar, windowed focus mode keeps a slim drag strip above the desktop.
  const strip = process.platform === 'darwin' ? 28 : 0;
  const invoke = (action: unknown) => ui.evaluate(async value => (window as any).desk.invoke(value), action);
  // Playwright injects keys below the point where Electron offers them to the main process,
  // so shortcut tests send native-style input events through the same path as a real keyboard.
  const pressKey = (target: 'remote' | 'ui', keyCode: string, modifiers: string[] = []) => application.evaluate(({ webContents, BrowserWindow }, key) => {
    const contents = key.target === 'ui' ? BrowserWindow.getAllWindows()[0].webContents
      : webContents.getAllWebContents().find(contents => /^https?:/.test(contents.getURL()))!;
    contents.sendInputEvent({ type: 'keyDown', keyCode: key.keyCode, modifiers: key.modifiers } as any);
    contents.sendInputEvent({ type: 'keyUp', keyCode: key.keyCode, modifiers: key.modifiers } as any);
  }, { target, keyCode, modifiers });
  const primary = process.platform === 'darwin' ? 'meta' : 'control';
  const isFullScreen = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen());
  // The controls slide in; positions are only meaningful once that short animation has finished.
  const settled = (locator: ReturnType<Page['locator']>) => locator.evaluate(element =>
    Promise.all((element.closest('nav')?.getAnimations({ subtree: true }) ?? []).map(animation => animation.finished)).then(() => undefined));
  const controlsPage = () => application.windows().find(window => window.url().endsWith('/controls.html'))!;
  // Where the session buttons live while the toolbar is hidden: in the slim title strip of a macOS
  // window, otherwise (other systems, and full screen everywhere) in the floating controls.
  const sessionButton = async (name: string) => {
    if (strip && !(await isFullScreen())) return ui.locator('.strip').getByRole('button', { name, exact: true });
    const page = controlsPage();
    if (!(await state()).controlsExpanded) await page.evaluate(() => (window as any).desk.invoke({ type: 'controls', expanded: true }));
    return page.getByRole('button', { name, exact: true });
  };
  // macOS cannot move a window into full screen while the screen is locked. Those steps are
  // skipped then and recorded as an annotation, so a locked machine is never reported as a pass.
  const fullscreenAvailable = () => {
    if (process.platform !== 'darwin') return true;
    const locked = /CGSSessionScreenIsLocked<\/key>\s*<true\/>/.test(execFileSync('/usr/sbin/ioreg', ['-n', 'Root', '-d1', '-a'], { encoding: 'utf8' }));
    if (locked) test.info().annotations.push({ type: 'skipped-step', description: '屏幕已锁定，未执行全屏步骤' });
    return !locked;
  };
  const remoteBounds = () => application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const child = window.contentView.children.find(child => 'webContents' in child && /^https?:/.test((child as any).webContents.getURL()))!;
    return { bounds: child.getBounds(), size: window.getContentSize(), visible: child.getVisible() };
  });
  const launch = () => electron.launch({
    ...(process.env.SELKIES_PACKAGED_PATH ? { executablePath: process.env.SELKIES_PACKAGED_PATH } : {}),
    args: [...(process.env.SELKIES_PACKAGED_PATH ? [] : [resolve('.')]), `--user-data-dir=${join(directory, 'profile')}`],
    // Playwright otherwise pins pages to the light scheme, which would hide the app's own theme switch.
    colorScheme: null,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' }
  });

  const state = () => ui.evaluate(async () => (await (window as any).desk.invoke({ type: 'state' })).state);
  const management = async () => {
    await expect.poll(() => application.windows().some(window => window.url().endsWith('/index.html'))).toBe(true);
    return application.windows().find(window => window.url().endsWith('/index.html'))!;
  };
  const remote = async () => {
    await expect.poll(() => application.windows().some(window => window !== ui && /^https?:/.test(window.url()))).toBe(true);
    return application.windows().find(window => window !== ui && /^https?:/.test(window.url()))!;
  };
  async function add(name: string, url: string, username = 'alice') {
    await ui.getByRole('button', { name: '新增连接', exact: true }).click();
    await ui.getByLabel('连接名称').fill(name);
    await ui.getByLabel('服务器地址').fill(url);
    await ui.getByLabel('分组', { exact: true }).fill('模拟环境');
    await ui.getByLabel('用户名', { exact: true }).fill(username);
    await ui.getByRole('button', { name: '保存连接', exact: true }).click();
    await expect(ui.getByRole('button', { name, exact: true })).toBeVisible();
    return (await state()).connections.find((connection: any) => connection.name === name).id as string;
  }
  async function login(password = 'fixture-pass', remember = false) {
    await expect(ui.getByRole('heading', { name: /服务器认证/ })).toBeVisible();
    await ui.getByLabel('认证密码').fill(password);
    if (remember) await ui.getByLabel('加密记住密码').check();
    await ui.getByRole('button', { name: '登录', exact: true }).click();
  }
  test.beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'selkies-e2e-'));
    // The suite drives the Chinese interface and the classic layout; later tests turn individual settings on.
    mkdirSync(join(directory, 'profile'), { recursive: true });
    writeFileSync(join(directory, 'profile', 'connections.json'), JSON.stringify({
      version: 1, connections: [], certificates: {}, layout: { sidebar: true, toolbar: true },
      settings: { language: 'zh', theme: 'light', autoFocus: false, autoReconnect: false }
    }));
    mkdirSync(evidence, { recursive: true });
    second = await new MockDesktop().start();
    first = new MockDesktop();
    first.foreignOrigin = second.origin;
    await first.start();
    tls = await new MockDesktop(certificate(directory, 'mock-one')).start();
    application = await launch();
    ui = await management();
    await expect(ui.getByText('还没有连接', { exact: true })).toBeVisible();
  });
  test.afterAll(async () => {
    if (application) await application.close();
    await Promise.all([first?.stop(), second?.stop(), tls?.stop()]);
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  test('中文空状态、连接管理、同源条目以及分组搜索', async () => {
    await ui.screenshot({ path: join(evidence, '01-empty.png') });
    aliceID = await add('研发工作台 · Alice', first.origin);
    bobID = await add('研发工作台 · Bob', first.origin, 'bob');
    await add('第二台服务器', second.origin);
    tlsID = await add('自签名测试', tls.origin);
    await ui.getByPlaceholder('搜索名称、地址或分组').fill('Bob');
    await expect(ui.getByRole('button', { name: '研发工作台 · Bob', exact: true })).toBeVisible();
    await expect(ui.getByRole('button', { name: '研发工作台 · Alice', exact: true })).toBeHidden();
    await ui.getByPlaceholder('搜索名称、地址或分组').fill('');
    await ui.screenshot({ path: join(evidence, '02-connections.png') });
  });

  test('Basic 密码错误可重试，加密保存不含明文；页面加载状态准确', async () => {
    await ui.getByRole('button', { name: '研发工作台 · Alice', exact: true }).click();
    await login('wrong-fixture-pass');
    await expect(ui.getByText('认证未通过，请重新输入。')).toBeVisible();
    await login('fixture-pass', true);
    await expect(ui.getByText('页面已加载', { exact: true })).toBeVisible();
    const page = await remote();
    await expect(page.getByRole('heading', { name: '本地模拟桌面 · alice' })).toBeVisible();
    await expect.poll(() => first.webSockets).toBe(1);
    expect(first.failedAuth).toBeGreaterThan(0);
    expect(readFileSync(join(directory, 'profile', 'credentials.enc.json'), 'utf8')).not.toContain('fixture-pass');
    await page.getByRole('button', { name: '切换 DPI 设置' }).click();
  });

  test('同源账号会话隔离，切换真正关闭旧流和 WebContents', async () => {
    const previous = await remote();
    await ui.getByRole('button', { name: '研发工作台 · Bob', exact: true }).click();
    await login();
    const page = await remote();
    await expect(page.getByRole('heading', { name: '本地模拟桌面 · bob' })).toBeVisible();
    await expect(page.locator('#isolation')).toHaveText('previous=null; cookie=');
    expect(await page.evaluate(() => localStorage.getItem('dpi'))).toBeNull();
    await expect.poll(() => first.streams).toBe(1);
    await expect.poll(() => first.webSockets).toBe(1);
    expect(previous.isClosed()).toBe(true);
    await page.getByRole('button', { name: '切换 DPI 设置' }).click();
    await ui.getByRole('button', { name: '研发工作台 · Alice', exact: true }).click();
    await expect(ui.getByText('页面已加载', { exact: true })).toBeVisible();
    const restored = await remote();
    expect(await restored.evaluate(() => localStorage.getItem('dpi'))).toBe('2');
    await expect(restored.locator('#isolation')).toContainText('previous=alice; cookie=account=alice');
  });

  test('远端无 Node 或管理 IPC；跨源子请求不携带 Authorization', async () => {
    const page = await remote();
    expect(await page.evaluate(() => ({
      require: typeof (window as any).require,
      process: typeof (window as any).process,
      desk: typeof (window as any).desk
    }))).toEqual({ require: 'undefined', process: 'undefined', desk: 'undefined' });
    await expect.poll(() => second.foreignRequests).toBeGreaterThan(0);
    expect(second.receivedForeignAuth).toBe(false);
    expect(second.receivedForeignCookie).toBe(false);
    const result = await ui.evaluate(() => (window as any).desk.invoke({ type: 'save', connection: { name: '恶意', url: 'file:///etc/passwd' } }));
    expect(result.ok).toBe(false);
    expect((await state()).connections).toHaveLength(4);
  });

  test('第二个模拟服务认证隔离，切换服务时只保留一个流', async () => {
    await ui.getByRole('button', { name: '第二台服务器', exact: true }).click();
    await login();
    const page = await remote();
    await expect(page.locator('#isolation')).toHaveText('previous=null; cookie=');
    await expect.poll(() => second.streams).toBe(1);
    await expect.poll(() => first.streams).toBe(0);
    await expect.poll(() => first.webSockets).toBe(0);
    await ui.getByRole('button', { name: '研发工作台 · Alice', exact: true }).click();
    await expect(ui.getByText('页面已加载', { exact: true })).toBeVisible();
    await expect.poll(() => second.streams).toBe(0);
  });

  test('上传入口保留；下载保存到选择的位置且内容正确', async () => {
    const page = await remote();
    const upload = join(directory, 'upload-demo.txt');
    const download = join(directory, 'chosen-download.txt');
    writeFileSync(upload, '模拟上传文件');
    await page.getByLabel('上传文件').setInputFiles(upload);
    expect(await page.getByLabel('上传文件').evaluate((control: HTMLInputElement) => control.files?.[0].name)).toBe('upload-demo.txt');
    await application.evaluate(({ session }, { id, path }) => {
      session.fromPartition(`persist:selkies-${id}`).once('will-download', (_event, item) => item.setSavePath(path));
    }, { id: aliceID, path: download });
    await page.getByRole('link', { name: '下载文件' }).click();
    await expect.poll(() => { try { return readFileSync(download, 'utf8'); } catch { return ''; } }).toBe('Mock desktop download');
  });

  test('剪贴板默认允许：持续轮询与并发读写均不询问，重连后仍可用', async () => {
    await application.evaluate(async ({ dialog, clipboard, ClipboardItem, session }, id) => {
      const memory = globalThis as any;
      const partition = session.fromPartition(`persist:selkies-${id}`);
      memory.originalCheckSetter = partition.setPermissionCheckHandler.bind(partition);
      memory.originalRequestSetter = partition.setPermissionRequestHandler.bind(partition);
      memory.permissionEvents = [];
      partition.setPermissionCheckHandler = ((handler: any) => {
        memory.checkHandler = handler;
        memory.originalCheckSetter((...args: any[]) => {
          const result = handler(...args);
          memory.permissionEvents.push({ stage: 'check', permission: args[1], origin: args[2], result });
          return result;
        });
      }) as typeof partition.setPermissionCheckHandler;
      partition.setPermissionRequestHandler = ((handler: any) => {
        memory.requestHandler = handler;
        memory.originalRequestSetter((...args: any[]) => {
          memory.permissionEvents.push({ stage: 'request', permission: args[1], origin: args[3].requestingUrl });
          handler(...args);
        });
      }) as typeof partition.setPermissionRequestHandler;
      memory.originalPermissionDialog = dialog.showMessageBox;
      memory.clipboardSnapshot = await Promise.all((await clipboard.read()).filter(item => item.types.length).map(async item => {
        const entries = await Promise.all(item.types.map(async type => [type, await item.getType(type)]));
        return new ClipboardItem(Object.fromEntries(entries));
      }));
      memory.permissionPrompts = 0;
      await clipboard.writeText('fixture-剪贴板');
      dialog.showMessageBox = (async (...args: any[]) => {
        if ((args[1] || args[0]).title === '远端权限请求') {
          memory.permissionPrompts++;
          return { response: 0, checkboxChecked: false };
        }
        return memory.originalPermissionDialog(...args);
      }) as typeof dialog.showMessageBox;
    }, aliceID);
    try {
      for (let session = 0; session < 2; session++) {
        await ui.getByRole('button', { name: '重连', exact: true }).click();
        await expect(ui.getByText('页面已加载', { exact: true })).toBeVisible();
        const page = await remote();
        await page.getByLabel('远端输入').click();
        const results = await page.evaluate(async () => {
          const read = () => navigator.clipboard.readText().catch(() => 'denied');
          const values = await Promise.all(Array.from({ length: 32 }, read));
          for (let i = 0; i < 50; i++) {
            await new Promise(resolve => setTimeout(resolve, 20));
            values.push(await read());
          }
          return values;
        });
        expect(results).toEqual(Array(82).fill('fixture-剪贴板'));
        expect(await application.evaluate(() => (globalThis as any).permissionPrompts)).toBe(0);
      }
      const page = await remote();
      await page.getByRole('button', { name: '写入剪贴板' }).click();
      await expect(page.locator('#clip')).toHaveText('copied');
      expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe('模拟剪贴板 中文');
      const writes = await page.evaluate(async () => Promise.all(Array.from({ length: 16 }, () =>
        navigator.clipboard.writeText('模拟剪贴板 中文').then(() => true, () => false))));
      expect(writes).toEqual(Array(16).fill(true));
      // Chromium may disable execCommand('paste') before any permission event.
      // Test native paste independently, and record which events actually fire.
      await page.getByLabel('远端输入').click();
      const legacy = await page.evaluate(() => document.execCommand('paste'));
      const events = await application.evaluate(() => (globalThis as any).permissionEvents);
      writeFileSync(join(evidence, 'clipboard-events.json'), JSON.stringify({ legacy, events }, null, 2));
      await application.evaluate(({ webContents }) => {
        webContents.getAllWebContents().find(contents => /^https?:/.test(contents.getURL()))!.paste();
      });
      await expect(page.getByLabel('远端输入')).toHaveValue('模拟剪贴板 中文');
      expect(await application.evaluate(() => (globalThis as any).permissionPrompts)).toBe(0);
    } finally {
      await application.evaluate(async ({ dialog, clipboard, session }, id) => {
        const memory = globalThis as any;
        const partition = session.fromPartition(`persist:selkies-${id}`);
        partition.setPermissionCheckHandler = memory.originalCheckSetter;
        partition.setPermissionRequestHandler = memory.originalRequestSetter;
        dialog.showMessageBox = memory.originalPermissionDialog;
        if (memory.clipboardSnapshot.length) await clipboard.write(memory.clipboardSnapshot);
        else clipboard.clear();
        delete memory.clipboardSnapshot;
      }, aliceID);
    }
  });

  test('剪贴板检查与请求边界一致，其他权限拒绝复用且并发只询问一次；断开使旧处理器失效', async () => {
    const result = await application.evaluate(async ({ webContents, BrowserWindow, dialog }, origin) => {
      const memory = globalThis as any;
      const remote = webContents.getAllWebContents().find(contents => /^https?:/.test(contents.getURL()))!;
      const local = BrowserWindow.getAllWindows()[0].webContents;
      const check = memory.checkHandler;
      const request = memory.requestHandler;
      const call = (contents: any, permission: string, url: string) => new Promise<boolean>(resolve => {
        request(contents, permission, resolve, { requestingUrl: url, isMainFrame: true });
      });
      const clipboard = [];
      for (const permission of ['clipboard-read', 'clipboard-sanitized-write', 'deprecated-sync-clipboard-read']) {
        clipboard.push({
          allowed: await call(remote, permission, origin),
          checked: check(remote, permission, origin, { requestingUrl: origin, isMainFrame: true }),
          foreign: await call(remote, permission, 'https://foreign.invalid/'),
          local: await call(local, permission, origin),
          worker: check(null, permission, origin, { isMainFrame: false }),
          foreignCheck: check(remote, permission, 'https://foreign.invalid', { isMainFrame: false })
        });
      }
      let prompts = 0;
      const original = dialog.showMessageBox;
      dialog.showMessageBox = (async () => { prompts++; return { response: 0, checkboxChecked: false }; }) as typeof dialog.showMessageBox;
      try {
        const denied = await Promise.all(Array.from({ length: 20 }, () => call(remote, 'pointerLock', origin)));
        denied.push(await call(remote, 'pointerLock', origin));
        const media = check(remote, 'media', origin, { mediaType: 'audio', isMainFrame: true });
        const unknown = await call(remote, 'geolocation', origin);
        memory.boundaryCall = () => call(remote, 'clipboard-read', origin);
        return { clipboard, denied, prompts, media, unknown };
      } finally { dialog.showMessageBox = original; }
    }, first.origin);
    expect(result.clipboard).toEqual(Array(3).fill({ allowed: true, checked: true, foreign: false, local: false, worker: false, foreignCheck: false }));
    expect(result.denied).toEqual(Array(21).fill(false));
    expect(result.prompts).toBe(1);
    expect(result.media).toBe(false);
    expect(result.unknown).toBe(false);
    await ui.getByRole('button', { name: '断开', exact: true }).click();
    expect(await application.evaluate(() => (globalThis as any).boundaryCall())).toBe(false);
    await ui.getByRole('button', { name: '重连', exact: true }).click();
    await expect(ui.getByText('页面已加载', { exact: true })).toBeVisible();
  });

  test('刷新、断开和页面销毁会关闭真实原生权限弹窗，待决回调只拒绝一次', async () => {
    await application.evaluate(({ session, dialog }, id) => {
      const memory = globalThis as any;
      const partition = session.fromPartition(`persist:selkies-${id}`);
      memory.lifecycleSetter = partition.setPermissionRequestHandler.bind(partition);
      partition.setPermissionRequestHandler = ((handler: any) => {
        memory.lifecycleRequest = handler;
        memory.lifecycleSetter(handler);
      }) as typeof partition.setPermissionRequestHandler;
      memory.lifecycleDialog = dialog.showMessageBox;
      dialog.showMessageBox = ((...args: any[]) => {
        const options = args[1] || args[0];
        const promise = memory.lifecycleDialog(...args);
        if (options.title === '远端权限请求') {
          memory.nativeSignal = options.signal;
          memory.nativeClosed = false;
          void promise.then(() => { memory.nativeClosed = true; });
        }
        return promise;
      }) as typeof dialog.showMessageBox;
    }, aliceID);
    try {
      for (const action of ['refresh', 'disconnect', 'destroy']) {
        await ui.getByRole('button', { name: '重连', exact: true }).click();
        await expect(ui.getByText('页面已加载', { exact: true })).toBeVisible();
        await application.evaluate(({ webContents }, origin) => {
          const memory = globalThis as any;
          memory.lifecycleResults = [];
          const contents = webContents.getAllWebContents().find(contents => /^https?:/.test(contents.getURL()))!;
          // Call our registered boundary with real WebContents and a real native dialog.
          for (let i = 0; i < 10; i++) memory.lifecycleRequest(contents, 'pointerLock',
            (allowed: boolean) => memory.lifecycleResults.push(allowed), { requestingUrl: origin, isMainFrame: true });
        }, first.origin);
        await expect.poll(() => application.evaluate(() => !!(globalThis as any).nativeSignal && !(globalThis as any).nativeClosed)).toBe(true);
        if (action === 'disconnect') await ui.evaluate(() => (window as any).desk.invoke({ type: 'disconnect' }));
        else await application.evaluate(({ webContents }, action) => {
          const contents = webContents.getAllWebContents().find(contents => /^https?:/.test(contents.getURL()))!;
          if (action === 'refresh') contents.reload();
          else contents.close({ waitForBeforeUnload: false });
        }, action);
        await expect.poll(() => application.evaluate(() => ({
          results: (globalThis as any).lifecycleResults,
          aborted: (globalThis as any).nativeSignal.aborted,
          closed: (globalThis as any).nativeClosed
        }))).toEqual({ results: Array(10).fill(false), aborted: true, closed: true });
      }
    } finally {
      await application.evaluate(({ session, dialog }, id) => {
        const memory = globalThis as any;
        session.fromPartition(`persist:selkies-${id}`).setPermissionRequestHandler = memory.lifecycleSetter;
        dialog.showMessageBox = memory.lifecycleDialog;
      }, aliceID);
      const reconnected = await ui.evaluate(() => (window as any).desk.invoke({ type: 'reconnect' }));
      expect(reconnected.error).toBeUndefined();
      expect(reconnected).toMatchObject({ ok: true });
      await expect(ui.getByText('页面已加载', { exact: true })).toBeVisible();
    }
  });

  test('跨源重定向被阻止，新窗口不覆盖管理界面', async () => {
    const page = await remote();
    await application.evaluate(({ dialog }) => {
      const memory = globalThis as any;
      memory.originalExternalDialog = dialog.showMessageBox;
      memory.externalPrompts = 0;
      dialog.showMessageBox = (async (...args: any[]) => {
        if ((args[1] || args[0]).title === '打开外部链接') {
          memory.externalPrompts++;
          return { response: 0, checkboxChecked: false };
        }
        return memory.originalExternalDialog(...args);
      }) as typeof dialog.showMessageBox;
    });
    await page.getByRole('link', { name: '新窗口' }).click();
    await expect.poll(() => application.evaluate(() => (globalThis as any).externalPrompts)).toBe(1);
    await application.evaluate(({ dialog }) => { dialog.showMessageBox = (globalThis as any).originalExternalDialog; });
    expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await page.getByRole('link', { name: '跨源跳转' }).click();
    await expect(ui.getByText('连接失败', { exact: true })).toBeVisible();
    expect(second.receivedForeignAuth).toBe(false);
    expect(ui.url()).toContain('index.html');
    await ui.getByRole('button', { name: '重连', exact: true }).click();
    await expect(ui.getByText('页面已加载', { exact: true })).toBeVisible();
  });

  test('本地模拟端中文文本、键盘、Retina 坐标、缩放与全屏退出', async () => {
    const page = await remote();
    await page.getByLabel('远端输入').click();
    await page.keyboard.insertText('你好，Selkies 中文输入');
    await expect(page.getByLabel('远端输入')).toHaveValue('你好，Selkies 中文输入');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#key')).toHaveText('ArrowLeft');
    await page.locator('#target').click({ position: { x: 30, y: 25 } });
    await expect(page.locator('#point')).toHaveText('30,25');
    await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1340, 860); });
    await page.locator('#target').click({ position: { x: 40, y: 35 } });
    await expect(page.locator('#point')).toHaveText('40,35');
    expect(await page.evaluate(() => devicePixelRatio)).toBeGreaterThan(1);
    const view = await application.evaluate(({ BrowserWindow }) => {
      const children = BrowserWindow.getAllWindows()[0].contentView.children;
      return children.filter(child => 'webContents' in child && /^https?:/.test((child as any).webContents.getURL()))
        .map(child => ({ visible: child.getVisible(), bounds: child.getBounds() }));
    });
    expect(view.at(-1)?.visible).toBe(true);
    expect(view.at(-1)?.bounds.x).toBe(232);
    await page.screenshot({ path: join(evidence, '05-remote-view.png') });
    if (fullscreenAvailable()) {
      await ui.getByRole('button', { name: '进入全屏', exact: true }).click();
      await expect.poll(isFullScreen).toBe(true);
      // Full screen is the desktop alone: no sidebar, no toolbar, every pixel of the screen.
      // The saved layout is untouched and comes back afterwards.
      await expect.poll(async () => (await state()).layout).toEqual({ sidebar: false, toolbar: false });
      expect((await state()).preferredLayout).toEqual({ sidebar: true, toolbar: true });
      await expect.poll(async () => { const now = await remoteBounds(); return now.bounds; }).toMatchObject({ x: 0, y: 0 });
      const now = await remoteBounds();
      expect([now.bounds.width, now.bounds.height]).toEqual(now.size);
      await expect(ui.getByLabel('连接管理', { exact: true })).toBeHidden();
      // The session controls are the assistive ball: resting on the right edge, clear of the strip
      // macOS covers at the top, and opening in place when clicked.
      const ballView = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
        .find(child => 'webContents' in child && (child as any).webContents.getURL().endsWith('/controls.html'))!.getBounds());
      const inset = (await state()).controlsInset;
      if (process.platform === 'darwin') expect([0, 24]).toContain(inset);
      const resting = await ballView();
      expect([resting.width, resting.height]).toEqual([44, 44]);
      expect(resting.x + resting.width).toBe(now.size[0] - 10);
      expect(resting.y).toBeGreaterThanOrEqual(inset);
      await controlsPage().getByRole('button', { name: '展开会话操作条' }).click();
      const exit = controlsPage().getByRole('button', { name: '退出全屏', exact: true });
      await expect(exit).toBeVisible();
      // The arc opens around the ball: the ball's centre has not moved, and the button is on the arc beside it.
      const opened = await ballView();
      const ballBox = (await controlsPage().getByRole('button', { name: '收起会话操作条' }).boundingBox())!;
      expect([opened.x + ballBox.x + ballBox.width / 2, opened.y + ballBox.y + ballBox.height / 2]).toEqual([resting.x + 22, resting.y + 22]);
      await settled(exit);
      const exitBox = (await exit.boundingBox())!;
      const distance = Math.hypot(exitBox.x + exitBox.width / 2 - (ballBox.x + ballBox.width / 2), exitBox.y + exitBox.height / 2 - (ballBox.y + ballBox.height / 2));
      expect(Math.round(distance)).toBe(46);
      expect(opened.y).toBeGreaterThanOrEqual(inset);
      // Layout buttons are pointless in full screen.
      await expect(controlsPage().getByRole('button', { name: /侧栏|工具栏|常规模式/ })).toHaveCount(0);
      await exit.click();
      await expect.poll(isFullScreen).toBe(false);
      await expect(ui.getByRole('button', { name: '进入全屏', exact: true })).toBeVisible();
      expect((await state()).layout).toEqual({ sidebar: true, toolbar: true });
    }
    await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())).toEqual([1340, 860]);
    const snapshot = await application.evaluate(async ({ BrowserWindow }) => {
      const image = await BrowserWindow.getAllWindows()[0].capturePage();
      return image.toPNG().toString('base64');
    });
    writeFileSync(join(evidence, '03-mock-desktop.png'), Buffer.from(snapshot, 'base64'));
  });

  test('独立收起两栏和专注模式扩大真实视图，原页面和活动流保持不变；悬浮操作条可恢复', async () => {
    const page = await remote();
    const identity = await page.evaluate(() => {
      (window as any).layoutProbe = crypto.randomUUID();
      return (window as any).layoutProbe;
    });
    const controlPage = controlsPage();
    expect(controlPage).toBeTruthy();
    const bounds = remoteBounds;
    await ui.getByRole('button', { name: '隐藏侧栏', exact: true }).click();
    await expect.poll(async () => (await bounds()).bounds.x).toBe(0);
    await expect(ui.getByLabel('连接管理', { exact: true })).toBeHidden();
    await ui.getByRole('button', { name: '隐藏工具栏', exact: true }).click();
    await expect.poll(async () => (await bounds()).bounds.y).toBe(strip);
    const full = await bounds();
    expect(full.bounds).toEqual({ x: 0, y: strip, width: full.size[0], height: full.size[1] - strip });
    expect(full.visible).toBe(true);
    const floating = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
      .find(child => 'webContents' in child && (child as any).webContents.getURL().endsWith('/controls.html'))!.getVisible());
    // The assistive ball is there whenever the toolbar is hidden, in a window as well as in full screen.
    expect(await floating()).toBe(true);
    await (await sessionButton('显示侧栏')).click();
    await expect.poll(async () => (await bounds()).bounds.x).toBe(232);
    expect((await bounds()).bounds.y).toBe(strip);
    const rejected = await controlPage.evaluate(() => (window as any).desk.invoke({ type: 'delete', id: crypto.randomUUID() }));
    expect(rejected).toMatchObject({ ok: false, error: '悬浮操作条无权执行此操作。' });
    await (await sessionButton('常规模式')).click();
    await expect.poll(async () => (await bounds()).bounds.y).toBe(52);
    await ui.getByRole('button', { name: '专注模式', exact: true }).click();
    await expect.poll(async () => (await bounds()).bounds.x).toBe(0);
    expect((await bounds()).bounds.y).toBe(strip);
    await ui.screenshot({ path: join(evidence, '09-focus-strip.png') });
    if (fullscreenAvailable()) {
      await (await sessionButton('进入全屏')).click();
      await expect.poll(isFullScreen).toBe(true);
      // Full screen has no title bar, so the desktop takes every pixel.
      await expect.poll(async () => { const now = await bounds(); return now.bounds.y === 0 && now.bounds.height === now.size[1]; }).toBe(true);
      expect(await floating()).toBe(true);
      await controlPage.screenshot({ path: join(evidence, '06-focus-controls.png') });
      await (await sessionButton('退出全屏')).click();
      await expect.poll(isFullScreen).toBe(false);
    }
    await (await sessionButton('常规模式')).click();
    expect(await page.evaluate(() => (window as any).layoutProbe)).toBe(identity);
    expect(page.isClosed()).toBe(false);
    await expect.poll(() => first.streams).toBe(1);
    await expect.poll(() => first.webSockets).toBe(1);
  });

  test('专注模式下认证自动显露管理界面并恢复偏好，原生菜单可随时恢复布局', async () => {
    const result = await ui.evaluate(async origin => (window as any).desk.invoke({
      type: 'save', connection: { name: '专注认证测试', url: origin, username: 'bob' }
    }), first.origin);
    await ui.getByRole('button', { name: '专注模式', exact: true }).click();
    await ui.evaluate(async id => (window as any).desk.invoke({ type: 'connect', id }), result.id);
    await expect(ui.getByRole('heading', { name: '服务器认证' })).toBeVisible();
    expect((await state()).layout).toEqual({ sidebar: true, toolbar: true });
    expect((await state()).preferredLayout).toEqual({ sidebar: false, toolbar: false });
    await login();
    await expect.poll(async () => (await state()).status.phase).toBe('loaded');
    expect((await state()).layout).toEqual({ sidebar: false, toolbar: false });
    await application.evaluate(({ Menu }) => {
      const view = Menu.getApplicationMenu()!.items.find(item => item.label === '显示')!;
      view.submenu!.items.find(item => item.label === '常规模式')!.click();
    });
    await expect(ui.getByRole('button', { name: '隐藏侧栏', exact: true })).toBeVisible();
    await ui.evaluate(async id => (window as any).desk.invoke({ type: 'delete', id }), result.id);
    await ui.getByRole('button', { name: '研发工作台 · Alice', exact: true }).click();
    await expect(ui.getByText('页面已加载', { exact: true })).toBeVisible();
  });

  test('断开与重连释放活动流', async () => {
    await ui.getByRole('button', { name: '断开', exact: true }).click();
    await expect.poll(() => first.streams).toBe(0);
    await expect.poll(() => first.webSockets).toBe(0);
    await expect(ui.getByText('已断开', { exact: true })).toBeVisible();
    await ui.getByRole('button', { name: '连接', exact: true }).click();
    await expect(ui.getByText('页面已加载', { exact: true })).toBeVisible();
    await expect.poll(() => first.streams).toBe(1);
    await ui.getByRole('button', { name: '重连', exact: true }).click();
    await expect(ui.getByText('页面已加载', { exact: true })).toBeVisible();
    await expect.poll(() => first.streams).toBe(1);
  });

  test('自签名首次提示、仅信任精确证书；另一连接同证书仍需确认', async () => {
    await ui.getByRole('button', { name: '自签名测试', exact: true }).click();
    await expect(ui.getByRole('heading', { name: '核对服务器证书' })).toBeVisible();
    await expect(ui.getByTestId('certificate-origin')).toHaveText(tls.origin);
    await expect(ui.getByTestId('certificate-fingerprint')).toContainText(/([A-F0-9]{2}:){31}[A-F0-9]{2}/);
    await ui.screenshot({ path: join(evidence, '04-certificate.png') });
    await ui.getByRole('button', { name: '信任此连接的此证书', exact: true }).click();
    await login();
    await expect(ui.getByText('页面已加载', { exact: true })).toBeVisible();
    await expect.poll(() => tls.webSockets).toBe(1);
    const extra = await add('同证书另一连接', tls.origin);
    await ui.getByRole('button', { name: '同证书另一连接', exact: true }).click();
    await expect(ui.getByRole('heading', { name: '核对服务器证书' })).toBeVisible();
    await ui.getByRole('button', { name: '拒绝连接', exact: true }).click();
    await expect(ui.getByText('连接失败', { exact: true })).toBeVisible();
    expect(extra).not.toBe(tlsID);
  });

  test('证书更换必须重新确认，撤销后同证书也不静默连接', async () => {
    const port = Number(new URL(tls.origin).port);
    await tls.stop();
    tls = await new MockDesktop(certificate(directory, 'mock-two')).start(port);
    await ui.getByRole('button', { name: '自签名测试', exact: true }).click();
    await expect(ui.getByRole('heading', { name: '核对服务器证书' })).toBeVisible();
    await ui.getByRole('button', { name: '信任此连接的此证书', exact: true }).click();
    await expect(ui.getByText('页面已加载', { exact: true })).toBeVisible();
    await ui.getByRole('button', { name: '连接设置', exact: true }).click();
    await ui.getByRole('button', { name: '撤销证书信任', exact: true }).click();
    await ui.getByRole('button', { name: '取消', exact: true }).click();
    await ui.getByRole('button', { name: '连接', exact: true }).click();
    await expect(ui.getByRole('heading', { name: '核对服务器证书' })).toBeVisible();
    await ui.getByRole('button', { name: '拒绝连接', exact: true }).click();
  });

  test('配置导出不含秘密，导入保留原连接并创建独立会话；删除需确认', async () => {
    const exportPath = join(directory, 'export.json');
    await application.evaluate(({ dialog }, path) => {
      const memory = globalThis as any;
      memory.originalFileDialogs = { save: dialog.showSaveDialog, open: dialog.showOpenDialog, message: dialog.showMessageBox };
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog;
      dialog.showMessageBox = (async (...args: any[]) => {
        if ((args[1] || args[0]).title === '确认导入') return { response: 1, checkboxChecked: false };
        return memory.originalFileDialogs.message(...args);
      }) as typeof dialog.showMessageBox;
    }, exportPath);
    await ui.getByRole('button', { name: '设置', exact: true }).click();
    await ui.getByRole('tab', { name: '连接配置' }).click();
    await ui.getByRole('button', { name: /导出配置/ }).click();
    await expect.poll(() => { try { return JSON.parse(readFileSync(exportPath, 'utf8')).version; } catch { return 0; } }).toBe(1);
    const exported = readFileSync(exportPath, 'utf8');
    expect(exported).not.toContain('fixture-pass');
    expect(exported).not.toContain('fingerprint');
    const oldCount = (await state()).connections.length;
    writeFileSync(exportPath, '{"version":2,"connections":[]}');
    await ui.getByRole('button', { name: /导入配置/ }).click();
    await expect(ui.locator('#toast')).toContainText('字段校验失败');
    expect((await state()).connections).toHaveLength(oldCount);
    writeFileSync(exportPath, exported);
    await ui.getByRole('button', { name: /导入配置/ }).click();
    await expect.poll(async () => (await state()).connections.length).toBe(oldCount * 2);
    await ui.getByRole('button', { name: '关闭', exact: true }).click();
    await application.evaluate(({ dialog }) => {
      const originals = (globalThis as any).originalFileDialogs;
      dialog.showSaveDialog = originals.save;
      dialog.showOpenDialog = originals.open;
      dialog.showMessageBox = originals.message;
    });
    const imported = (await state()).connections.find((entry: any) => entry.name === '研发工作台 · Alice（导入 2）');
    expect(imported.id).not.toBe(aliceID);
    expect(imported.savedPassword).toBe(false);
    const connection = (await state()).connections.find((entry: any) => entry.id === bobID);
    expect(connection.username).toBe('bob');
    await ui.getByRole('button', { name: '研发工作台 · Bob', exact: true }).click();
    await expect(ui.getByText('页面已加载', { exact: true })).toBeVisible();
    await ui.getByRole('button', { name: '连接设置', exact: true }).click();
    await ui.getByRole('button', { name: '删除连接', exact: true }).click();
    await expect(ui.getByRole('heading', { name: '删除此连接？' })).toBeVisible();
    await ui.getByRole('button', { name: '保留连接', exact: true }).click();
    expect((await state()).connections.some((entry: any) => entry.id === bobID)).toBe(true);
    await ui.getByRole('button', { name: '取消', exact: true }).click();
    await ui.getByRole('button', { name: '研发工作台 · Alice（导入 2）', exact: true }).click();
    await login();
    await ui.getByRole('button', { name: '连接设置', exact: true }).click();
    await ui.getByRole('button', { name: '删除连接', exact: true }).click();
    await ui.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(ui.getByRole('button', { name: '研发工作台 · Alice（导入 2）', exact: true })).toBeHidden();
    expect((await state()).status.phase).toBe('idle');
  });

  test('关闭重启后配置、Cookie 与 DPI 持久化，记住密码能解密', async () => {
    await ui.evaluate(() => (window as any).desk.invoke({ type: 'layout', target: 'focus' }));
    await application.close();
    await expect.poll(() => first.streams).toBe(0);
    application = await launch();
    ui = await management();
    await expect(ui.getByRole('button', { name: '研发工作台 · Alice', exact: true })).toBeVisible();
    expect((await state()).connections.find((entry: any) => entry.id === aliceID).savedPassword).toBe(true);
    expect((await state()).preferredLayout).toEqual({ sidebar: false, toolbar: false });
    expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())).toEqual([1340, 860]);
    await ui.getByRole('button', { name: '研发工作台 · Alice', exact: true }).click();
    await expect.poll(async () => (await state()).status.phase).toBe('loaded');
    const page = await remote();
    await expect(page.locator('#isolation')).toContainText('previous=alice; cookie=account=alice');
    expect(await page.evaluate(() => localStorage.getItem('dpi'))).toBe('2');
    expect((await state()).layout).toEqual({ sidebar: false, toolbar: false });
    await ui.evaluate(() => (window as any).desk.invoke({ type: 'layout', target: 'restore' }));
  });

  test('清除记住的密码同时清除认证缓存，下次连接重新询问', async () => {
    await ui.getByRole('button', { name: '连接设置', exact: true }).click();
    await ui.getByRole('button', { name: '清除记住的密码', exact: true }).click();
    await expect.poll(async () => (await state()).connections.find((entry: any) => entry.id === aliceID).savedPassword).toBe(false);
    await ui.getByRole('button', { name: '取消', exact: true }).click();
    await ui.getByRole('button', { name: '连接', exact: true }).click();
    await expect(ui.getByRole('heading', { name: '服务器认证' })).toBeVisible();
    await login();
    await expect(ui.getByText('页面已加载', { exact: true })).toBeVisible();
  });

  test('远端网页截走全部按键时管理快捷键仍生效且只触发一次；可自定义、查重并恢复默认', async () => {
    const page = await remote();
    // A Selkies page forwards every key to the remote side and cancels the local default.
    await page.evaluate(() => {
      (window as any).seen = [];
      addEventListener('keydown', event => { (window as any).seen.push(event.code); event.preventDefault(); event.stopImmediatePropagation(); }, true);
    });
    await page.getByLabel('远端输入').click();
    const seen = () => page.evaluate(() => (window as any).seen as string[]);
    expect((await remoteBounds()).bounds.x).toBe(232);
    await pressKey('remote', 'B', [primary, 'alt']);
    await expect.poll(async () => (await remoteBounds()).bounds.x).toBe(0);
    await page.waitForTimeout(400);
    expect((await remoteBounds()).bounds.x).toBe(0);
    expect(await seen()).not.toContain('KeyB');
    await pressKey('remote', 'B', [primary, 'alt']);
    await expect.poll(async () => (await remoteBounds()).bounds.x).toBe(232);
    await pressKey('remote', 'B');
    await expect.poll(seen).toContain('KeyB');

    expect(await invoke({ type: 'shortcut', command: 'sidebar', accelerator: 'J' })).toMatchObject({ ok: false });
    const toolbar = (await state()).shortcuts.toolbar;
    expect(await invoke({ type: 'shortcut', command: 'sidebar', accelerator: toolbar })).toMatchObject({ ok: false, error: '该快捷键已用于“显示或隐藏工具栏”。' });
    expect(await invoke({ type: 'shortcut', command: 'sidebar', accelerator: 'Control+Shift+J' })).toMatchObject({ ok: true });
    await page.evaluate(() => { (window as any).seen = []; });
    await pressKey('remote', 'J', ['control', 'shift']);
    await expect.poll(async () => (await remoteBounds()).bounds.x).toBe(0);
    await pressKey('remote', 'B', [primary, 'alt']);
    await expect.poll(seen).toContain('KeyB');
    expect((await remoteBounds()).bounds.x).toBe(0);
    expect(await invoke({ type: 'shortcut', command: 'sidebar', accelerator: null })).toMatchObject({ ok: true });
    await pressKey('remote', 'B', [primary, 'alt']);
    await expect.poll(async () => (await remoteBounds()).bounds.x).toBe(232);
  });

  test('设置页切换中英文与亮暗外观并持久化；快捷键可在界面录制', async () => {
    const background = () => ui.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
    await ui.getByRole('button', { name: '设置', exact: true }).click();
    await expect(ui.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
    await ui.locator('#set-language').selectOption('en');
    await expect(ui.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(ui.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    await ui.getByRole('tab', { name: 'Session' }).click();
    await expect(ui.getByText('Enter focus mode after connecting')).toBeVisible();
    await expect(ui.locator('#set-language')).toBeHidden();
    await ui.getByRole('tab', { name: 'General' }).click();
    expect(await application.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map(item => item.label))).toEqual(expect.arrayContaining(['Edit', 'Connection', 'View', 'Window']));
    expect((await state()).status.detail).toBe('The page is ready.');
    await ui.locator('#set-theme').selectOption('dark');
    await expect.poll(background).toBe('#1b1c1f');
    expect(await application.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors)).toBe(true);
    await ui.screenshot({ path: join(evidence, '08-settings-dark-en.png') });
    await ui.getByRole('tab', { name: 'Shortcuts' }).click();
    await ui.screenshot({ path: join(evidence, '10-settings-shortcuts-dark-en.png') });
    await ui.getByRole('tab', { name: 'General' }).click();
    await ui.locator('#set-theme').selectOption('light');
    await expect.poll(background).toBe('#f5f5f7');
    await ui.locator('#set-theme').selectOption('system');
    expect(await application.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('system');
    await ui.locator('#set-language').selectOption('zh');
    await expect(ui.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
    expect(await application.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map(item => item.label))).toContain('显示');

    await ui.getByRole('tab', { name: '快捷键' }).click();
    await ui.getByRole('button', { name: '修改 专注模式', exact: true }).click();
    await expect(ui.getByText('按下新的组合键…')).toBeVisible();
    await ui.keyboard.press('Control+Shift+KeyY');
    await expect.poll(async () => (await state()).shortcuts.focus).toBe('Control+Shift+Y');
    await expect(ui.getByText('按下新的组合键…')).toBeHidden();
    // Recording another command with the same keys is refused and explained.
    await ui.getByRole('button', { name: '修改 重连', exact: true }).click();
    await ui.keyboard.press('Control+Shift+KeyY');
    await expect(ui.locator('#shortcut-error')).toHaveText('该快捷键已用于“专注模式”。');
    await ui.getByRole('button', { name: '恢复默认 专注模式', exact: true }).click();
    await expect.poll(async () => (await state()).settings.shortcuts).toEqual({});
    await ui.getByRole('button', { name: '关闭', exact: true }).click();
    const saved = JSON.parse(readFileSync(join(directory, 'profile', 'connections.json'), 'utf8')).settings;
    expect(saved).toMatchObject({ language: 'zh', theme: 'system' });
    await invoke({ type: 'settings', settings: { theme: 'light' } });
  });

  test('快速切换面板可从远程桌面呼出，输入名称回车即切换', async () => {
    const page = await remote();
    await page.getByLabel('远端输入').click();
    await pressKey('remote', 'K', [primary, 'alt']);
    const search = ui.getByPlaceholder('输入名称或地址，回车连接');
    await expect(search).toBeVisible();
    await search.fill('bob');
    // The original entry and its imported copy both match; arrow keys move between them.
    await expect(ui.getByRole('option')).toHaveCount(2);
    await expect(ui.getByRole('option', { selected: true })).toContainText('研发工作台 · Bob');
    await search.press('ArrowDown');
    await expect(ui.getByRole('option', { selected: true })).toContainText('导入 2');
    await search.press('ArrowUp');
    await search.press('Enter');
    await login();
    await expect.poll(async () => (await state()).status).toMatchObject({ id: bobID, phase: 'loaded' });
    await expect(search).toBeHidden();
  });

  test('连接后自动专注、按连接进入全屏；断开时保存缩略图，关闭该设置即删除', async () => {
    await invoke({ type: 'settings', settings: { autoFocus: true } });
    const alice = (await state()).connections.find((entry: any) => entry.id === aliceID);
    const { savedPassword, certificateTrusted, thumbnail, ...connection } = alice;
    expect(thumbnail).toBeGreaterThanOrEqual(0);
    const fullscreen = fullscreenAvailable();
    expect(await invoke({ type: 'save', connection: { ...connection, fullscreen } })).toMatchObject({ ok: true });
    expect(await state()).toMatchObject({ layout: { sidebar: true, toolbar: true }, status: { id: bobID, phase: 'loaded' } });
    await ui.getByRole('button', { name: '研发工作台 · Alice', exact: true }).click();
    await expect.poll(async () => (await state()).status).toMatchObject({ id: aliceID, phase: 'loaded' });
    await expect.poll(async () => (await state()).layout).toEqual({ sidebar: false, toolbar: false });
    if (fullscreen) {
      await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(true);
      await expect.poll(async () => { const now = await remoteBounds(); return now.bounds.height === now.size[1]; }).toBe(true);
      await invoke({ type: 'fullscreen' });
      await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false);
    }
    await expect.poll(async () => (await remoteBounds()).bounds.y).toBe(strip);
    await ui.screenshot({ path: join(evidence, '09-focus-strip.png') });
    expect(await invoke({ type: 'save', connection })).toMatchObject({ ok: true });

    await invoke({ type: 'disconnect' });
    const file = join(directory, 'profile', 'thumbnails', `${aliceID}.jpg`);
    await expect.poll(async () => (await state()).connections.find((entry: any) => entry.id === aliceID).thumbnail).toBeGreaterThan(0);
    expect(readFileSync(file).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect((await invoke({ type: 'thumbnail', id: aliceID })).text).toMatch(/^data:image\/jpeg;base64,/);
    await expect(ui.getByRole('button', { name: '连接 研发工作台 · Alice', exact: true }).locator('img')).toHaveCount(1);
    await ui.screenshot({ path: join(evidence, '07-home.png') });
    await invoke({ type: 'settings', settings: { thumbnails: false } });
    expect((await state()).connections.find((entry: any) => entry.id === aliceID).thumbnail).toBe(0);
    expect(() => readFileSync(file)).toThrow();
    expect((await invoke({ type: 'thumbnail', id: aliceID })).text).toBe('');
    await expect(ui.locator('.device-preview img')).toHaveCount(0);
    await invoke({ type: 'settings', settings: { thumbnails: true, autoFocus: false } });
    await invoke({ type: 'layout', target: 'restore' });
  });

  test('服务器不可达时自动重连并说明原因，可随时停止；恢复后自动连上', async () => {
    await invoke({ type: 'settings', settings: { autoReconnect: true } });
    const port = Number(new URL(second.origin).port);
    await second.stop();
    await ui.getByRole('button', { name: '第二台服务器', exact: true }).click();
    await expect(ui.getByText('等待重连', { exact: true })).toBeVisible();
    expect((await state()).status.detail).toMatch(/ERR_CONNECTION_REFUSED（-102）。2 秒后进行第 1\/6 次重连。$/);
    await ui.getByRole('button', { name: '停止', exact: true }).click();
    await expect(ui.getByText('已断开', { exact: true })).toBeVisible();
    await ui.waitForTimeout(2500);
    expect((await state()).status.phase).toBe('disconnected');

    await ui.getByRole('button', { name: '连接', exact: true }).click();
    await expect(ui.getByText('等待重连', { exact: true })).toBeVisible();
    second = await new MockDesktop().start(port);
    // The first retry can land before the server is listening again; allow for the next ones (2 s, 4 s, 8 s).
    await expect(ui.getByRole('heading', { name: '服务器认证' })).toBeVisible({ timeout: 20000 });
    await login();
    await expect.poll(async () => (await state()).status.phase).toBe('loaded');
    await expect.poll(() => second.streams).toBe(1);
    // With the setting off, the same failure is reported once and left for the user.
    await invoke({ type: 'settings', settings: { autoReconnect: false } });
    await invoke({ type: 'disconnect' });
    await second.stop();
    await ui.getByRole('button', { name: '连接', exact: true }).click();
    await expect(ui.getByText('连接失败', { exact: true })).toBeVisible();
    second = await new MockDesktop().start(port);
  });

  test('标记为启动时自动连接的条目在重启后无需点击即开始连接', async () => {
    const alice = (await state()).connections.find((entry: any) => entry.id === aliceID);
    const { savedPassword, certificateTrusted, thumbnail, ...connection } = alice;
    expect(await invoke({ type: 'save', connection: { ...connection, autoConnect: true } })).toMatchObject({ ok: true });
    await application.close();
    application = await launch();
    ui = await management();
    await expect(ui.getByRole('heading', { name: '服务器认证' })).toBeVisible();
    expect((await state()).status.id).toBe(aliceID);
    await login();
    await expect.poll(async () => (await state()).status.phase).toBe('loaded');
    expect(await invoke({ type: 'save', connection })).toMatchObject({ ok: true });
  });

  test('专注模式和全屏下的会话按钮用鼠标事件操作：标题条按钮可点；全屏时点悬浮球展开，可拖到另一侧并记住位置', async () => {
    // Mouse events are injected into the view that owns the button, the same path a physical mouse takes
    // inside the app. They do not pass through the window server, so the system menu bar never slides down here.
    const mouse = (target: 'ui' | 'controls', type: string, x: number, y: number) => application.evaluate(({ webContents, BrowserWindow }, event) => {
      const contents = event.target === 'ui' ? BrowserWindow.getAllWindows()[0].webContents
        : webContents.getAllWebContents().find(contents => contents.getURL().endsWith('/controls.html'))!;
      contents.sendInputEvent({ type: event.type, x: event.x, y: event.y, button: 'left', clickCount: 1 } as any);
    }, { target, type, x, y });
    const click = async (target: 'ui' | 'controls', locator: ReturnType<typeof ui.getByRole>) => {
      await expect(locator).toBeVisible();
      await settled(locator);
      const box = (await locator.boundingBox())!;
      const x = Math.round(box.x + box.width / 2);
      const y = Math.round(box.y + box.height / 2);
      await mouse(target, 'mouseMove', x, y);
      await mouse(target, 'mouseDown', x, y);
      await mouse(target, 'mouseUp', x, y);
      return box;
    };
    const controlPage = controlsPage();
    const openBall = async () => {
      await mouse('controls', 'mouseMove', 22, 22);
      await mouse('controls', 'mouseDown', 22, 22);
      await mouse('controls', 'mouseUp', 22, 22);
      await expect.poll(async () => (await state()).controlsExpanded).toBe(true);
    };
    const windowed = async (name: string) => {
      if (strip) return click('ui', ui.locator('.strip').getByRole('button', { name, exact: true }));
      await openBall();
      return click('controls', controlPage.getByRole('button', { name, exact: true }));
    };
    await invoke({ type: 'layout', target: 'focus' });
    await expect.poll(async () => (await state()).layout).toEqual({ sidebar: false, toolbar: false });
    if (strip) {
      // Every button in the 28 px strip is an icon with a readable name and sits inside the strip.
      for (const name of ['常规模式', '显示侧栏', '显示工具栏', '进入全屏', '重连', '断开']) {
        const control = ui.locator('.strip').getByRole('button', { name, exact: true });
        await expect(control.locator('svg')).toHaveCount(1);
        const box = (await control.boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(strip);
      }
    }
    await windowed('显示侧栏');
    await expect.poll(async () => (await state()).layout).toEqual({ sidebar: true, toolbar: false });
    if (fullscreenAvailable()) {
      await windowed('进入全屏');
      await expect.poll(isFullScreen).toBe(true);
      // The ball waits quietly; a press without movement opens it, and it closes again by itself.
      expect((await state()).controlsExpanded).toBe(false);
      await openBall();
      for (const name of ['退出全屏', '重连', '断开']) await expect(controlPage.getByRole('button', { name, exact: true }).locator('svg')).toHaveCount(1);
      await expect(controlPage.getByRole('button', { name: '收起会话操作条', exact: true })).toBeVisible();
      await settled(controlPage.getByRole('button', { name: '重连', exact: true }));
      await controlPage.screenshot({ path: join(evidence, '11-ball-arc-right.png') });
      await mouse('controls', 'mouseLeave', 400, 400);
      await expect.poll(async () => (await state()).controlsExpanded, { timeout: 6000 }).toBe(false);
      // Dropping it on the other half of the screen parks it on that edge, and the place is remembered.
      const drag = (dx: number, dy: number, done: boolean) => controlPage.evaluate(value => (window as any).desk.invoke(value), { type: 'ballDrag', dx, dy, done });
      await drag(-400, 60, false);
      await drag(-3000, 120, true);
      await expect.poll(async () => (await state()).ballSide).toBe('left');
      expect(JSON.parse(readFileSync(join(directory, 'profile', 'connections.json'), 'utf8')).ball.side).toBe('left');
      expect((await remoteBounds()).visible).toBe(true);
      // The top and bottom edges behave the same way: it parks where it is dropped, the arc opens
      // towards the desktop, and neither the ball nor the arc is pushed out of place.
      const view = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children
        .find(child => 'webContents' in child && (child as any).webContents.getURL().endsWith('/controls.html'))!.getBounds());
      for (const [side, dx, dy] of [['top', 700, -2000], ['bottom', 0, 3000]] as const) {
        await drag(dx, dy, true);
        await expect.poll(async () => (await state()).ballSide).toBe(side);
        const resting = await view();
        const screenSize = (await remoteBounds()).size;
        if (side === 'top') expect(resting.y).toBe((await state()).controlsInset + 10);
        else expect(resting.y + resting.height).toBe(screenSize[1] - 10);
        await openBall();
        const ballBox = (await controlPage.getByRole('button', { name: '收起会话操作条' }).boundingBox())!;
        const opened = await view();
        expect([opened.x + ballBox.x + ballBox.width / 2, opened.y + ballBox.y + ballBox.height / 2]).toEqual([resting.x + 22, resting.y + 22]);
        expect(opened.y).toBeGreaterThanOrEqual((await state()).controlsInset);
        expect(opened.y + opened.height).toBeLessThanOrEqual(screenSize[1]);
        const reconnect = controlPage.getByRole('button', { name: '重连', exact: true });
        await settled(reconnect);
        const box = (await reconnect.boundingBox())!;
        // Buttons are on the desktop side of the ball: below it at the top edge, above it at the bottom.
        if (side === 'top') expect(box.y).toBeGreaterThan(ballBox.y + ballBox.height);
        else expect(box.y + box.height).toBeLessThan(ballBox.y);
        await controlPage.screenshot({ path: join(evidence, `13-ball-arc-${side}.png`) });
        await mouse('controls', 'mouseLeave', 400, 400);
        await controlPage.evaluate(() => (window as any).desk.invoke({ type: 'controls', expanded: false }));
      }
      await drag(-3000, -300, true);
      await expect.poll(async () => (await state()).ballSide).toBe('left');
      await openBall();
      await settled(controlPage.getByRole('button', { name: '重连', exact: true }));
      await controlPage.screenshot({ path: join(evidence, '12-ball-arc-left.png') });
      const exit = await click('controls', controlPage.getByRole('button', { name: '退出全屏', exact: true }));
      expect(exit.x).toBeLessThan(200);
      await expect.poll(isFullScreen).toBe(false);
      await expect.poll(async () => (await state()).layout).toEqual({ sidebar: true, toolbar: false });
      await drag(2000, 0, true);
      await expect.poll(async () => (await state()).ballSide).toBe('right');
    }
    await windowed('常规模式');
    await expect.poll(async () => (await state()).layout).toEqual({ sidebar: true, toolbar: true });
  });

  test('侧栏分组可以折叠和展开，折叠状态重启后保留；搜索时仍能找到折叠分组里的连接', async () => {
    const extra = await invoke({ type: 'save', connection: { name: '测试机', url: 'https://other.test:8443', group: '第二组' } }) as any;
    expect(extra.ok).toBe(true);
    const sidebar = ui.getByLabel('连接管理', { exact: true });
    const group = sidebar.getByRole('button', { name: '模拟环境', exact: true });
    const alice = sidebar.getByRole('button', { name: '研发工作台 · Alice', exact: true });
    const other = sidebar.getByRole('button', { name: '测试机', exact: true });
    await expect(group).toHaveAttribute('aria-expanded', 'true');
    await expect(alice).toBeVisible();
    await group.click();
    await expect(group).toHaveAttribute('aria-expanded', 'false');
    await expect(alice).toHaveCount(0);
    await expect(other).toBeVisible();
    // The folded group still shows that it holds the live connection, and how many it has.
    await expect(group.locator('.connection-light.loaded')).toHaveCount(1);
    await expect(group.locator('small')).toHaveText(String((await state()).connections.length - 1));
    // Searching looks inside folded groups as well.
    await ui.getByPlaceholder('搜索名称、地址或分组').fill('alice');
    await expect(alice).toBeVisible();
    await ui.getByPlaceholder('搜索名称、地址或分组').fill('');
    await expect(alice).toHaveCount(0);
    await application.close();
    application = await launch();
    ui = await management();
    const again = ui.getByLabel('连接管理', { exact: true });
    await expect(again.getByRole('button', { name: '模拟环境', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(again.getByRole('button', { name: '研发工作台 · Alice', exact: true })).toHaveCount(0);
    await again.getByRole('button', { name: '模拟环境', exact: true }).click();
    await expect(again.getByRole('button', { name: '研发工作台 · Alice', exact: true })).toBeVisible();
    expect(await invoke({ type: 'delete', id: extra.id })).toMatchObject({ ok: true });
    // With a single group left there is nothing to fold, so no heading is shown.
    await expect(again.getByRole('button', { name: '模拟环境', exact: true })).toHaveCount(0);
  });
});
