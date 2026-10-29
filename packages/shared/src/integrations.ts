import { z } from 'zod';
import {
  methodSchema,
  sanitizeJson,
  sanitizeUrl,
  sanitizeHeaders,
} from './index';
export const approvalSchema = z.literal(true);
export const repoSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/)
  .refine(
    (s) => !s.endsWith('.git') && !s.includes('..'),
    'Use owner/repository, without .git.',
  );
export const branchSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/)
  .refine(
    (s) =>
      !s.includes('..') &&
      !s.includes('//') &&
      !s.endsWith('/') &&
      !s.endsWith('.') &&
      !s.endsWith('.lock'),
  );
export const sourcePathSchema = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9_./-]+$/)
  .refine(
    (p) =>
      !p.startsWith('/') &&
      !p.split('/').some((s) => !s || s === '.' || s === '..'),
  );
export function scrubText(text: string): string {
  return text
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      '[REDACTED PRIVATE KEY]',
    )
    .replace(
      /\b(?:AIza[\w-]{20,}|gh[pousr]_[\w]{15,}|github_pat_[\w_]{15,}|AKIA[A-Z0-9]{16}|sk-[\w-]{16,})\b/g,
      '[REDACTED]',
    )
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(
      /((?:password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|session[_-]?id|cookie|authorization)\s*["']?\s*[:=]\s*)(["'`])[^\r\n]*?\2/gi,
      '$1"[REDACTED]"',
    )
    .replace(
      /((?:token|password|secret|api[_-]?key)=)[^\s&#]+/gi,
      '$1[REDACTED]',
    )
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[REDACTED EMAIL]')
    .replace(/(?<![\w.])\+?\d[\d ()-]{8,}\d(?![\w.])/g, '[REDACTED PHONE]');
}
export const evidenceSchema = z
  .object({
    method: methodSchema,
    path: z.string().max(2048),
    observedStatus: z.number().int().min(400).max(599),
    expectedStatus: z.number().int().min(100).max(599),
    body: z.unknown().optional(),
    response: z.unknown().optional(),
    headers: z.record(z.string(), z.string()).default({}),
    expectation: z.string().trim().min(3).max(2000),
    steps: z.string().max(3000).default(''),
    environment: z.string().max(1000).default(''),
    regressionReference: z.string().max(500).default(''),
  })
  .strict();
export type FailureEvidence = z.infer<typeof evidenceSchema>;
export function safeEvidence(input: unknown): FailureEvidence {
  const v = evidenceSchema.parse(input);
  return {
    ...v,
    path: sanitizeUrl(`https://local.invalid${v.path}`).path,
    body: v.body === undefined ? undefined : sanitizeJson(v.body).data,
    response:
      v.response === undefined ? undefined : sanitizeJson(v.response).data,
    headers: sanitizeHeaders(
      Object.entries(v.headers).map(([name, value]) => ({ name, value })),
    ),
    expectation: scrubText(v.expectation),
    steps: scrubText(v.steps),
    environment: scrubText(v.environment),
    regressionReference: scrubText(v.regressionReference),
  };
}
export const sourceSchema = z.object({
  path: sourcePathSchema,
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  content: z.string().max(65536),
  patchable: z.boolean(),
  reason: z.string(),
  score: z.number(),
});
export const contextSchema = z.object({
  id: z.string().uuid(),
  workspace: z.string(),
  baseCommit: z.string(),
  evidence: evidenceSchema,
  files: z.array(sourceSchema).max(6),
  warnings: z.array(z.string()),
  expiresAt: z.string(),
});
export type ApprovedContext = z.infer<typeof contextSchema>;
export const investigationSchema = z
  .object({
    summary: z.string().max(3000),
    observedFailure: z.object({
      method: methodSchema,
      endpoint: z.string(),
      status: z.number().int(),
    }),
    possibleRootCauses: z
      .array(
        z.object({
          description: z.string().max(2000),
          confidence: z.enum(['low', 'medium', 'high']),
          evidence: z
            .array(
              z.object({
                file: sourcePathSchema,
                line: z.number().int().positive(),
                quote: z.string().min(1).max(1000),
                detail: z.string().max(1000),
              }),
            )
            .min(1)
            .max(8),
        }),
      )
      .max(5),
    recommendedActions: z.array(z.string().max(1000)).max(8),
    requiresMoreInformation: z.boolean(),
  })
  .strict();
export type Investigation = z.infer<typeof investigationSchema>;
export const modelPatchSchema = z
  .object({
    summary: z.string().max(3000),
    edits: z
      .array(
        z
          .object({
            path: sourcePathSchema,
            before: z.string().min(1).max(8000),
            after: z.string().max(8000),
            explanation: z.string().max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    tests: z.array(z.string().max(500)).max(10),
    risks: z.array(z.string().max(1000)).max(10),
    assumptions: z.array(z.string().max(1000)).max(10),
  })
  .strict();
export type ModelPatch = z.infer<typeof modelPatchSchema>;
export const proposalSchema = z.object({
  id: z.string().uuid(),
  contextId: z.string().uuid(),
  workspace: z.string(),
  baseCommit: z.string(),
  summary: z.string(),
  files: z
    .array(
      z.object({
        path: sourcePathSchema,
        originalHash: z.string(),
        afterHash: z.string(),
        before: z.string(),
        after: z.string(),
        diff: z.string(),
        added: z.number(),
        removed: z.number(),
        explanation: z.string(),
      }),
    )
    .min(1)
    .max(5),
  tests: z.array(z.string()),
  risks: z.array(z.string()),
  assumptions: z.array(z.string()),
  state: z.enum([
    'proposed',
    'staged',
    'verified',
    'rejected',
    'branched',
    'pushed',
    'pr-created',
  ]),
  branch: z.string().optional(),
  commit: z.string().optional(),
  stageLocation: z.string().optional(),
});
export type FixProposal = z.infer<typeof proposalSchema>;
export const checkSchema = z.object({
  name: z.string(),
  status: z.enum([
    'not-run',
    'running',
    'passed',
    'failed',
    'skipped',
    'blocked',
    'inconclusive',
    'cancelled',
  ]),
  exitCode: z.number().nullable(),
  durationMs: z.number(),
  output: z.string(),
  command: z.array(z.string()),
});
export const verificationSchema = z.object({
  id: z.string().uuid(),
  proposalId: z.string().uuid(),
  status: checkSchema.shape.status,
  patchAppliedToSandbox: z.boolean(),
  checks: z.array(checkSchema),
  readyForHumanReview: z.boolean(),
  explanation: z.string(),
});
export type Verification = z.infer<typeof verificationSchema>;
export type CheckResult = z.infer<typeof checkSchema>;
export const resourceSchema = z.object({
  number: z.number().int().positive(),
  url: z
    .string()
    .url()
    .regex(
      /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:issues|pull)\/\d+$/,
    ),
});
export type GitHubResource = z.infer<typeof resourceSchema>;
export const draftSchema = z.object({
  id: z.string().uuid(),
  repo: repoSchema,
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()),
  matches: z.array(resourceSchema.extend({ title: z.string() })),
  expiresAt: z.string(),
  state: z.enum(['prepared', 'publishing', 'created', 'uncertain']),
  result: resourceSchema.optional(),
});
export type IssueDraft = z.infer<typeof draftSchema>;
export const repositorySchema = z.object({
  fullName: repoSchema,
  issuesEnabled: z.boolean(),
  canPush: z.boolean(),
  defaultBranch: branchSchema,
  labels: z.array(z.string()),
});
export type RepositoryInfo = z.infer<typeof repositorySchema>;
export const companionStatusSchema = z.object({
  workspace: z.object({
    name: z.string(),
    id: z.string(),
    baseCommit: z.string(),
  }),
  gemini: z.object({ configured: z.boolean(), model: z.string().nullable() }),
  verificationProfile: z.enum(['demo-investments', 'disabled']),
  remote: repoSchema.nullable(),
  expiresAt: z.string(),
});
export type CompanionStatus = z.infer<typeof companionStatusSchema>;
export const auditSchema = z.object({
  id: z.string().uuid(),
  at: z.string(),
  operation: z.string(),
  resourceId: z.string().optional(),
  status: z.enum(['approved', 'completed', 'failed', 'blocked']),
});
export type AuditEvent = z.infer<typeof auditSchema>;
