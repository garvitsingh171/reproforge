import { z } from 'zod';
import { mkdir, writeFile, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { generateProject } from '@reproforge/test-generator';
import type {
  ApprovedContext,
  Verification,
  CheckResult,
} from '@reproforge/shared/integrations';
import { PatchService } from './patches';
import { runCommand, type CommandRunner } from './process';
import { invariant } from './errors';
const dependencies = resolve('node_modules');
export function sandboxArgs(
  work: string,
  node: string,
  deps: string,
  command: string[],
) {
  return [
    '--unshare-all',
    '--die-with-parent',
    '--new-session',
    '--cap-drop',
    'ALL',
    '--ro-bind',
    '/usr',
    '/usr',
    '--ro-bind',
    '/lib',
    '/lib',
    '--ro-bind',
    '/lib64',
    '/lib64',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp',
    '--dir',
    '/home',
    '--ro-bind',
    work,
    '/work',
    '--ro-bind',
    deps,
    '/work/node_modules',
    '--ro-bind',
    node,
    '/reproforge-node',
    '--clearenv',
    '--setenv',
    'HOME',
    '/tmp',
    '--setenv',
    'PATH',
    '/usr/bin:/bin',
    '--setenv',
    'NODE_ENV',
    'test',
    '--setenv',
    'NO_COLOR',
    '1',
    '--setenv',
    'TEST_BASE_URL',
    'http://127.0.0.1:4319',
    '--chdir',
    '/work',
    ...command,
  ];
}
const supervisor = `import { spawn } from 'node:child_process';
const server=spawn('/reproforge-node',['--max-old-space-size=256','--import','tsx','/work/.reproforge/server.ts'],{stdio:['ignore','pipe','pipe']});
server.stderr.pipe(process.stderr); let ready=false;
const timeout=setTimeout(()=>{console.error('Demo server startup timed out');server.kill('SIGKILL');process.exitCode=1;},8000);
server.stdout.on('data',async chunk=>{if(ready||!String(chunk).includes('REPROFORGE_READY'))return;ready=true;clearTimeout(timeout);
const test=spawn('/reproforge-node',['--max-old-space-size=256','/work/node_modules/vitest/vitest.mjs','run','--config','/work/.reproforge/vitest.config.mjs','--configLoader','native'],{stdio:'inherit'});
test.on('close',code=>{server.kill('SIGKILL');process.exitCode=code??1;});});
server.on('close',()=>{if(!ready){clearTimeout(timeout);process.exitCode=1;}});
`;
async function prepare(work: string, context: ApprovedContext) {
  const dir = join(work, '.reproforge');
  await mkdir(dir, { recursive: true });
  const e = context.evidence;
  const generated = generateProject({
    method: e.method,
    path: e.path,
    observedStatus: e.observedStatus,
    expectedStatus: e.expectedStatus,
    title: 'Creates a valid monthly investment',
    body: e.body,
  });
  await writeFile(
    join(work, 'package.json'),
    '{"type":"module","private":true}',
  );
  for (const name of ['regression.test.ts', 'safety.ts'])
    await writeFile(join(dir, name), generated.files[name]!);
  await writeFile(
    join(dir, 'server.ts'),
    "import { createDemoApp } from '../apps/demo-api/src/app';\ncreateDemoApp('buggy').listen(4319,'127.0.0.1',()=>console.log('REPROFORGE_READY'));\n",
  );
  await writeFile(join(dir, 'supervisor.mjs'), supervisor);
  await writeFile(
    join(dir, 'additional.test.ts'),
    `import {test,expect} from 'vitest';
const fixture={symbol:'DEMO',amount:100,currency:'USD',type:'monthly'};
for(const [name,body,status] of [['rejects invalid amounts',{...fixture,amount:-1},422],['preserves one-time investments',{...fixture,type:'one-time'},201]] as const)test(name,async()=>{const r=await fetch('http://127.0.0.1:4319/api/investments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(3000)});await r.body?.cancel();expect(r.status).toBe(status);});`,
  );
  await writeFile(
    join(dir, 'vitest.config.mjs'),
    "export default {cacheDir:'/tmp/vite',test:{include:['.reproforge/*.test.ts'],maxWorkers:1,fileParallelism:false}};",
  );
  await writeFile(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ['node'],
        esModuleInterop: true,
      },
      include: ['../apps/demo-api/src/app.ts', './*.ts'],
    }),
  );
}
export class Verifier {
  readonly jobs = new Map<string, Verification>();
  private controllers = new Map<string, AbortController>();
  constructor(
    private patches: PatchService,
    private profile: 'demo-investments' | 'disabled',
    private runner: CommandRunner = runCommand,
  ) {}
  async start(id: string, context: ApprovedContext, approved: boolean) {
    invariant(
      approved,
      'APPROVAL_REQUIRED',
      'Approve the displayed verification plan before execution.',
      403,
    );
    const p = this.patches.get(id);
    invariant(
      p.state === 'staged' || p.state === 'verified',
      'NOT_STAGED',
      'Stage the proposal before verification.',
      409,
    );
    invariant(
      ![...this.jobs.values()].some((j) => j.status === 'running'),
      'VERIFICATION_BUSY',
      'A verification job is already running.',
      409,
    );
    invariant(
      this.jobs.size < 20,
      'JOB_LIMIT',
      'Clear session before running more checks.',
    );
    p.state = 'staged';
    this.patches.reports.delete(id);
    const job: Verification = {
      id: randomUUID(),
      proposalId: id,
      status: 'running',
      patchAppliedToSandbox: true,
      checks: [],
      readyForHumanReview: false,
      explanation:
        'Executing fixed, approved checks with no external network and no inherited credentials.',
    };
    this.jobs.set(job.id, job);
    const control = new AbortController();
    this.controllers.set(job.id, control);
    void this.execute(job, context, control.signal).finally(() =>
      this.controllers.delete(job.id),
    );
    return job;
  }
  plan() {
    return {
      profile: this.profile,
      commands: [
        ['node', '.reproforge/supervisor.mjs'],
        [
          'node',
          'node_modules/typescript/bin/tsc',
          '--noEmit',
          '--project',
          '.reproforge/tsconfig.json',
        ],
      ],
      scope:
        'The demo profile keeps DEMO_MODE=buggy in baseline and patched servers. It uses the same generated status assertion plus invalid-amount and one-time-investment checks. Only these fixed commands run; no package scripts or AI commands.',
      isolation:
        'Bubblewrap: read-only source and dependencies, private PID/network namespaces, empty environment, writable temporary directory, 30-second timeout, 64 KiB output cap.',
    };
  }
  private async execute(
    job: Verification,
    context: ApprovedContext,
    signal: AbortSignal,
  ) {
    try {
      invariant(
        this.profile === 'demo-investments',
        'PROFILE_UNAVAILABLE',
        'No approved execution profile. Review/export the patch and verify it manually.',
      );
      const e = context.evidence;
      invariant(
        e.method === 'POST' &&
          e.path === '/api/investments' &&
          e.observedStatus === 422 &&
          e.expectedStatus === 201 &&
          z
            .object({
              symbol: z.literal('DEMO'),
              amount: z.literal(100),
              currency: z.literal('USD'),
              type: z.literal('monthly'),
            })
            .strict()
            .safeParse(e.body).success,
        'PROFILE_MISMATCH',
        'Demo verification requires the documented synthetic monthly-investment fixture and expected status 201.',
      );
      const stage = await this.patches.assertStage(job.proposalId);
      const node = await realpath(process.execPath),
        deps = await realpath(dependencies);
      await mkdir(join(stage.baseline, 'node_modules'), { recursive: true });
      await mkdir(join(stage.patched, 'node_modules'), { recursive: true });
      const probe = await this.runner(
        'bwrap',
        sandboxArgs(stage.baseline, node, deps, ['/usr/bin/true']),
        { cwd: stage.baseline, timeoutMs: 5000, signal },
      );
      if (probe.code !== 0)
        job.checks.push({
          name: 'Sandbox preflight',
          status: 'blocked',
          exitCode: probe.code,
          output: probe.output,
          durationMs: probe.durationMs,
          command: ['bwrap', 'isolation preflight'],
        });
      invariant(
        probe.code === 0,
        'SANDBOX_UNAVAILABLE',
        'Bubblewrap isolation is unavailable. No application code was executed. Install/configure bubblewrap or verify manually.',
      );
      await prepare(stage.baseline, context);
      await prepare(stage.patched, context);
      for (const [name, work, command] of [
        [
          'Baseline regression',
          stage.baseline,
          ['/reproforge-node', '.reproforge/supervisor.mjs'],
        ],
        [
          'Patched regression',
          stage.patched,
          ['/reproforge-node', '.reproforge/supervisor.mjs'],
        ],
        [
          'TypeScript',
          stage.patched,
          [
            '/reproforge-node',
            'node_modules/typescript/bin/tsc',
            '--noEmit',
            '--project',
            '.reproforge/tsconfig.json',
          ],
        ],
      ] as const) {
        if (signal.aborted) {
          job.status = 'cancelled';
          job.explanation =
            'Verification cancelled. No correctness claim is made.';
          return;
        }
        const result = await this.runner(
          'bwrap',
          sandboxArgs(work, node, deps, [...command]),
          { cwd: work, timeoutMs: 30000, maxBytes: 65536, signal },
        );
        const check: CheckResult = {
          name,
          status: result.cancelled
            ? 'cancelled'
            : result.timedOut
              ? 'inconclusive'
              : result.truncated
                ? 'inconclusive'
                : result.code === 0
                  ? 'passed'
                  : 'failed',
          exitCode: result.code,
          output: result.output,
          durationMs: result.durationMs,
          command: [...command],
        };
        job.checks.push(check);
        if (result.cancelled) {
          job.status = 'cancelled';
          return;
        }
      }
      await this.patches.assertStage(job.proposalId);
      const [baseline, patched, types] = job.checks;
      const red =
        baseline?.exitCode === 1 &&
        baseline.output.includes('Expected HTTP 201; received HTTP 422');
      const green =
        patched?.status === 'passed' && /3 passed/.test(patched.output);
      job.readyForHumanReview = !!(red && green && types?.status === 'passed');
      job.status = job.readyForHumanReview
        ? 'passed'
        : job.checks.some((c) => c.status === 'inconclusive')
          ? 'inconclusive'
          : 'failed';
      job.explanation = job.readyForHumanReview
        ? 'Same regression failed on the buggy source and passed on the patched source; additional demo cases and TypeScript passed. This is limited evidence, not proof of complete application correctness.'
        : 'The required baseline failure, patched pass, or static checks did not establish red-to-green behavior. Inspect actual results.';
      if (job.readyForHumanReview)
        this.patches.get(job.proposalId).state = 'verified';
      this.patches.reports.set(job.proposalId, job);
    } catch (error) {
      job.status = signal.aborted ? 'cancelled' : 'blocked';
      job.explanation =
        error instanceof Error ? error.message : 'Verification blocked.';
    } finally {
      if (job.status === 'running') job.status = 'inconclusive';
    }
  }
  get(id: string) {
    const job = this.jobs.get(id);
    invariant(job, 'JOB_MISSING', 'Verification job not found.', 404);
    return job;
  }
  cancel(id: string) {
    this.get(id);
    this.controllers.get(id)?.abort();
  }
  async close() {
    for (const control of this.controllers.values()) control.abort();
    for (
      let i = 0;
      i < 100 && [...this.jobs.values()].some((j) => j.status === 'running');
      i++
    )
      await new Promise((r) => setTimeout(r, 20));
  }
}
