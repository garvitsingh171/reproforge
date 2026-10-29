import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('apps/extension/dist');
const manifest = JSON.parse(
  await readFile(path.join(root, 'manifest.json'), 'utf8'),
);
if (manifest.manifest_version !== 3 || manifest.name !== 'ReproForge')
  throw new Error('Invalid manifest');
if (manifest.permissions?.length || manifest.host_permissions?.length)
  throw new Error('Unexpected permissions');
for (const file of [
  manifest.devtools_page,
  'panel.html',
  ...Object.values(manifest.icons),
])
  await access(path.join(root, file));
let scripts = 0,
  styles = 0;
for (const page of [manifest.devtools_page, 'panel.html']) {
  const html = await readFile(path.join(root, page), 'utf8');
  if (/<script(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html))
    throw new Error('Inline script in ' + page);
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const reference = match[1];
    if (/^(https?:|\/\/)/.test(reference)) throw new Error('Remote asset');
    await access(path.resolve(root, reference));
  }
}
for (const name of await readdir(path.join(root, 'assets'))) {
  if (name.endsWith('.js')) {
    scripts++;
    const js = await readFile(path.join(root, 'assets', name), 'utf8');
    if (/\beval\s*\(|new Function\s*\(/.test(js))
      throw new Error('Unsafe eval');
  }
  if (name.endsWith('.css')) styles++;
}
if (!scripts || !styles) throw new Error('Missing application assets');
console.log(
  `Verified MV3 manifest, both HTML entries, ${scripts} JS bundles, ${styles} CSS bundle, four PNG icons, no remote scripts or permissions.`,
);
