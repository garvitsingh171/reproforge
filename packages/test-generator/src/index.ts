import { z } from 'zod';
import JSZip from 'jszip';
import {
  methodSchema,
  sanitizeJson,
  redactText,
  sanitizeHeaders,
  sanitizeUrl,
  REDACTED,
} from '@reproforge/shared';
import { runtimeSource } from './runtime-source';
const inputSchema = z
  .object({
    method: methodSchema,
    path: z
      .string()
      .min(1)
      .max(1024)
      .refine(
        (p) =>
          p.startsWith('/') &&
          !p.startsWith('//') &&
          !/[\\?#\s]/.test(p) &&
          !/%(?:2f|5c|2e)/i.test(p) &&
          !p.split('/').includes('..'),
        'Use an absolute path without a host, query, traversal, or fragment.',
      ),
    observedStatus: z.number().int().min(400).max(599),
    expectedStatus: z.number().int().min(100).max(599),
    title: z.string().trim().min(3).max(140),
    description: z.string().max(1000).default(''),
    body: z.unknown().optional(),
    bodyRequired: z.boolean().default(false),
    headers: z.record(z.string(), z.string()).default({}),
    query: z.record(z.string(), z.string()).default({}),
    auth: z.enum(['none', 'bearer', 'api-key']).default('none'),
    allowDelete: z.boolean().default(false),
    confirmSameStatus: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.method === 'DELETE' && !v.allowDelete)
      ctx.addIssue({
        code: 'custom',
        message: 'DELETE requires explicit opt-in.',
        path: ['allowDelete'],
      });
    if (v.expectedStatus === v.observedStatus && !v.confirmSameStatus)
      ctx.addIssue({
        code: 'custom',
        message:
          'Confirm that the observed status is intentionally the expected behavior.',
        path: ['expectedStatus'],
      });
    if (['GET', 'HEAD', 'OPTIONS'].includes(v.method) && v.body !== undefined)
      ctx.addIssue({
        code: 'custom',
        message: 'Bodies are supported only for POST, PUT, PATCH and DELETE.',
        path: ['body'],
      });
    if (v.path.split('/').includes('graphql'))
      ctx.addIssue({
        code: 'custom',
        message:
          'GraphQL-specific assertions are outside this MVP. Create a dedicated test manually.',
        path: ['path'],
      });
  });
export type GeneratorInput = z.input<typeof inputSchema>;
export interface GeneratedProject {
  code: string;
  files: Record<string, string>;
  review: Record<string, unknown>;
  warnings: string[];
  needsConfiguration: boolean;
}
const quote = (value: unknown) =>
  JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
export function generateProject(input: GeneratorInput): GeneratedProject {
  const v = inputSchema.parse(input);
  // Reapply the capture boundary: callers cannot bypass path redaction.
  v.path = sanitizeUrl(`https://local.invalid${v.path}`).path;
  const sanitized = v.body === undefined ? undefined : sanitizeJson(v.body);
  const headers = sanitizeHeaders(
    Object.entries(v.headers).map(([name, value]) => ({ name, value })),
  );
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(v.query)) {
    if (['page', 'limit', 'offset'].includes(key) && /^\d{1,4}$/.test(value))
      query[key] = value;
    else if (
      ['sort', 'order', 'format'].includes(key) &&
      /^(asc|desc|json|amount|price|date)$/.test(value)
    )
      query[key] = value;
    else
      throw new Error(
        'Only page/limit/offset (up to 4 digits) and sort/order/format (approved enum values) are supported.',
      );
  }
  const needsFixture = Boolean(
    sanitized?.redacted ||
    (v.bodyRequired && v.body === undefined) ||
    JSON.stringify(sanitized?.data ?? '').includes(REDACTED),
  );
  const needsPath = v.path.includes('__REDACTED__');
  const warnings = [
    ...(needsFixture
      ? [
          'Set TEST_FIXTURE_JSON to a complete synthetic fixture before running.',
        ]
      : []),
    ...(needsPath ? ['Set TEST_PATH to replace excluded path segments.'] : []),
    ...(v.auth !== 'none'
      ? [
          'Configure TEST_AUTH_TOKEN with a test credential. Captured credentials are never exported.',
        ]
      : []),
    ...(['POST', 'PUT', 'PATCH', 'DELETE'].includes(v.method)
      ? [
          'This test changes server state when you run it. Use a disposable, authorized test environment.',
        ]
      : []),
  ];
  const review = {
    method: v.method,
    path: v.path,
    query,
    headers,
    body: sanitized?.data,
    observedStatus: v.observedStatus,
    expectedStatus: v.expectedStatus,
    title: redactText(v.title),
    description: redactText(v.description),
    auth: v.auth,
    needsFixture,
  };
  const code = `import { expect, test } from 'vitest';
import { targetUrl, fixture } from './safety';

// Checks developer-specified behavior. Observed HTTP ${v.observedStatus} is context, not the expected result.
// No captured origin or credentials are included. Redirects are blocked.
const description = ${quote(review.description)};
void description;

test(${quote(review.title)}, async () => {
  const url = targetUrl(${needsPath ? 'process.env.TEST_PATH || ' : ''}${quote(v.path)});
  const query: Record<string, string> = ${quote(query)};
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const headers: Record<string, string> = ${quote(headers)};
${
  v.auth !== 'none'
    ? `  const token = process.env.TEST_AUTH_TOKEN;
  if (!token || token === 'REPLACE_WITH_TEST_TOKEN') throw new Error('Configure TEST_AUTH_TOKEN with a test-only credential.');
  headers[${quote(v.auth === 'bearer' ? 'authorization' : 'x-api-key')}] = ${v.auth === 'bearer' ? "'Bearer ' + token" : 'token'};
