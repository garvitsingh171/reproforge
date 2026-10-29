import express from 'express';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { basename } from 'node:path';
import {
  approvalSchema,
  repoSchema,
  branchSchema,
  sourcePathSchema,
  safeEvidence,
  type ApprovedContext,
  type Investigation,
  type AuditEvent,
} from '@reproforge/shared/integrations';
import { Workspace } from './workspace';
import {
  GitHubCLI,
  IssueService,
  issueText,
  type GitHubAdapter,
} from './github';
import {
  GeminiProvider,
  validateInvestigation,
  validateModelPatch,
  type AIProvider,
} from './ai';
import { PatchService } from './patches';
import { Verifier } from './verification';
import { BranchService } from './branches';
import { invariant, CompanionError } from './errors';
import type { CommandRunner } from './process';
export interface CompanionOptions {
  workspace: Workspace;
  port: number;
  pairingCode?: string;
  github?: GitHubAdapter;
  ai?: AIProvider;
  model?: string;
  key?: string;
  verificationProfile?: 'demo-investments' | 'disabled';
  runner?: CommandRunner;
  sessionMs?: number;
}
export function createCompanion(options: CompanionOptions) {
  const app = express();
  app.disable('x-powered-by');
  const pairingCode =
    options.pairingCode ?? randomBytes(24).toString('base64url');
  const pairingExpires = Date.now() + 5 * 60_000;
  let paired = false,
    attempts = 0;
  let session: { token: string; origin: string; expires: number } | undefined;
  const nonces = new Set<string>();
  const github = options.github ?? new GitHubCLI(options.workspace.root);
  const ai = options.ai ?? new GeminiProvider(options.key, options.model);
  const issues = new IssueService(github),
    patches = new PatchService(options.workspace),
    verifier = new Verifier(
      patches,
      options.verificationProfile ?? 'disabled',
      options.runner,
    ),
    branches = new BranchService(
      options.workspace,
      patches,
      github,
      options.runner,
    );
  const contexts = new Map<string, ApprovedContext>(),
    investigations = new Map<string, Investigation>();
  const audit: AuditEvent[] = [];
  let mutationBusy = false,
    closing = false;
  const record = (
    operation: string,
    status: AuditEvent['status'],
    resourceId?: string,
  ) => {
    audit.push({
      id: randomUUID(),
      at: new Date().toISOString(),
      operation,
      status,
      resourceId,
    });
    if (audit.length > 200) audit.shift();
  };
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (closing) {
      res.status(503).json({
        error: { code: 'CLOSING', message: 'Companion is shutting down.' },
      });
      return;
    }
    const host = req.headers.host;
    const browserOrigin = req.headers.origin;
    const declaredOrigin = req.headers['x-reproforge-origin'];
    const origin =
      browserOrigin ??
      (req.method === 'GET' &&
      session &&
      req.headers['sec-fetch-site'] === 'none' &&
      typeof declaredOrigin === 'string'
        ? declaredOrigin
        : undefined);
    const address = req.socket.remoteAddress;
    if (
      host !== `127.0.0.1:${options.port}` ||
      !['127.0.0.1', '::ffff:127.0.0.1'].includes(address ?? '')
    ) {
      res.status(403).json({
        error: {
          code: 'HOST_REJECTED',
          message: 'Only the configured loopback Host is accepted.',
        },
      });
      return;
    }
    if (
      (browserOrigin && declaredOrigin && browserOrigin !== declaredOrigin) ||
      !origin ||
      !/^chrome-extension:\/\/[a-p]{32}$/.test(origin) ||
      (session && origin !== session.origin)
    ) {
      res.status(403).json({
        error: {
          code: 'ORIGIN_REJECTED',
          message: 'Only the deliberately paired extension origin is accepted.',
        },
      });
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-ReproForge-Request, X-ReproForge-Origin',
    );
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json({ limit: '160kb', strict: true }));
  app.post('/pair', (req, res) => {
    const body = z
      .object({ code: z.string().min(16).max(128) })
      .strict()
      .parse(req.body);
    invariant(
      !paired && Date.now() < pairingExpires && ++attempts <= 5,
      'PAIR_EXPIRED',
      'Pairing expired or unavailable. Restart the companion for a new code.',
      403,
    );
    const supplied = Buffer.from(body.code),
      actual = Buffer.from(pairingCode);
    invariant(
      supplied.length === actual.length && timingSafeEqual(supplied, actual),
      'PAIR_INVALID',
      'Invalid pairing code.',
      403,
    );
    paired = true;
    session = {
      token: randomBytes(32).toString('base64url'),
      origin: req.headers.origin!,
      expires: Date.now() + (options.sessionMs ?? 4 * 60 * 60_000),
    };
    record('pair', 'completed');
    res.json({
      token: session.token,
      expiresAt: new Date(session.expires).toISOString(),
    });
  });
  app.use((req, _res, next) => {
    const value = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    invariant(
      session &&
        Date.now() < session.expires &&
        value.length === session.token.length &&
        timingSafeEqual(Buffer.from(value), Buffer.from(session.token)),
      'UNAUTHORIZED',
      'Pair with the companion; this session is missing or expired.',
      401,
    );
    if (req.method === 'POST') {
      const nonce = z
        .string()
        .uuid()
        .safeParse(req.headers['x-reproforge-request']);
      invariant(
        nonce.success && !nonces.has(nonce.data),
        'REPLAY_REJECTED',
        'Missing or reused request ID.',
        409,
      );
      invariant(
        nonces.size < 10000,
        'SESSION_LIMIT',
        'Restart the companion to renew this session.',
        403,
      );
      nonces.add(nonce.data);
    }
    next();
  });
  app.get('/status', async (_req, res) =>
    res.json({
      workspace: {
        name: basename(options.workspace.root),
        id: options.workspace.id,
        baseCommit: await options.workspace.head(),
      },
      gemini: {
        configured: !!(options.key && options.model),
        model: options.model ?? null,
      },
      verificationProfile: options.verificationProfile ?? 'disabled',
      remote: await options.workspace.remote(),
      expiresAt: new Date(session!.expires).toISOString(),
    }),
  );
  app.get('/audit', (_req, res) => res.json(audit));
  app.get('/github/status', async (_req, res) =>
    res.json({ account: await github.account() }),
  );
  app.get('/github/repository', async (req, res) =>
    res.json(await github.repository(repoSchema.parse(req.query.repo))),
  );
  app.get('/verification/plan', (_req, res) => res.json(verifier.plan()));
  app.get('/verification/:id', (req, res) =>
    res.json(verifier.get(req.params.id)),
  );
  // Serialize privileged operations; cancel remains independent of a running job.
  app.post('/verification/:id/cancel', (req, res) => {
    verifier.cancel(req.params.id);
    record('cancel', 'completed', req.params.id);
    res.json(verifier.get(req.params.id));
  });
  app.use((req, res, next) => {
    if (req.method !== 'POST') {
      next();
      return;
    }
    invariant(
      !mutationBusy,
      'OPERATION_BUSY',
      'Another approved operation is in progress.',
      409,
    );
    mutationBusy = true;
    res.once('finish', () => {
      mutationBusy = false;
    });
    next();
  });
  app.post('/issues/template', (req, res) =>
    res.json(issueText(safeEvidence(req.body))),
  );
  app.post('/issues/prepare', async (req, res) => {
    const b = z
      .object({
        repo: repoSchema,
        title: z.string().max(240),
        body: z.string().max(20000),
        labels: z.array(z.string().max(100)).max(10).default([]),
      })
      .strict()
      .parse(req.body);
    res.json(await issues.prepare(b.repo, b.title, b.body, b.labels));
  });
  app.post('/issues/:id/publish', async (req, res) => {
    const b = z.object({ approval: approvalSchema }).strict().parse(req.body);
    record('issue-publish', 'approved', req.params.id);
    res.json(await issues.publish(req.params.id, b.approval));
    record('issue-publish', 'completed', req.params.id);
  });
  app.get('/workspace/files', async (_req, res) =>
    res.json({ files: await options.workspace.files() }),
  );
  app.post('/contexts', async (req, res) => {
    const b = z
      .object({
        evidence: z.unknown(),
        paths: z.array(sourcePathSchema).max(6).optional(),
      })
      .strict()
      .parse(req.body);
    invariant(
      contexts.size < 20,
      'CONTEXT_LIMIT',
      'Clear this session before preparing more context.',
    );
    const context = await options.workspace.discover(
      safeEvidence(b.evidence),
      b.paths,
    );
    contexts.set(context.id, context);
    res.json(context);
  });
  const getContext = (id: string) => {
    const c = contexts.get(id);
    invariant(
      c,
      'CONTEXT_MISSING',
      'Prepare and review repository context first.',
      404,
    );
    return c;
  };
  app.post('/contexts/:id/investigate', async (req, res) => {
    z.object({ approval: approvalSchema }).strict().parse(req.body);
    const c = getContext(req.params.id);
    invariant(
      c.files.length,
      'NO_SOURCE',
      'No relevant source found. Select real source files first.',
    );
    await options.workspace.assertCurrent(c);
    record('gemini-investigate', 'approved', c.id);
    const result = validateInvestigation(await ai.investigate(c), c);
    investigations.set(c.id, result);
    record('gemini-investigate', 'completed', c.id);
    res.json(result);
  });
  app.post('/contexts/:id/fix', async (req, res) => {
    z.object({ approval: approvalSchema }).strict().parse(req.body);
    const c = getContext(req.params.id),
      finding = investigations.get(c.id);
    invariant(
      finding,
      'INVESTIGATION_REQUIRED',
      'Complete an approved investigation first.',
    );
    await options.workspace.assertCurrent(c);
    record('gemini-fix', 'approved', c.id);
    const proposal = patches.propose(
      c,
      validateModelPatch(await ai.fix(c, finding)),
    );
    record('gemini-fix', 'completed', proposal.id);
    res.json(proposal);
  });
  app.get('/proposals/:id', (req, res) => res.json(patches.get(req.params.id)));
  app.post('/proposals/:id/stage', async (req, res) => {
    const b = z.object({ approval: approvalSchema }).strict().parse(req.body);
    record('stage', 'approved', req.params.id);
    res.json(await patches.stage(req.params.id, b.approval));
    record('stage', 'completed', req.params.id);
  });
  app.post('/proposals/:id/reject', async (req, res) => {
    invariant(
      ![...verifier.jobs.values()].some(
        (j) => j.proposalId === req.params.id && j.status === 'running',
      ),
      'VERIFICATION_BUSY',
      'Cancel verification before discarding a proposal.',
      409,
    );
    res.json(await patches.reject(req.params.id));
  });
  app.post('/proposals/:id/verify', async (req, res) => {
    const b = z.object({ approval: approvalSchema }).strict().parse(req.body);
    const p = patches.get(req.params.id);
    record('verify', 'approved', p.id);
    res.json(await verifier.start(p.id, getContext(p.contextId), b.approval));
  });
  app.post('/proposals/:id/branch', async (req, res) => {
    const b = z.object({ approval: approvalSchema }).strict().parse(req.body);
    record('local-branch', 'approved', req.params.id);
    res.json(await branches.local(req.params.id, b.approval));
    record('local-branch', 'completed', req.params.id);
  });
  app.post('/proposals/:id/push', async (req, res) => {
    const b = z
      .object({
        repo: repoSchema,
        base: branchSchema,
        approval: approvalSchema,
      })
      .strict()
      .parse(req.body);
    record('push', 'approved', req.params.id);
    res.json(await branches.push(req.params.id, b.repo, b.base, b.approval));
    record('push', 'completed', req.params.id);
  });
  app.post('/proposals/:id/pr', async (req, res) => {
    const b = z
      .object({
        repo: repoSchema,
        base: branchSchema,
        title: z.string(),
        body: z.string(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await branches.preparePR(req.params.id, b.repo, b.base, b.title, b.body),
    );
  });
  app.post('/pulls/:id/publish', async (req, res) => {
    const b = z.object({ approval: approvalSchema }).strict().parse(req.body);
    record('pr-publish', 'approved', req.params.id);
    res.json(await branches.publishPR(req.params.id, b.approval));
    record('pr-publish', 'completed', req.params.id);
  });
  const clear = async () => {
    await verifier.close();
    await patches.close();
    contexts.clear();
    investigations.clear();
    issues.clear();
    branches.clear();
    patches.proposals.clear();
    patches.reports.clear();
    verifier.jobs.clear();
  };
  app.post('/disconnect', async (_req, res) => {
    session = undefined;
    await clear();
    record('disconnect', 'completed');
    res.json({
      disconnected: true,
      message: 'Restart companion to obtain a new pairing code.',
    });
  });
  app.use((_req, res) =>
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Unknown companion operation.' },
    }),
  );
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const validation = error instanceof z.ZodError;
      const oversized =
        typeof error === 'object' &&
        error !== null &&
        'type' in error &&
        error.type === 'entity.too.large';
      const safe =
        error instanceof CompanionError
          ? error
          : new CompanionError(
              oversized
                ? 'BODY_TOO_LARGE'
                : validation
                  ? 'INVALID_INPUT'
                  : 'OPERATION_FAILED',
              oversized
                ? 'Request exceeds 160 KiB.'
                : validation
                  ? 'Request fields are invalid. Review required values and approval.'
                  : 'Operation failed. No success is assumed; inspect companion configuration.',
              oversized ? 413 : validation ? 400 : 500,
            );
      record(safe.code, 'failed');
      if (!res.headersSent)
        res
          .status(safe.status)
          .json({ error: { code: safe.code, message: safe.message } });
    },
  );
  return {
    app,
    pairingCode,
    close: async () => {
      closing = true;
      session = undefined;
      await clear();
    },
    services: { patches, verifier },
  };
}
