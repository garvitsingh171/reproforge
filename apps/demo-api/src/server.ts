import { createDemoApp } from './app';
const mode = process.env.DEMO_MODE ?? 'buggy';
if (mode !== 'buggy' && mode !== 'fixed')
  throw new Error('DEMO_MODE must be buggy or fixed.');
const port = Number(process.env.PORT ?? 4317);
const server = createDemoApp(mode).listen(port, '127.0.0.1', () =>
  console.log(
    `ReproForge synthetic demo · ${mode} mode · http://127.0.0.1:${port}`,
  ),
);
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
