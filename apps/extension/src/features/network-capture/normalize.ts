import { z } from 'zod';
import {
  isJsonMime,
  methodSchema,
  MAX_BODY_BYTES,
  sanitizeBody,
  sanitizeHeaders,
  sanitizeUrl,
  type DiagnosticRecord,
} from '@reproforge/shared';
const harSchema = z.object({
  startedDateTime: z.string(),
  time: z.number().optional(),
  _resourceType: z.string().optional(),
  request: z.object({
    method: z.string().max(16),
    url: z.string(),
    headers: z
      .array(z.object({ name: z.string(), value: z.string() }))
      .default([]),
    postData: z
      .object({ mimeType: z.string(), text: z.string().optional() })
      .optional(),
  }),
  response: z.object({
    status: z.number().int(),
    content: z
      .object({ mimeType: z.string().default(''), size: z.number().optional() })
      .default({ mimeType: '' }),
  }),
});
export function normalizeRequest(
  raw: unknown,
  id = crypto.randomUUID(),
): DiagnosticRecord | null {
  const parsed = harSchema.safeParse(raw);
  if (!parsed.success) return null;
  const h = parsed.data;
  if (h.response.status < 400 || h.response.status > 599) return null;
  if (h._resourceType && !['xhr', 'fetch'].includes(h._resourceType))
    return null;
  if (!h._resourceType && !isJsonMime(h.response.content.mimeType)) return null;
  const url = sanitizeUrl(h.request.url);
  const post = h.request.postData;
  const body = post
    ? sanitizeBody(post.text, post.mimeType)
    : {
        state: 'missing' as const,
        reason: 'No request body supplied by Chrome.',
      };
  const mime = isJsonMime(h.response.content.mimeType)
    ? 'application/json'
    : 'unsupported';
  const size = h.response.content.size;
  const responseBody =
    mime === 'application/json' &&
    size !== undefined &&
    size >= 0 &&
    size <= MAX_BODY_BYTES
      ? {
          state: 'not-loaded' as const,
          reason: 'Load a sanitized preview on demand.',
        }
      : {
          state: 'excluded' as const,
          reason:
            'Preview excluded: unsupported type, unknown size, or larger than 16 KiB.',
        };
  return {
    id,
    method: methodSchema.safeParse(h.request.method).success
      ? h.request.method
      : 'UNSUPPORTED',
    url: url.url,
    path: url.path,
    status: h.response.status,
    timestamp: Number.isFinite(Date.parse(h.startedDateTime))
      ? new Date(h.startedDateTime).toISOString()
      : new Date().toISOString(),
    duration:
      h.time !== undefined && h.time >= 0 ? Math.round(h.time) : undefined,
    contentType: mime,
    requestHeaders: sanitizeHeaders(h.request.headers),
    requestBody: body,
    responseBody,
    needsAuth: h.request.headers.some((x) =>
      /authorization|cookie|api.?key/i.test(x.name),
    ),
    warnings: [
      ...url.warnings,
      'Only approved metadata is retained. Credentials and unrecognized fields are excluded.',
      ...(body.redacted
        ? [
            'Request fields were redacted. A synthetic test fixture will be required.',
          ]
        : []),
    ],
  };
}
