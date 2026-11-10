import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

mkdirSync('assets', { recursive: true });
mkdirSync('.qa/icon.iconset', { recursive: true });
execFileSync('/usr/bin/swift', ['scripts/icon.swift', resolve('assets/icon.png')], { stdio: 'inherit' });
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const pixels = String(size * scale);
    execFileSync('/usr/bin/sips', ['-z', pixels, pixels, 'assets/icon.png', '--out', `.qa/icon.iconset/icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`], { stdio: 'ignore' });
  }
}
execFileSync('/usr/bin/iconutil', ['-c', 'icns', '.qa/icon.iconset', '-o', 'assets/icon.icns'], { stdio: 'inherit' });
mkdirSync('assets/icons', { recursive: true });
for (const size of [16, 32, 48, 64, 128, 256, 512]) {
  execFileSync('/usr/bin/sips', ['-z', String(size), String(size), 'assets/icon.png', '--out', `assets/icons/${size}x${size}.png`], { stdio: 'ignore' });
}
