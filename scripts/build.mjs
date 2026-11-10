import { build } from 'esbuild';
import { mkdir, cp } from 'node:fs/promises';

await mkdir('dist/ui', { recursive: true });
await Promise.all([
  build({ entryPoints: ['src/main.ts'], bundle: true, platform: 'node', target: 'node24', format: 'cjs', external: ['electron'], outfile: 'dist/main.cjs' }),
  build({ entryPoints: ['src/preload.ts'], bundle: true, platform: 'node', target: 'node24', format: 'cjs', external: ['electron'], outfile: 'dist/preload.cjs' }),
  build({ entryPoints: ['src/ui/renderer.ts'], bundle: true, platform: 'browser', target: 'chrome150', format: 'iife', outfile: 'dist/ui/renderer.js' }),
  build({ entryPoints: ['src/ui/controls.ts'], bundle: true, platform: 'browser', target: 'chrome150', format: 'iife', outfile: 'dist/ui/controls.js' }),
  cp('node_modules/lucide/LICENSE', 'dist/LUCIDE-LICENSE.txt'),
  cp('src/ui/controls.html', 'dist/ui/controls.html'),
  cp('src/ui/controls.css', 'dist/ui/controls.css'),
  cp('src/ui/index.html', 'dist/ui/index.html'),
  cp('src/ui/style.css', 'dist/ui/style.css')
]);
