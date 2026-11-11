import { app, net, shell } from 'electron';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { accessSync, constants, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { compareVersions, defaultDownloadPrefix, defaultFeed, macBundle, macReplaceScript, offerFrom, parseChecksums, type UpdateOffer } from './update';
import type { OS } from './platform';
import { t, type Message } from './i18n';

const run = promisify(execFile);
export type UpdatePhase = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error';
export type UpdateState = {
  phase: UpdatePhase;
  current: string;
  latest?: string;
  /** 0–100 while downloading. */
  progress?: number;
  message: string;
  checkedAt?: number;
};

/**
 * Finds, downloads and installs new versions from the project's GitHub releases.
 *
 * Every download is checked against the SHA-256 list published with the release before it is
 * used. That guards against a damaged or swapped file on the way; it is not a publisher
 * signature, which this app does not have.
 */
export class Updater {
  private phase: UpdatePhase = 'idle';
  private note: Message = ['update.idle'];
  private offer?: UpdateOffer;
  private file?: string;
  private progress?: number;
  private checkedAt?: number;
  private busy?: Promise<void>;
  private readonly directory: string;
  private readonly feed: string;
  private readonly downloadPrefix: string;

  constructor(userData: string, private os: OS, private changed: () => void, private quit: () => void) {
    this.directory = join(userData, 'updates');
    // Tests point the app at a local feed. Only this computer's own loopback address is accepted.
    const override = app.commandLine.getSwitchValue('update-feed');
    const local = /^http:\/\/127\.0\.0\.1:\d{2,5}\//.test(override);
    this.feed = local ? override : defaultFeed;
    this.downloadPrefix = local ? `${new URL(override).origin}/` : defaultDownloadPrefix;
  }
  get state(): UpdateState {
    return { phase: this.phase, current: app.getVersion(), latest: this.offer?.version, progress: this.progress, message: t(...this.note), checkedAt: this.checkedAt };
  }
  private set(phase: UpdatePhase, note: Message) {
    this.phase = phase;
    this.note = note;
    if (phase !== 'downloading') this.progress = undefined;
    this.changed();
  }
  private once(work: () => Promise<void>) {
    this.busy ??= work().finally(() => { this.busy = undefined; });
    return this.busy;
  }

  /** Looks for a newer release. `download` continues straight into the download when one is found. */
  check(download: boolean) {
    return this.once(async () => {
      if (this.phase === 'downloading' || this.phase === 'ready') return;
      this.set('checking', ['update.checking']);
      try {
        const response = await net.fetch(this.feed, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Selkies-Desk' }, cache: 'no-store' });
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        const body: unknown = await response.json();
        this.checkedAt = Date.now();
        const tag = typeof body === 'object' && body && 'tag_name' in body ? String(body.tag_name) : '';
        if (!tag || compareVersions(tag, app.getVersion()) <= 0) { this.offer = undefined; this.set('current', ['update.current']); return; }
        const offer = offerFrom(body, this.os, process.arch, this.downloadPrefix);
        if (!offer) { this.offer = undefined; this.set('current', ['update.noBuild', { version: tag.replace(/^v/, '') }]); return; }
        this.offer = offer;
        this.set('available', ['update.available', { version: offer.version }]);
        if (download) await this.fetch();
      } catch (error) {
        this.set('error', ['update.checkFailed', { reason: error instanceof Error ? error.message : String(error) }]);
      }
    });
  }
  download() { return this.once(() => this.fetch()); }

  private async fetch() {
    const offer = this.offer;
    if (!offer || this.phase === 'ready') return;
    this.progress = 0;
    this.set('downloading', ['update.downloading', { version: offer.version }]);
    rmSync(this.directory, { recursive: true, force: true });
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const target = join(this.directory, offer.installer.name);
    try {
      const sums = await net.fetch(offer.checksums.url, { cache: 'no-store' });
      if (!sums.ok) throw Error(`HTTP ${sums.status}`);
      const expected = parseChecksums(await sums.text()).get(offer.installer.name);
      if (!expected) throw Error(t('update.noChecksum'));
      const response = await net.fetch(offer.installer.url, { cache: 'no-store' });
      if (!response.ok || !response.body) throw Error(`HTTP ${response.status}`);
      const hash = createHash('sha256');
      const output = createWriteStream(target, { mode: 0o600 });
      const total = Number(response.headers.get('content-length')) || offer.installer.size;
      let received = 0;
      let shown = 0;
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        if (!output.write(value)) await new Promise<void>(resolve => output.once('drain', () => resolve()));
        received += value.byteLength;
        const percent = total ? Math.min(99, Math.floor(received / total * 100)) : 0;
        if (percent !== shown) { shown = percent; this.progress = percent; this.changed(); }
      }
      await new Promise<void>((resolve, reject) => output.end((error?: Error | null) => error ? reject(error) : resolve()));
      if (hash.digest('hex') !== expected) {
        rmSync(target, { force: true });
        throw Error(t('update.badChecksum'));
      }
      this.file = target;
      this.set('ready', ['update.ready', { version: offer.version }]);
    } catch (error) {
      rmSync(target, { force: true });
      this.set('error', ['update.downloadFailed', { reason: error instanceof Error ? error.message : String(error) }]);
    }
  }

  /** Installs the downloaded version. On macOS and Windows the app quits and comes back updated. */
  async install() {
    const offer = this.offer;
    const file = this.file;
    if (!offer || !file || this.phase !== 'ready' || !existsSync(file)) return;
    try {
      if (this.os === 'windows') {
        spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
        this.quit();
      } else if (this.os === 'linux') {
        shell.showItemInFolder(file);
        this.set('ready', ['update.linuxManual', { file }]);
      } else await this.replaceMacApp(offer, file);
    } catch (error) {
      shell.showItemInFolder(file);
      this.set('ready', ['update.manual', { reason: error instanceof Error ? error.message : String(error) }]);
    }
  }
  private async replaceMacApp(offer: UpdateOffer, zip: string) {
    const bundle = macBundle(app.getPath('exe'));
    if (!app.isPackaged || !bundle) throw Error(t('update.notInstalled'));
    if (bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')) throw Error(t('update.moveFirst'));
    const parent = dirname(bundle);
    try { accessSync(parent, constants.W_OK); } catch { throw Error(t('update.notWritable', { folder: parent })); }
    // Unpacked beside the installed app, on the same volume, so the final swap is a plain rename.
    const stage = mkdtempSync(join(parent, '.selkies-desk-update-'));
    try {
      await run('/usr/bin/ditto', ['-x', '-k', zip, stage]);
      const name = readdirSync(stage).find(entry => entry.endsWith('.app'));
      if (!name) throw Error(t('update.badPackage'));
      const fresh = join(stage, name);
      const read = async (key: string) => (await run('/usr/bin/plutil', ['-extract', key, 'raw', join(fresh, 'Contents', 'Info.plist')])).stdout.trim();
      const installed = async (key: string) => (await run('/usr/bin/plutil', ['-extract', key, 'raw', join(bundle, 'Contents', 'Info.plist')])).stdout.trim();
      // It must be this app, the version that was offered, and intact.
      if (await read('CFBundleIdentifier') !== await installed('CFBundleIdentifier') || await read('CFBundleShortVersionString') !== offer.version) throw Error(t('update.badPackage'));
      await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', fresh]);
      const script = join(this.directory, 'apply.sh');
      writeFileSync(script, macReplaceScript, { mode: 0o700 });
      // The new app starts with the same profile it was running with.
      const keep = process.argv.slice(1).filter(value => value.startsWith('--user-data-dir=') || value.startsWith('--update-feed='));
      spawn('/bin/sh', [script, String(process.pid), bundle, fresh, stage, ...keep], { detached: true, stdio: 'ignore' }).unref();
      this.set('ready', ['update.restarting']);
      this.quit();
    } catch (error) {
      rmSync(stage, { recursive: true, force: true });
      throw error;
    }
  }
  /** The release page, opened in the browser. Only this project's GitHub pages are opened. */
  openNotes() {
    const url = this.offer?.notes || `https://github.com/zinohome/Selkies-Desk/releases`;
    if (url.startsWith('https://github.com/zinohome/Selkies-Desk/')) void shell.openExternal(url);
  }
}
