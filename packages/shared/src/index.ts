import { z } from 'zod';

export const MAX_BODY_BYTES = 16_384;
export const REDACTED = '[REDACTED]';
export const methodSchema = z.enum([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);
export type HttpMethod = z.infer<typeof methodSchema>;
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type BodyPreview = {
  state: 'available' | 'excluded' | 'missing' | 'not-loaded';
  data?: JsonValue;
  reason?: string;
  redacted?: boolean;
};
export interface DiagnosticRecord {
  id: string;
  method: string;
  url: string;
  path: string;
  status: number;
  timestamp: string;
  duration?: number;
  contentType: string;
  requestHeaders: Record<string, string>;
  requestBody: BodyPreview;
  responseBody: BodyPreview;
  warnings: string[];
  needsAuth: boolean;
}
const sensitiveKey =
  /authorization|cookie|password|passwd|secret|token|api.?key|session|csrf|xsrf|email|phone|mobile|address|name|credential|jwt|private|account|card|ssn/i;
const safeStringKeys = new Set([
  'currency',
  'symbol',
  'type',
  'category',
  'interval',
  'status',
  'plan',
  'product',
  'code',
  'method',
  'format',
  'sort',
  'order',
]);
const safeNumericKeys = new Set([
  'amount',
  'quantity',
  'count',
  'limit',
  'offset',
  'page',
  'price',
  'total',
  'duration',
  'retry',
  'enabled',
  'active',
  'success',
]);
const safeRoutes = new Set([
  'api',
  'v1',
  'v2',
  'v3',
  'investments',
  'investment',
  'users',
  'user',
  'products',
  'product',
  'orders',
  'order',
  'items',
  'item',
  'health',
  'login',
  'logout',
  'auth',
  'search',
  'projects',
  'project',
  'tasks',
  'task',
  'payments',
  'payment',
  'test',
  'demo',
  'data',
  'graphql',
]);
export function isJsonMime(value: string): boolean {
  return /^(application\/(?:[a-z0-9.-]+\+)?json)(?:\s*;|$)/i.test(value);
}
export function redactText(value: string): string {
  return value
    .slice(0, 500)
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, REDACTED)
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, REDACTED)
    .replace(/(?:\+?\d[\d ().-]{7,}\d)/g, REDACTED)
    .replace(/\b[A-Za-z0-9_-]{25,}\b/g, REDACTED);
}
export function sanitizeUrl(input: string): {
  url: string;
  path: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  try {
    if (input.length > 8192) throw new Error();
    const u = new URL(input);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
    if (u.search)
      warnings.push(
        'All captured query parameters were removed. Add approved test parameters in the builder.',
      );
    if (u.username || u.password)
      warnings.push('URL credentials were removed.');
    const path = u.pathname
      .split('/')
      .map((part) => {
        if (!part) return '';
        return safeRoutes.has(part.toLowerCase()) ? part : '__REDACTED__';
      })
      .join('/');
    if (path.includes('__REDACTED__'))
      warnings.push(
        'Unrecognized path segments were replaced. Configure TEST_PATH in the exported project.',
      );
    // Hostnames can themselves contain tenant IDs or secrets. They are unnecessary for test generation.
    return { url: `[captured origin]${path}`, path, warnings };
  } catch {
    return {
      url: '[excluded URL]',
      path: '/__REDACTED__',
      warnings: ['Malformed or unsupported URL excluded. Configure TEST_PATH.'],
    };
  }
}
export function sanitizeHeaders(input: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!Array.isArray(input)) return result;
  for (const item of input.slice(0, 100)) {
    const parsed = z
      .object({ name: z.string(), value: z.string() })
      .safeParse(item);
    if (!parsed.success) continue;
    const name = parsed.data.name.toLowerCase();
    // Only standardized MIME values; no parameters, boundaries or arbitrary values.
    if (['content-type', 'accept'].includes(name)) {
      const mime = parsed.data.value.split(';')[0]?.trim().toLowerCase() ?? '';
      if (
        [
          'application/json',
          'application/problem+json',
          'text/plain',
          '*/*',
        ].includes(mime)
      )
        result[name] = mime;
    }
  }
  return result;
}
export function sanitizeJson(input: unknown): {
  data: JsonValue;
  redacted: boolean;
} {
  let redacted = false,
    nodes = 0;
  const visit = (value: unknown, key: string, depth: number): JsonValue => {
    if (++nodes > 1000 || depth > 8) {
      redacted = true;
      return REDACTED;
    }
    if (
      sensitiveKey.test(key) ||
      ['__proto__', 'constructor', 'prototype'].includes(key)
    ) {
      redacted = true;
      return REDACTED;
    }
    if (value === null) return null;
    if (Array.isArray(value)) {
      if (value.length > 50) redacted = true;
      return value.slice(0, 50).map((v) => visit(v, key, depth + 1));
    }
    if (typeof value === 'object') {
      const out: { [key: string]: JsonValue } = Object.create(null);
      const entries = Object.entries(value).slice(0, 100);
      if (Object.keys(value).length > 100) redacted = true;
      for (const [k, v] of entries) {
        // Dynamic keys can contain PII or secrets too; unknown keys never survive.
        const normalized = k.toLowerCase();
        const safeKey =
          safeStringKeys.has(normalized) ||
          safeNumericKeys.has(normalized) ||
          [
            'items',
            'data',
            'errors',
            'details',
            'metadata',
            'payload',
          ].includes(normalized);
        if (!safeKey) {
          redacted = true;
          out[`excluded_field_${Object.keys(out).length + 1}`] = REDACTED;
        } else out[k] = visit(v, normalized, depth + 1);
      }
      return out;
    }
    if (
      ((typeof value === 'number' &&
        Number.isFinite(value) &&
        Math.abs(value) < 1e9) ||
        typeof value === 'boolean') &&
      safeNumericKeys.has(key)
    )
      return value as number | boolean;
    if (
      typeof value === 'string' &&
      safeStringKeys.has(key) &&
      /^[A-Za-z][A-Za-z0-9 _.-]{0,23}$/.test(value) &&
      redactText(value) === value
    )
      return value;
    redacted = true;
    return REDACTED;
  };
  return {
    data: visit(input, '', 0),
    get redacted() {
      return redacted;
    },
  };
}
export function sanitizeBody(text: unknown, mime: string): BodyPreview {
  if (typeof text !== 'string' || !text.length)
    return { state: 'missing', reason: 'Body data is unavailable.' };
  if (
    text.length > MAX_BODY_BYTES ||
    new TextEncoder().encode(text).length > MAX_BODY_BYTES
  )
    return {
      state: 'excluded',
      reason: 'Body exceeds the 16 KiB preview limit.',
    };
  if (!isJsonMime(mime))
    return {
      state: 'excluded',
      reason:
        'Only JSON previews are supported. Text, forms and binary data are excluded.',
    };
  try {
    const safe = sanitizeJson(JSON.parse(text));
    return { state: 'available', ...safe };
  } catch {
    return { state: 'excluded', reason: 'Invalid JSON excluded.' };
  }
}
