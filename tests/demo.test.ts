import { it, expect } from 'vitest';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createDemoApp, demoPayload } from '../apps/demo-api/src/app';
it('same valid synthetic request is 422 before the fix, 201 after it; invalid payload remains rejected', async () => {
  for (const mode of ['buggy', 'fixed'] as const) {
    const server = createDemoApp(mode).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const request = (body: unknown) =>
        fetch(base + '/api/investments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      const response = await request(demoPayload);
      expect(response.status).toBe(mode === 'buggy' ? 422 : 201);
      await response.json();
      const invalid = await request({ ...demoPayload, amount: -1 });
      expect(invalid.status).toBe(422);
      await invalid.json();
      const page = await fetch(base);
      expect(await page.text()).toContain('Submit synthetic investment');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  }
});
