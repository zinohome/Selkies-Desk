import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('顶栏收起和展开保留按钮横向位置、操作顺序及会话', async () => {
  test.skip(process.platform !== 'darwin', '紧凑标题栏仅用于 macOS');
  test.setTimeout(90000);
  const directory = mkdtempSync(join(tmpdir(), 'selkies-toolbar-'));
  const profile = join(directory, 'profile');
  const evidence = resolve('.qa/toolbar');
  mkdirSync(profile);
  mkdirSync(evidence, { recursive: true });
  writeFileSync(join(profile, 'connections.json'), JSON.stringify({
    version: 1, connections: [], certificates: {}, layout: { sidebar: true, toolbar: true },
    settings: { language: 'zh', theme: 'light', autoFocus: false, autoReconnect: false, updateMode: 'off' }
  }));
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><title>模拟桌面</title><input aria-label="远端输入">');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const application = await electron.launch({
    ...(process.env.SELKIES_PACKAGED_PATH ? { executablePath: process.env.SELKIES_PACKAGED_PATH } : {}),
    args: [...(process.env.SELKIES_PACKAGED_PATH ? [] : [resolve('.')]), `--user-data-dir=${profile}`],
    colorScheme: null
  });
  try {
    await expect.poll(() => application.windows().some(page => page.url().endsWith('/index.html'))).toBe(true);
    const ui = application.windows().find(page => page.url().endsWith('/index.html'))!;
    const invoke = (action: unknown) => ui.evaluate(action => (window as any).desk.invoke(action), action);
    const state = async () => (await invoke({ type: 'state' })).state;
    const saved = await invoke({
      type: 'save', connection: { name: '测试桌面', url: `http://127.0.0.1:${(server.address() as any).port}` }
    });
    await invoke({ type: 'connect', id: saved.id });
    await expect.poll(async () => (await state()).status.phase).toBe('loaded');
    const remote = application.windows().find(page => /^http:/.test(page.url()))!;
    await remote.getByLabel('远端输入').fill('保留输入');
    const requestCount = requests;
    const measurements = [];
    for (const width of [960, 1280]) {
      await application.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 700), width);
      await expect.poll(() => ui.evaluate(() => innerWidth)).toBe(width);
      for (const language of ['zh', 'en']) {
        await invoke({ type: 'settings', settings: { language } });
        const reconnect = language === 'zh' ? '重连' : 'Reconnect';
        for (const sidebar of [true, false]) {
          if ((await state()).layout.sidebar !== sidebar) await invoke({ type: 'layout', target: 'sidebar' });
          const expanded = ui.locator('.main-header');
          const before = await expanded.getByRole('button', { name: reconnect, exact: true }).boundingBox();
          const order = await expanded.locator('.actions > button').evaluateAll(buttons => buttons.map(button => button.id));
          const actionCenters = await expanded.locator('.actions > button').evaluateAll(buttons => buttons.map(button => {
            const box = button.getBoundingClientRect();
            return { id: button.id, center: box.x + box.width / 2 };
          }));
          if (width === 1280 && language === 'zh' && !sidebar) {
            await ui.screenshot({ path: join(evidence, 'toolbar-expanded.png'), clip: { x: 0, y: 0, width, height: 60 } });
          }
          await invoke({ type: 'layout', target: 'toolbar' });
          const compact = ui.locator('.strip');
          await expect(compact).toBeVisible();
          const after = await compact.getByRole('button', { name: reconnect, exact: true }).boundingBox();
          const compactCenters = await compact.locator('.actions > button').evaluateAll(buttons => buttons.map(button => {
            const box = button.getBoundingClientRect();
            return { id: button.id, center: box.x + box.width / 2 };
          }));
          measurements.push({ width, language, sidebar, before, after, actionCenters, compactCenters });
          writeFileSync(join(evidence, 'geometry.json'), JSON.stringify(measurements, null, 2));
          expect(after!.x + after!.width / 2, '重连按钮收起后不横向跳位').toBe(before!.x + before!.width / 2);
          expect(compactCenters, '右侧每个按钮都保留原来的横向位置').toEqual(actionCenters);
          expect(await compact.locator('.actions > button').evaluateAll(buttons => buttons.map(button => button.id))).toEqual(order);
          for (const control of await compact.locator('button').all()) {
            const box = (await control.boundingBox())!;
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(width);
            expect(box.y).toBeGreaterThanOrEqual(0);
            expect(box.y + box.height).toBeLessThanOrEqual(28);
          }
          if (width === 1280 && language === 'zh' && !sidebar) {
            await ui.screenshot({ path: join(evidence, 'toolbar-compact.png'), clip: { x: 0, y: 0, width, height: 36 } });
          }
          await compact.locator('#toggle-toolbar').click();
          await expect.poll(async () => (await state()).layout.toolbar).toBe(true);
          expect(await expanded.getByRole('button', { name: reconnect, exact: true }).boundingBox()).toEqual(before);
        }
      }
    }
    expect(requests).toBe(requestCount);
    await expect(remote.getByLabel('远端输入')).toHaveValue('保留输入');
    await invoke({ type: 'layout', target: 'focus' });
    await ui.locator('#settings').click();
    await expect(ui.locator('#editor')).toBeVisible();
    await ui.locator('#editor-cancel').click();
    await expect.poll(async () => (await state()).layout.toolbar).toBe(false);
    await ui.locator('#focus').click();
    await expect.poll(async () => (await state()).layout).toEqual({ sidebar: true, toolbar: true });
  } finally {
    await application.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
