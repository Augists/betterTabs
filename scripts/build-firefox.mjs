import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { build } from 'esbuild';

const firefoxDist = resolve('dist-firefox');
if (!firefoxDist.startsWith(resolve(process.cwd()) + sep)) throw new Error('Unexpected output path');
await rm(firefoxDist, { recursive: true, force: true });
await cp('dist', firefoxDist, { recursive: true, force: true });
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
delete manifest.minimum_chrome_version;
manifest.background = { scripts: ['background.js'] };
manifest.browser_specific_settings = {
  gecko: {
    id: 'qiqian@augists',
    strict_min_version: '142.0',
    data_collection_permissions: { required: ['none'] },
  },
};
await writeFile('dist-firefox/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
await build({ entryPoints: ['src/background.ts'], bundle: true, format: 'iife', outfile: 'dist-firefox/background.js' });
