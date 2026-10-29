import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import JSZip from 'jszip';
import { generateProject, projectZip, type GeneratorInput } from '../src';
import { runtimeSource } from '../src/runtime-source';
const base: GeneratorInput = {
  method: 'GET',
  path: '/api/products',
  observedStatus: 500,
  expectedStatus: 200,
  title: 'Returns valid products',
};
describe('deterministic generator', () => {
  it('generates a GET using explicit expected behavior and environment', () => {
    const p = generateProject(base);
    expect(p.code).toContain('toBe(200)');
    expect(p.code).toContain('method: "GET"');
    expect(p.code).toContain('/api/products');
    expect(p.files['safety.ts']).toContain('env.TEST_BASE_URL');
    expect(p.code).toContain("redirect: 'error'");
    expect(generateProject(base)).toEqual(p);
  });
  it('generates POST JSON with approved fields', () => {
    const p = generateProject({
      ...base,
      method: 'POST',
      expectedStatus: 201,
      body: { amount: 100, currency: 'USD' },
    });
    expect(p.code).toContain('toBe(201)');
    expect(p.code).toContain('JSON.stringify(body)');
    expect(p.code).toContain('method: "POST"');
    expect(p.needsConfiguration).toBe(false);
  });
  it('escapes executable strings as data', () => {
    const p = generateProject({
      ...base,
      title: `test '"\n\`; throw new Error('bad');//`,
    });
    const output = ts.transpileModule(p.code, {
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    });
    expect(output.diagnostics).toEqual([]);
  });
  it('rejects invalid inputs, DELETE without approval, same expected status without confirmation', () => {
    for (const change of [
      { expectedStatus: NaN },
      { expectedStatus: 999 },
      { method: 'TRACE' },
      { path: '//evil.test/api' },
      { path: '/api/../users' },
      { path: '/api/%2f/evil' },
      { path: '/api/graphql' },
      { method: 'DELETE' },
      { expectedStatus: 500 },
      { query: { token: 'secret' } },
    ])
      expect(() =>
        generateProject({ ...base, ...change } as GeneratorInput),
      ).toThrow();
    expect(() =>
      generateProject({ ...base, method: 'DELETE', allowDelete: true }),
    ).not.toThrow();
    expect(() =>
      generateProject({
        ...base,
        expectedStatus: 500,
        confirmSameStatus: true,
      }),
    ).not.toThrow();
  });
  it('never exports captured secrets through normalized input or approved headers/body', () => {
    const p = generateProject({
      ...base,
      method: 'POST',
      body: {
        amount: 100,
        password: 'password-value',
        items: [{ token: 'token-value', email: 'private@example.com' }],
      },
      headers: {
        authorization: 'Bearer auth-value',
        cookie: 'cookie-value',
        'x-api-key': 'key-value',
      },
      auth: 'bearer',
    });
    const output = JSON.stringify(p);
    for (const secret of [
      'password-value',
      'token-value',
      'private@example.com',
      'auth-value',
      'cookie-value',
      'key-value',
    ])
      expect(output).not.toContain(secret);
    expect(output).toContain('TEST_AUTH_TOKEN');
    expect(output).toContain('TEST_FIXTURE_JSON');
    expect(p.needsConfiguration).toBe(true);
  });
  it('writes a complete downloadable ZIP with matching reviewed files', async () => {
    const p = generateProject(base),
      zip = await JSZip.loadAsync(await projectZip(p));
    expect(Object.keys(zip.files).sort()).toEqual(Object.keys(p.files).sort());
    for (const [name, content] of Object.entries(p.files))
      expect(await zip.file(name)?.async('string')).toBe(content);
  });
  it('enforces local/test targets and path safety before fetch', async () => {
    const js = ts.transpileModule(runtimeSource, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const { targetUrl } = (await import(
      /* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
    )) as { targetUrl: (path: string, env: NodeJS.ProcessEnv) => URL };
    for (const url of [
      'https://production.example',
      'http://127.0.0.1.evil.test',
      'file:///tmp/test',
      'http://user:pass@localhost',
      'http://localhost/path',
      'https://demo.test',
    ])
      expect(() =>
        targetUrl('/api/products', { TEST_BASE_URL: url }),
      ).toThrow();
    expect(() => targetUrl('/api/products', {})).toThrow();
    for (const path of [
      '//evil.test',
      '/\\evil.test',
      '/api/../users',
      '/api/%2f/users',
      '/__REDACTED__',
      '/api?token=x',
    ])
      expect(() =>
        targetUrl(path, { TEST_BASE_URL: 'http://127.0.0.1:4317' }),
      ).toThrow();
    expect(
      targetUrl('/api/products', { TEST_BASE_URL: 'http://127.0.0.1:4317' })
        .href,
    ).toBe('http://127.0.0.1:4317/api/products');
    expect(
      targetUrl('/api/products', {
        TEST_BASE_URL: 'https://demo.test',
        TEST_ALLOWED_ORIGINS: 'https://demo.test',
      }).hostname,
    ).toBe('demo.test');
  });
});

describe('configuration boundaries', () => {
  it('requires complete fixtures for missing or redacted mutation bodies', () => {
    const p = generateProject({ ...base, method: 'PATCH', bodyRequired: true });
    expect(p.needsConfiguration).toBe(true);
    expect(p.code).toContain('fixture(null, true)');
    expect(p.files['.env.example']).toContain('TEST_FIXTURE_JSON');
  });
  it('redacts unrecognized path segments even when generation is called directly', () => {
    const p = generateProject({ ...base, path: '/api/users/SYNTHETIC_SECRET' });
    expect(JSON.stringify(p)).not.toContain('SYNTHETIC_SECRET');
    expect(p.code).toContain('process.env.TEST_PATH');
  });
  it('supports only approved, explicitly supplied query values', () => {
    const p = generateProject({
      ...base,
      query: { page: '2', sort: 'price', order: 'asc' },
    });
    expect(p.code).toContain('"page":"2"');
    expect(() =>
      generateProject({ ...base, query: { page: 'secret' } }),
    ).toThrow();
  });
  it('emits parseable TypeScript for each supported method', () => {
    for (const method of [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'HEAD',
      'OPTIONS',
    ] as const) {
      const p = generateProject({
        ...base,
        method,
        allowDelete: method === 'DELETE',
      });
      const result = ts.transpileModule(p.code, {
        reportDiagnostics: true,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      });
      expect(result.diagnostics).toEqual([]);
    }
  });
});
