import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const webDir = resolve(root, 'www');

await rm(webDir, { recursive: true, force: true });
await mkdir(webDir, { recursive: true });
await copyFile(resolve(root, 'index.html'), resolve(webDir, 'index.html'));

await build({
  entryPoints: [resolve(root, 'src/firebase-bridge.mjs')],
  outfile: resolve(webDir, 'firebase-bundle.js'),
  bundle: true,
  minify: true,
  legalComments: 'none',
  format: 'iife',
  platform: 'browser',
  target: ['chrome120'],
});

const indexInfo = await stat(resolve(webDir, 'index.html'));
const bundleInfo = await stat(resolve(webDir, 'firebase-bundle.js'));
console.log(`Web assets ready: index=${indexInfo.size} bytes, firebase=${bundleInfo.size} bytes`);
