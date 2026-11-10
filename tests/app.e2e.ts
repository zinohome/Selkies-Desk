import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
  const launch = () => electron.launch({
    ...(process.env.SELKIES_PACKAGED_PATH ? { executablePath: process.env.SELKIES_PACKAGED_PATH } : {}),
    args: [...(process.env.SELKIES_PACKAGED_PATH ? [] : [resolve('.')]), `--user-data-dir=${join(directory, 'profile')}`],
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
    mkdirSync(evidence, { recursive: true });
    second = await new MockDesktop().start();
    first = new MockDesktop();
    first.foreignOrigin = second.origin;
    await first.start();
    tls = await new MockDesktop(certificate(directory, 'mock-one')).start();
    application = await launch();
    ui = await management();
    await expect(ui.getByText('添加你的第一台服务器', { exact: true })).toBeVisible();
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
    await ui.getByRole('button', { name: '进入全屏', exact: true }).click();
    await expect(ui.getByRole('button', { name: '退出全屏', exact: true })).toBeVisible();
    await ui.getByRole('button', { name: '退出全屏', exact: true }).click();
    await expect(ui.getByRole('button', { name: '进入全屏', exact: true })).toBeVisible();
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
    const controlPage = application.windows().find(window => window.url().endsWith('/controls.html'))!;
    expect(controlPage).toBeTruthy();
    const bounds = () => application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const child = window.contentView.children.find(child => 'webContents' in child && /^https?:/.test((child as any).webContents.getURL()))!;
      return { bounds: child.getBounds(), size: window.getContentSize(), visible: child.getVisible() };
    });
    await ui.getByRole('button', { name: '隐藏侧栏', exact: true }).click();
    await expect.poll(async () => (await bounds()).bounds.x).toBe(0);
    await expect(ui.getByLabel('连接管理', { exact: true })).toBeHidden();
    await ui.getByRole('button', { name: '隐藏工具栏', exact: true }).click();
    await expect.poll(async () => (await bounds()).bounds.y).toBe(0);
    const full = await bounds();
    expect(full.bounds).toEqual({ x: 0, y: 0, width: full.size[0], height: full.size[1] });
    expect(full.visible).toBe(true);
    await controlPage.getByRole('button', { name: '展开会话操作条' }).click();
    await controlPage.getByRole('button', { name: '显示侧栏', exact: true }).click();
    await expect.poll(async () => (await bounds()).bounds.x).toBe(232);
    expect((await bounds()).bounds.y).toBe(0);
    await controlPage.getByRole('button', { name: '展开会话操作条' }).click();
    const rejected = await controlPage.evaluate(() => (window as any).desk.invoke({ type: 'delete', id: crypto.randomUUID() }));
    expect(rejected).toMatchObject({ ok: false, error: '悬浮操作条无权执行此操作。' });
    await controlPage.getByRole('button', { name: '常规模式', exact: true }).click();
    await expect.poll(async () => (await bounds()).bounds.y).toBe(52);
    await ui.getByRole('button', { name: '专注模式', exact: true }).click();
    await expect.poll(async () => (await bounds()).bounds.x).toBe(0);
    expect((await bounds()).bounds.y).toBe(0);
    await controlPage.getByRole('button', { name: '展开会话操作条' }).click();
    await controlPage.screenshot({ path: join(evidence, '06-focus-controls.png') });
    await controlPage.getByRole('button', { name: '进入全屏', exact: true }).click();
    await expect(controlPage.getByRole('button', { name: '退出全屏', exact: true })).toBeVisible();
    await controlPage.getByRole('button', { name: '退出全屏', exact: true }).click();
    await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false);
    await controlPage.getByRole('button', { name: '常规模式', exact: true }).click();
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
});
