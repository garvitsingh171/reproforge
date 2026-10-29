import { mkdir, writeFile, readFile, mkdtemp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import JSZip from 'jszip';
import { generateProject, projectZip } from '@reproforge/test-generator';
import { createDemoApp, demoPayload } from '../apps/demo-api/src/app';
import { normalizeRequest } from '../apps/extension/src/features/network-capture/normalize';
import { har } from '../tests/fixtures';
const standalone = process.env.REPROFORGE_STANDALONE === '1';
const directory = standalone
  ? await mkdtemp(join(tmpdir(), 'reproforge-export-'))
  : resolve('artifacts/generated-regression');
await mkdir(resolve('artifacts'), { recursive: true });
await mkdir(directory, { recursive: true });
const record = normalizeRequest(har({ body: JSON.stringify(demoPayload) }))!;
const project = generateProject({
  method: 'POST',
  path: record.path,
  observedStatus: record.status,
  expectedStatus: 201,
  title: 'Creates a valid monthly investment',
  body: record.requestBody.data,
});
if (process.argv[2]) {
  const archive = await JSZip.loadAsync(
    await readFile(resolve(process.argv[2])),
  );
  for (const name of Object.keys(project.files)) {
    const file = archive.file(name);
    if (!file) throw new Error('Bundle missing ' + name);
    await writeFile(resolve(directory, name), await file.async('string'));
  }
  console.log('Testing actual downloaded bundle:', process.argv[2]);
} else
  for (const [name, content] of Object.entries(project.files))
    await writeFile(resolve(directory, name), content);
await writeFile(
  resolve('artifacts/generated-regression.zip'),
  await projectZip(project),
);
function run(
  args: string[],
  env: NodeJS.ProcessEnv = {},
  executable = process.execPath,
) {
  return new Promise<{ code: number | null; output: string }>(
    (resolveResult) => {
      const child = spawn(executable, args, {
        cwd: directory,
        env: { ...process.env, NO_COLOR: '1', ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => (output += String(chunk)));
      child.stderr.on('data', (chunk) => (output += String(chunk)));
      child.on('close', (code) => resolveResult({ code, output }));
    },
  );
}
if (standalone) {
  console.log('Installing standalone project in', directory);
  const installed = await run(
    ['install', '--no-audit', '--no-fund'],
    {},
    'npm',
  );
  if (installed.code !== 0) throw new Error(installed.output);
}
const dependencyRoot = standalone ? directory : process.cwd();
const compile = await run([
  resolve(dependencyRoot, 'node_modules/typescript/bin/tsc'),
  '--noEmit',
  '--project',
  'tsconfig.json',
]);
if (compile.code !== 0)
  throw new Error(
    'Generated TypeScript compilation failed:\n' + compile.output,
  );
console.log('Generated project typecheck: PASS');
const original = await readFile(
  resolve(directory, 'regression.test.ts'),
  'utf8',
);
const report: string[] = [];
for (const mode of ['buggy', 'fixed'] as const) {
  const server = createDemoApp(mode).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  try {
    await writeFile(
      resolve(directory, '.env'),
      `TEST_BASE_URL=http://127.0.0.1:${port}\n`,
    );
    const result = standalone
      ? await run(['test'], {}, 'npm')
      : await run(
          [
            resolve(dependencyRoot, 'node_modules/vitest/vitest.mjs'),
            'run',
            '--config',
            'vitest.config.ts',
          ],
          { TEST_BASE_URL: `http://127.0.0.1:${port}` },
        );
    await writeFile(resolve('artifacts', `${mode}-test.log`), result.output);
    if (
      mode === 'buggy' &&
      (result.code === 0 ||
        !result.output.includes('Expected HTTP 201; received HTTP 422'))
    )
      throw new Error(
        'Buggy test did not fail for the intended assertion:\n' + result.output,
      );
    if (mode === 'fixed' && result.code !== 0)
      throw new Error('Fixed test failed:\n' + result.output);
    const line = `${mode}: ${mode === 'buggy' ? 'EXPECTED FAILURE (expected 201, received 422)' : 'PASS (201)'}; runner exit ${result.code}`;
    report.push(line);
    console.log(line);
  } finally {
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
}
if (
  (await readFile(resolve(directory, 'regression.test.ts'), 'utf8')) !==
  original
)
  throw new Error('Test changed between modes');
await writeFile(
  resolve('artifacts/red-green.txt'),
  [
    'Generated project typecheck: PASS',
    standalone
      ? 'Standalone npm install + npm test with .env: PASS'
      : 'Used repository toolchain for generated-project execution.',
    ...report,
    'Exact same generated test used for both modes.',
  ].join('\n') + '\n',
);
console.log(
  'Verified identical generated test in both modes. Evidence: artifacts/red-green.txt',
);
