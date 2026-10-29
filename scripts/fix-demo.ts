/** Offline validation of patch mechanics. The proposed edit is an explicit TEST FIXTURE, not Gemini output. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixture, evidence, correction } from '../apps/companion/tests/helpers';
import { safeEvidence } from '@reproforge/shared/integrations';
import { PatchService } from '../apps/companion/src/patches';
import { Verifier } from '../apps/companion/src/verification';
const f = await fixture();
const patches = new PatchService(f.workspace),
  verifier = new Verifier(patches, 'demo-investments');
try {
  const context = await f.workspace.discover(safeEvidence(evidence));
  const proposal = patches.propose(context, correction(context));
  await patches.stage(proposal.id, true);
  console.log(
    'TEST FIXTURE patch staged in an isolated copy; original source remains unchanged. No Gemini request occurred.',
  );
  const report = await verifier.start(proposal.id, context, true);
  while (report.status === 'running')
    await new Promise((r) => setTimeout(r, 100));
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    resolve('artifacts/fix-verification.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(report.status, report.explanation);
  for (const c of report.checks)
    console.log(`${c.name}: ${c.status}, exit=${c.exitCode}\n${c.output}`);
  if (report.status !== 'passed') process.exitCode = 1;
} finally {
  await verifier.close();
  await patches.close();
  await f.close();
}
