import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
const zip = new JSZip();
const root = path.resolve('apps/extension/dist');
async function add(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await add(file);
    else zip.file(path.relative(root, file), await readFile(file));
  }
}
await add(root);
await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/reproforge-0.2.0.zip',
  await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
);
console.log(
  'Created artifacts/reproforge-0.2.0.zip with manifest.json at ZIP root. Not published.',
);
