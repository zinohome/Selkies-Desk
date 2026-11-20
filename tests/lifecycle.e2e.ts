import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MockDesktop } from './fixtures';

test('macOS 菜单栏左右键、后台会话、恢复窗口、中英文菜单和彻底退出', async () => {
  test.skip(process.platform !== 'darwin', 'macOS 菜单栏驻留');
  const directory = mkdtempSync(join(tmpdir(), 'selkies-lifecycle-'));
  const profile = join(directory, 'profile');
  mkdirSync(profile);
  writeFileSync(join(profile, 'connections.json'), JSON.stringify({
    version: 1, connections: [], certificates: {},
    settings: { language: 'zh', autoFocus: false, autoReconnect: false, thumbnails: false, updateMode: 'off' }
  }));
  const server = await new MockDesktop().start();
  const application = await electron.launch({
    ...(process.env.SELKIES_PACKAGED_PATH ? { executablePath: process.env.SELKIES_PACKAGED_PATH } : {}),
    args: [...(process.env.SELKIES_PACKAGED_PATH ? [] : [resolve('.')]), `--user-data-dir=${profile}`],
    colorScheme: null
  });
  let exited = false;
  application.on('close', () => { exited = true; });
  try {
    await expect.poll(() => application.windows().some(page => page.url().endsWith('/index.html'))).toBe(true);
    const ui = application.windows().find(page => page.url().endsWith('/index.html'))!;
    const invoke = (action: unknown) => ui.evaluate(action => (window as any).desk.invoke(action), action);
    await application.evaluate(({ Tray }) => {
      const original = Tray.prototype.setToolTip;
      (globalThis as any).originalTrayTooltip = original;
      Tray.prototype.setToolTip = function(tooltip) {
        (globalThis as any).testTray = this;
        original.call(this, tooltip);
      };
    });
    await invoke({ type: 'settings', settings: { language: 'zh' } });
    const trayBounds = await application.evaluate(({ Tray }) => {
      Tray.prototype.setToolTip = (globalThis as any).originalTrayTooltip;
      const tray = (globalThis as any).testTray as Electron.Tray;
      tray.popUpContextMenu = menu => { (globalThis as any).testTrayMenu = menu; };
      return tray.getBounds();
    });
    expect(trayBounds.width).toBeGreaterThan(0);
    expect(trayBounds.height).toBeGreaterThan(0);
    const popup = () => application.evaluate(() => {
      (globalThis as any).testTray.emit('right-click');
      return ((globalThis as any).testTrayMenu as Electron.Menu).items.map(item => ({ label: item.label, enabled: item.enabled }));
    });
    const choose = (label: string) => application.evaluate((_electron, label) => {
      ((globalThis as any).testTrayMenu as Electron.Menu).items.find(item => item.label === label)!.click();
    }, label);
    const initialMenu = await popup();
    expect(initialMenu).toContainEqual({ label: '重连当前服务器', enabled: false });
    expect(initialMenu).toContainEqual({ label: '断开当前服务器', enabled: false });
    const saved = await invoke({ type: 'save', connection: { name: '后台会话', url: server.origin, username: 'alice' } });
    await invoke({ type: 'connect', id: saved.id });
    await expect.poll(async () => (await invoke({ type: 'state' })).state.prompt?.type).toBe('auth');
    const prompt = (await invoke({ type: 'state' })).state.prompt;
    await invoke({ type: 'answer', token: prompt.token, accept: true, username: 'alice', password: 'fixture-pass' });
    await expect.poll(() => server.webSockets).toBe(1);
    const remote = application.windows().find(page => /^http:/.test(page.url()))!;
    await remote.getByLabel('远端输入').fill('关闭窗口后仍保留');
    const remoteID = await application.evaluate(({ webContents }) => webContents.getAllWebContents().find(contents => /^http:/.test(contents.getURL()))!.id);
    const closeWindow = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    const visible = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());
    await closeWindow();
    expect(exited).toBe(false);
    await expect.poll(visible).toBe(false);
    expect(server.webSockets).toBe(1);
    expect((await invoke({ type: 'state' })).state.status.phase).toBe('loaded');
    const connectedMenu = await popup();
    expect(connectedMenu).toContainEqual({ label: '后台会话 — 已连接', enabled: false });
    expect(connectedMenu).toContainEqual({ label: '断开当前服务器', enabled: true });
    expect(await visible()).toBe(false);
    await application.evaluate(() => { (globalThis as any).testTray.emit('click'); });
    await expect.poll(visible).toBe(true);
    await closeWindow();
    await application.evaluate(({ app }) => { app.emit('activate'); });
    await expect.poll(visible).toBe(true);
    await expect(remote.getByLabel('远端输入')).toHaveValue('关闭窗口后仍保留');
    expect(await application.evaluate(({ webContents }) => webContents.getAllWebContents().find(contents => /^http:/.test(contents.getURL()))!.id)).toBe(remoteID);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    await application.evaluate(({ app }) => { app.emit('second-instance', {}, [], ''); });
    await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(false);
    await closeWindow();
    await popup();
    await choose('设置…');
    await expect.poll(visible).toBe(true);
    await expect(ui.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
    await ui.getByRole('button', { name: '关闭', exact: true }).click();
    await closeWindow();
    await popup();
    await choose('断开当前服务器');
    await expect.poll(() => server.webSockets).toBe(0);
    expect(await visible()).toBe(false);
    expect(await popup()).toContainEqual({ label: '断开当前服务器', enabled: false });
    await choose('重连当前服务器');
    await expect.poll(() => server.webSockets).toBe(1);
    expect(await visible()).toBe(false);
    await invoke({ type: 'settings', settings: { language: 'en' } });
    expect(await popup()).toContainEqual({ label: 'Open Main Window', enabled: true });
    await choose('Open Main Window');
    await expect.poll(visible).toBe(true);
    await closeWindow();
    await popup();
    const closed = application.waitForEvent('close');
    await choose('Quit Selkies Desk');
    await closed;
    await expect.poll(() => server.webSockets).toBe(0);
    expect(exited).toBe(true);
  } finally {
    if (!exited) await application.close();
    await server.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
