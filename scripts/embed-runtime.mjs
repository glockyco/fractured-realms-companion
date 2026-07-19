import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generatedDirectory = resolve(projectRoot, 'src/generated');
const assets = [
  ['ELECTRON_HOST_SOURCE', 'runtime/electron-host.cjs'],
  ['FRACTURED_ADAPTER_SOURCE', 'runtime/fractured-adapter.cjs'],
  ['OVERLAY_SOURCE', 'overlay/overlay.js'],
];

await mkdir(generatedDirectory, { recursive: true });
const exports = [];
for (const [name, relativePath] of assets) {
  const source = await readFile(resolve(projectRoot, relativePath), 'utf8');
  exports.push(`export const ${name} = ${JSON.stringify(source)};`);
}
await writeFile(resolve(generatedDirectory, 'embedded.ts'), `${exports.join('\n\n')}\n`, 'utf8');
