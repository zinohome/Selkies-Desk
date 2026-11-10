import { _electron as electron } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { MockDesktop } from './fixtures';

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'selkies-interactive-'));
  const mock = await new MockDesktop().start();
  const executablePath = resolve('release/mac-arm64/Selkies Desk.app/Contents/MacOS/Selkies Desk');
  const application = await electron.launch({
    executablePath, args: [`--user-data-dir=${join(directory, 'profile')}`]
  });
  try {
    await application.firstWindow();
    const port = Number(readFileSync(join(directory, 'profile/DevToolsActivePort'), 'utf8').split('\n')[0]);
    const details = { pid: application.process().pid, port, mockOrigin: mock.origin };
    writeFileSync('.qa/interactive-state.json', JSON.stringify(details, null, 2));
    console.log(JSON.stringify(details));
    console.log('输入 exit 完成本机人工交互验收并关闭应用。五分钟后自动清理。');
    const lines = createInterface({ input: process.stdin });
    const timeout = setTimeout(() => lines.close(), 300000);
    for await (const line of lines) { if (line.trim() === 'exit') break; }
    clearTimeout(timeout);
    lines.close();
  } finally {
    await application.close();
    await mock.stop();
    rmSync(directory, { recursive: true, force: true });
  }
  console.log('应用及模拟服务已关闭，临时会话已清理。');
}
void main().catch(error => { console.error(error.message); process.exitCode = 1; });
