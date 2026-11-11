/**
 * Update logic that needs no Electron: reading a release, choosing the file for this computer,
 * checking it, and the script that swaps the macOS app bundle. Kept separate so it can be tested.
 */
import { z } from 'zod';
import type { OS } from './platform';

export const repository = 'zinohome/Selkies-Desk';
export const defaultFeed = `https://api.github.com/repos/${repository}/releases/latest`;
export const defaultDownloadPrefix = `https://github.com/${repository}/releases/download/`;

const releaseSchema = z.object({
  tag_name: z.string().max(40),
  html_url: z.string().max(500),
  assets: z.array(z.object({ name: z.string().max(200), browser_download_url: z.string().max(1000), size: z.number().int().nonnegative() })).max(100)
});
export type UpdateFile = { name: string; url: string; size: number };
export type UpdateOffer = {
  version: string;
  notes: string;
  /** What the app installs itself: a zip of the app on macOS, the installer elsewhere. */
  installer: UpdateFile;
  checksums: UpdateFile;
};

/** Numeric comparison of dotted versions such as 0.4.1 and 0.10.0; a leading "v" is ignored. */
export function compareVersions(a: string, b: string) {
  const parts = (value: string) => value.replace(/^v/, '').split('.').map(part => Number.parseInt(part, 10) || 0);
  const [left, right] = [parts(a), parts(b)];
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}
/** File the app installs on this system; the names are the ones every release is published with. */
export function installerName(version: string, os: OS, arch: string) {
  if (os === 'mac') return arch === 'arm64' || arch === 'x64' ? `Selkies-Desk-${version}-mac-${arch}.zip` : undefined;
  if (arch !== 'x64') return undefined;
  return os === 'windows' ? `Selkies-Desk-${version}-windows-x64-setup.exe` : `selkies-desk_${version}_amd64.deb`;
}
/**
 * Reads a release description and picks this computer's files. Returns undefined when the release
 * has nothing for it. Download addresses outside `downloadPrefix` are refused, so a tampered
 * description cannot point the app at another site.
 */
export function offerFrom(json: unknown, os: OS, arch: string, downloadPrefix = defaultDownloadPrefix): UpdateOffer | undefined {
  const release = releaseSchema.parse(json);
  const version = release.tag_name.replace(/^v/, '');
  if (!/^\d+(\.\d+){1,3}$/.test(version)) return undefined;
  const wanted = installerName(version, os, arch);
  const find = (name: string | undefined) => {
    const asset = release.assets.find(candidate => candidate.name === name);
    return asset && asset.browser_download_url.startsWith(downloadPrefix) ? { name: asset.name, url: asset.browser_download_url, size: asset.size } : undefined;
  };
  const installer = find(wanted);
  const checksums = find(`SHA256SUMS-${version}.txt`);
  if (!installer || !checksums) return undefined;
  return { version, notes: release.html_url, installer, checksums };
}
/** Parses `sha256sum` output: one "<64 hex>  <file name>" per line. */
export function parseChecksums(text: string) {
  const sums = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (match) sums.set(match[2].trim(), match[1].toLowerCase());
  }
  return sums;
}
/** The bundle of a running macOS app, from its executable path; undefined when that is not an app bundle. */
export function macBundle(executable: string) {
  const match = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/.exec(executable);
  return match ? match[1] : undefined;
}
/**
 * Shell script that replaces the app once it has quit, then starts the new one.
 * Arguments: process id to wait for, the installed bundle, the new bundle, the staging directory,
 * then any switches the new app should be started with.
 * The old app is only moved aside, and moved back if the new one cannot be put in place.
 */
export const macReplaceScript = `#!/bin/sh
PID="$1"; APP="$2"; NEW="$3"; STAGE="$4"
i=0
while kill -0 "$PID" 2>/dev/null && [ $i -lt 150 ]; do sleep 0.2; i=$((i + 1)); done
OLD="$STAGE/previous.app"
if mv "$APP" "$OLD"; then
  if mv "$NEW" "$APP"; then
    rm -rf "$STAGE"
  else
    mv "$OLD" "$APP"
    rm -rf "$STAGE"
  fi
fi
shift 4
if [ $# -gt 0 ]; then /usr/bin/open "$APP" --args "$@"; else /usr/bin/open "$APP"; fi
`;
