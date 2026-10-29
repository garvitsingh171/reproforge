import express from 'express';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
export type DemoMode = 'buggy' | 'fixed';
export const demoPayload = {
  symbol: 'DEMO',
  amount: 100,
  currency: 'USD',
  type: 'monthly',
};
const investment = z
  .object({
    symbol: z.literal('DEMO'),
    amount: z.number().positive().max(10000),
    currency: z.literal('USD'),
    type: z.enum(['monthly', 'one-time']),
  })
  .strict();
export function createDemoApp(mode: DemoMode) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'",
    );
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/health', (_req, res) => res.json({ mode, synthetic: true }));
  app.post('/api/investments', (req, res) => {
    const data = investment.safeParse(req.body);
    if (!data.success) {
      res.status(422).json({
        code: 'INVALID_FIXTURE',
        errors: ['Use the supplied synthetic DEMO fixture.'],
      });
      return;
    }
    // Deliberate defect: the buggy validator rejects a valid monthly investment.
    if (mode === 'buggy' && data.data.type === 'monthly') {
      res.status(422).json({
        code: 'INVALID_INTERVAL',
        errors: ['Monthly investments were incorrectly rejected.'],
      });
      return;
    }
    res.status(201).json({ code: 'CREATED', data: data.data });
  });
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
  app.use((_req, res) => res.status(404).json({ code: 'NOT_FOUND' }));
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res
        .status(err instanceof SyntaxError ? 400 : 413)
        .json({ code: 'INVALID_BODY' });
    },
  );
  return app;
}