`
    : ''
}${
    sanitized || needsFixture
      ? `  headers['content-type'] = 'application/json';
  const body = fixture(${quote(sanitized?.data ?? null)}, ${needsFixture});
`
      : ''
  }  const response = await fetch(url, {
    method: ${quote(v.method)}, headers,
${sanitized || needsFixture ? '    body: JSON.stringify(body),\n' : ''}    redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10_000),
  });
  // Do not print response bodies or headers: even a test server can return secrets.
  await response.body?.cancel();
  expect(response.status, 'Expected HTTP ${v.expectedStatus}; received HTTP ' + response.status).toBe(${v.expectedStatus});
}, 15_000);
`;
  const files: Record<string, string> = {
    'regression.test.ts': code,
    'safety.ts': runtimeSource,
    'package.json': JSON.stringify(
      {
        name: 'reproforge-regression',
        version: '1.0.0',
        private: true,
        type: 'module',
        engines: { node: '^22.12.0 || ^24.0.0 || >=26.0.0' },
        scripts: {
          test: 'node --env-file=.env ./node_modules/vitest/vitest.mjs run',
          typecheck: 'tsc --noEmit',
        },
        devDependencies: {
          vitest: '5.0.5',
          typescript: '6.0.3',
          '@types/node': '26.6.6',
        },
      },
      null,
      2,
    ),
    'tsconfig.json': JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: ['node'],
        },
        include: ['*.ts'],
      },
      null,
      2,
    ),
    'vitest.config.ts':
      "import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { include: ['regression.test.ts'] } });\n",
    '.env.example': `# Explicitly configure an authorized test server. No default target.\nTEST_BASE_URL=\n# Demo: http://127.0.0.1:4317\nTEST_ALLOWED_ORIGINS=\n${needsPath ? 'TEST_PATH=\n' : ''}${needsFixture ? '# Complete synthetic JSON, enclosed in single quotes:\nTEST_FIXTURE_JSON=\n' : ''}${v.auth !== 'none' ? 'TEST_AUTH_TOKEN=REPLACE_WITH_TEST_TOKEN\n' : ''}`,
    '.gitignore': 'node_modules/\n.env\n',
    'README.md': `# ReproForge regression test\n\nThis test checks your approved HTTP ${v.expectedStatus} outcome, not the captured ${v.observedStatus} failure.\n\n1. Install Node.js 22.12+ (Node 24 LTS recommended).\n2. Run \`npm install\`.\n3. Run \`cp .env.example .env\` and set TEST_BASE_URL to an authorized test origin (demo: http://127.0.0.1:4317).\n4. Configure any fixture/path/auth placeholders described below.\n5. Run \`npm run typecheck\`, then \`npm test\`.\n\nOnly localhost, 127.0.0.1 and [::1] are allowed by default. For a sandbox, configure an HTTPS .test hostname in your trusted DNS/hosts and add its exact origin to TEST_ALLOWED_ORIGINS. Arbitrary production domains and redirects are blocked. A loopback proxy can still forward traffic: you are responsible for the configured server. Never use production credentials.\n\n${warnings.map((w) => '- ' + w).join('\n')}\n\nThe test is not executed by the extension. It makes one request when you run it. State-changing tests may need a reset fixture between runs. It checks status only, not complete business correctness. No browser session, cookies or response bodies are exported.\n`,
  };
  return {
    code,
    files,
    review,
    warnings,
    needsConfiguration: needsFixture || needsPath || v.auth !== 'none',
  };
}
export async function projectZip(
  project: GeneratedProject,
): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(project.files))
    zip.file(name, content, { date: new Date('2026-01-01T00:00:00Z') });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
