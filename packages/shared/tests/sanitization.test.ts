import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_BYTES,
  sanitizeBody,
  sanitizeHeaders,
  sanitizeJson,
  sanitizeUrl,
} from '../src';
describe('privacy boundary', () => {
  it('removes authorization, cookies, API keys and arbitrary headers', () => {
    expect(
      sanitizeHeaders([
        { name: 'Authorization', value: 'Bearer TOPSECRET' },
        { name: 'Cookie', value: 'session=S' },
        { name: 'Set-Cookie', value: 'session=S' },
        { name: 'x-api-key', value: 'APISECRET' },
        { name: 'content-type', value: 'application/json; token=oops' },
        { name: 'accept', value: 'application/json' },
        { name: 'x-debug', value: 'secret' },
      ]),
    ).toEqual({
      'content-type': 'application/json',
      accept: 'application/json',
    });
  });
  it('removes query, fragment, host, credentials and unknown path identifiers', () => {
    const safe = sanitizeUrl(
      'https://user:password@tenant.example/api/users/person@example.com?token=secret#private',
    );
    expect(safe.path).toBe('/api/users/__REDACTED__');
    for (const secret of [
      'password',
      'person@',
      'tenant.example',
      'token=secret',
      'private',
    ])
      expect(JSON.stringify(safe)).not.toContain(secret);
  });
  it('sanitizes nested arrays, values and dynamic property names', () => {
    const safe = sanitizeJson({
      password: 'p@ss',
      items: [
        {
          amount: 100,
          token: 'abc',
          email: 'a@b.com',
          metadata: {
            'private@example.com': 'secret',
            refresh_token: 'R',
            csrf: 'C',
          },
          phone: '+1 212 555 1234',
        },
      ],
      apiKey: 'K',
      sessionId: 'S',
      symbol: 'test@example.com',
    });
    expect(safe.redacted).toBe(true);
    const output = JSON.stringify(safe);
    for (const secret of [
      'p@ss',
      'abc',
      'a@b.com',
      'private@example.com',
      'refresh_token',
      'apiKey',
      'sessionId',
      '212 555',
      'test@example.com',
    ])
      expect(output).not.toContain(secret);
  });
  it('preserves supported synthetic fixture and sanitizes null/unexpected input', () => {
    expect(
      sanitizeJson({
        amount: 100,
        currency: 'USD',
        type: 'monthly',
        symbol: 'DEMO',
      }),
    ).toEqual({
      data: { amount: 100, currency: 'USD', type: 'monthly', symbol: 'DEMO' },
      redacted: false,
    });
    expect(sanitizeJson(null).data).toBe(null);
    expect(sanitizeHeaders(null)).toEqual({});
    expect(sanitizeBody(null, 'application/json').state).toBe('missing');
    expect(sanitizeUrl('javascript:alert(1)').path).toBe('/__REDACTED__');
  });
  it('excludes huge, binary, text and malformed content', () => {
    expect(
      sanitizeBody('x'.repeat(MAX_BODY_BYTES + 1), 'application/json').state,
    ).toBe('excluded');
    expect(
      sanitizeBody('"' + 'é'.repeat(9000) + '"', 'application/json').state,
    ).toBe('excluded');
    for (const mime of [
      'text/plain',
      'multipart/form-data',
      'application/octet-stream',
    ])
      expect(sanitizeBody('password=secret', mime).state).toBe('excluded');
    expect(sanitizeBody('{broken', 'application/json').state).toBe('excluded');
  });
  it('bounds depth, arrays, and cycles', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.data = cyclic;
    expect(sanitizeJson(cyclic).redacted).toBe(true);
    expect(
      (
        sanitizeJson({
          items: Array.from({ length: 100 }, () => ({ amount: 1 })),
        }).data as { items: unknown[] }
      ).items,
    ).toHaveLength(50);
  });
});
