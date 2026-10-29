import { parseArgs } from 'node:util';
import { Workspace } from './workspace';
import { createCompanion } from './server';
const { values } = parseArgs({
  options: {
    workspace: { type: 'string' },
    port: { type: 'string', default: '4318' },
    verification: { type: 'string', default: 'disabled' },
  },
});
if (!values.workspace)
  throw new Error(
    'Choose an authorized Git root: npm run companion:start -- --workspace /absolute/repository --verification demo-investments',
  );
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Port must be 1024–65535.');
if (
  values.verification !== 'disabled' &&
  values.verification !== 'demo-investments'
)
  throw new Error('Unknown verification profile.');
const workspace = await Workspace.open(values.workspace);
const companion = createCompanion({
  workspace,
  port,
  key: process.env.GEMINI_API_KEY,
  model: process.env.GEMINI_MODEL,
  verificationProfile: values.verification,
});
const server = companion.app.listen(port, '127.0.0.1', () => {
  console.log(
    `ReproForge companion · http://127.0.0.1:${port}\nAuthorized workspace: ${workspace.root}\nPairing code (single use; expires in 5 minutes): ${companion.pairingCode}\nEnter this code in ReproForge Settings. No source is sent until approved.\nGemini: ${process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL ? 'configured (not yet verified)' : 'not configured'}; verification: ${values.verification}`,
  );
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    server.close();
    void companion.close().finally(() => process.exit(0));
  });
server.on('error', () => {
  console.error(
    'Could not bind the loopback port. Stop the previous companion or select another port.',
  );
  process.exitCode = 1;
});
