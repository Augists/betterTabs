import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const version = JSON.parse(await readFile('package.json', 'utf8')).version;
await mkdir('release', { recursive: true });
for (const [dir, target] of [
  ['dist', `Qiqian-${version}-Chromium-Chrome-Edge.zip`],
  ['dist-firefox', `Qiqian-${version}-Firefox-unsigned.zip`],
]) {
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  if (manifest.version !== version) throw new Error(`${dir}: manifest version differs`);
  const entries = await readdir(dir);
  if (!entries.includes('background.js') || !entries.includes('index.html')) throw new Error(`${dir}: incomplete build`);
  execFileSync('tar', ['-a', '-cf', `release/${target}`, '-C', dir, ...entries], { stdio: 'inherit' });
  console.log(`release/${target}`);
}
const files = [`Qiqian-${version}-Chromium-Chrome-Edge.zip`, `Qiqian-${version}-Firefox-unsigned.zip`];
const sums = await Promise.all(files.map(async (file) => `${createHash('sha256').update(await readFile(join('release', file))).digest('hex')}  ${file}`));
await writeFile('release/SHA256SUMS.txt', sums.join('\n') + '\n');
