import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Action, Result } from '../src/protocol';

const first = { id: randomUUID(), name: '节点甲', kind: 'magpie' };
const second = { id: randomUUID(), name: '节点乙', kind: 'magpie' };
const desktop = { id: randomUUID(), name: '模拟桌面', kind: 'selkies' };

let app: ElectronApplication;
let ui: Page;
let profile: string;
let origin: string;
let requests: string[];
let unauthorized: boolean;
let server: ReturnType<typeof createServer>;

async function launch() {
  const executablePath = process.env.SELKIES_PACKAGED_PATH;
  app = await electron.launch({
    executablePath, args: [...(executablePath ? [] : [resolve('.')]), `--user-data-dir=${profile}`],
    colorScheme: null
  });
  await expect.poll(() => app.windows().some(page => page.url().endsWith('/index.html'))).toBe(true);
  ui = app.windows().find(page => page.url().endsWith('/index.html'))!;
}

function seed(connections: object[], magpieTabs: string[] = []) {
  writeFileSync(join(profile, 'connections.json'), JSON.stringify({
    version: 1, connections, magpieTabs,
    settings: { language: 'zh', updateMode: 'off', autoFocus: false, autoReconnect: false }
  }));
}

function invoke(action: Action) {
  return ui.evaluate<Promise<Result>, Action>(action => (window as any).desk.invoke(action), action);
}

function views() {
  return app.evaluate(({ BrowserWindow, WebContentsView }) => BrowserWindow.getAllWindows()[0].contentView.children.flatMap(view => {
    if (!(view instanceof WebContentsView) || view.webContents.isDestroyed()) return [];
    const url = new URL(view.webContents.getURL() || 'about:blank');
    return [{ id: view.webContents.id, path: url.pathname + url.search, visible: view.getVisible(), bounds: view.getBounds() }];
  }));
}

test.beforeEach(async () => {
  profile = mkdtempSync(join(tmpdir(), 'selkies-magpie-e2e-'));
  requests = [];
  unauthorized = false;
  server = createServer((request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    if (url.pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    const node = url.searchParams.get('k') || 'desktop';
    requests.push(node);
    if (unauthorized) { response.writeHead(401).end(); return; }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><title>Fixture</title><h1>Fixture ${node}</h1><p id="previous"></p>
      <script>document.querySelector('#previous').textContent = localStorage.getItem('node') || 'none';
      localStorage.setItem('node', new URLSearchParams(location.search).get('k'));</script>`);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterEach(async () => {
  try { await app?.close(); } finally {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
    rmSync(profile, { recursive: true, force: true });
  }
});

for (const path of ['/status', '/?k=alpha']) {
  test(`从真实表单新增、编辑并打开 Magpie HTTP 地址 ${path}`, async () => {
    seed([]);
    await launch();
    const url = `${origin}${path}`;
    await ui.locator('#new').click();
    await ui.getByLabel('连接类型').selectOption('magpie');
    await expect(ui.getByLabel('用户名', { exact: true })).toBeHidden();
    await ui.getByLabel('连接名称').fill(first.name);
    if (path === '/status') {
      await ui.getByLabel('服务器地址').fill(`${url}?token=fixture`);
      await ui.getByRole('button', { name: '保存连接' }).click();
      await expect(ui.locator('#form-error')).toContainText('可带一个非空的 k 参数');
    }
    await ui.getByLabel('服务器地址').fill(url);
    await expect(ui.locator('#http-warning')).toContainText('访问密钥');
    await expect(ui.locator('#http-warning')).toBeVisible();
    await ui.getByRole('button', { name: '保存连接' }).click();
    await expect(ui.locator('#editor')).toBeHidden({ timeout: 3000 });
    await ui.locator('#connections').getByRole('button', { name: `编辑 ${first.name}` }).click();
    await expect(ui.getByLabel('连接类型')).toHaveValue('magpie');
    await expect(ui.getByLabel('服务器地址')).toHaveValue(url);
    await expect(ui.getByLabel('用户名', { exact: true })).toBeHidden();
    await ui.locator('#editor-cancel').click();
    await ui.locator('#connections').getByRole('button', { name: first.name, exact: true }).click();
    await expect.poll(() => views().then(items => items.some(view => view.path === path && view.visible))).toBe(true);
  });
}

test('Magpie 标签、六个设置页、切换 Selkies 与标签会话隔离', async () => {
  seed([{ ...first, url: `${origin}/?k=alpha` }, { ...second, url: `${origin}/?k=beta` }, { ...desktop, url: origin }]);
  await launch();
  const sidebar = ui.locator('#connections');
  await sidebar.getByRole('button', { name: first.name, exact: true }).click();
  await expect.poll(() => views().then(items => items.some(view => view.path === '/?k=alpha' && view.visible))).toBe(true);
  await sidebar.getByRole('button', { name: second.name, exact: true }).click();
  await expect.poll(() => views().then(items => items.some(view => view.path === '/?k=beta' && view.visible))).toBe(true);
  const beta = app.windows().find(page => page.url().endsWith('?k=beta'))!;
  await expect(beta.locator('#previous')).toHaveText('none');
  const tabs = ui.locator('#magpie-tabs');
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  const tabBottom = await tabs.evaluate(node => node.getBoundingClientRect().bottom);
  expect((await views()).find(view => view.path === '/?k=beta')!.bounds.y).toBeGreaterThanOrEqual(tabBottom);
  await tabs.getByRole('tab', { name: first.name }).click();
  const alpha = (await views()).find(view => view.path === '/?k=alpha')!;
  expect(alpha.visible).toBe(true);

  await ui.locator('#open-settings').click();
  const settings = ui.getByRole('dialog', { name: '设置' });
  await expect(settings).toBeVisible();
  expect((await views()).find(view => view.id === alpha.id)?.visible).toBe(false);
  const settingsTabs = settings.getByRole('tab');
  await expect(settingsTabs).toHaveCount(6);
  for (const tab of await settingsTabs.all()) {
    await expect(tab).toHaveText(/\S/);
    await tab.click();
    const pane = settings.getByRole('tabpanel');
    await expect(pane).toBeVisible();
    for (const label of await pane.locator('[data-i18n]:visible').all()) await expect(label).toHaveText(/\S/);
  }
  await ui.locator('#settings-close').click();
  await expect.poll(() => views().then(items => items.find(view => view.id === alpha.id)?.visible)).toBe(true);
  await ui.locator('#toggle-sidebar').click();
  const collapsedAlpha = (await views()).find(view => view.id === alpha.id)!;
  expect(collapsedAlpha.bounds.x).toBe(0);
  await ui.locator('#toggle-sidebar').click();

  await sidebar.getByRole('button', { name: desktop.name, exact: true }).click();
  await expect.poll(async () => (await invoke({ type: 'state' })).state?.status.phase).toBe('loaded');
  expect((await views()).some(view => view.id === alpha.id && view.visible)).toBe(false);
  await sidebar.getByRole('button', { name: first.name, exact: true }).click();
  await expect.poll(() => views().then(items => items.find(view => view.id === alpha.id)?.visible)).toBe(true);
  expect(requests.filter(node => node === 'alpha')).toHaveLength(1);
  await ui.locator('#disconnect').click();
  await expect.poll(() => views().then(items => items.some(view => view.id === alpha.id))).toBe(false);
  await expect(tabs.getByRole('tab')).toHaveCount(1);
});

test('空白的 401 显示错误，客户端内可重试，退出后可恢复标签', async () => {
  seed([{ ...first, url: `${origin}/?k=alpha` }], [first.id]);
  unauthorized = true;
  await launch();
  await ui.locator('#connections').getByRole('button', { name: first.name, exact: true }).click();
  await expect(ui.locator('#state-detail')).toContainText('401', { timeout: 4000 });
  expect((await views()).some(view => view.path === '/?k=alpha' && view.visible)).toBe(false);
  unauthorized = false;
  await ui.locator('#state-connect').click();
  await expect.poll(() => views().then(items => items.some(view => view.path === '/?k=alpha' && view.visible))).toBe(true);
  const beforeQuit = requests.length;
  await app.close();
  await launch();
  const restore = ui.getByRole('button', { name: '恢复 Magpie 标签' });
  await expect(restore).toBeVisible();
  expect(requests).toHaveLength(beforeQuit);
  await restore.click();
  await expect.poll(() => views().then(items => items.some(view => view.path === '/?k=alpha' && view.visible))).toBe(true);
});
