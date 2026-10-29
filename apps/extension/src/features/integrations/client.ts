import { z } from 'zod';
import {
  companionStatusSchema,
  type CompanionStatus,
} from '@reproforge/shared/integrations';
export class CompanionClient {
  private token = '';
  private base = '';
  private statusValue: CompanionStatus | null = null;
  private listeners = new Set<() => void>();
  getSnapshot = () => this.statusValue;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit(status: CompanionStatus | null) {
    this.statusValue = status;
    this.listeners.forEach((fn) => fn());
  }
  async pair(port: number, code: string) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error('Choose a companion port from 1024–65535.');
    this.base = `http://127.0.0.1:${port}`;
    const result = z
      .object({ token: z.string(), expiresAt: z.string() })
      .parse(await this.request('/pair', { code }, false));
    this.token = result.token;
    try {
      this.emit(companionStatusSchema.parse(await this.request('/status')));
    } catch (error) {
      this.token = '';
      throw error;
    }
  }
  async request(
    path: string,
    body?: unknown,
    authenticated = true,
  ): Promise<unknown> {
    if (authenticated && !this.token)
      throw new Error('Pair with the local companion in Settings first.');
    const response = await fetch(this.base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ReproForge-Origin': `chrome-extension://${chrome.runtime.id}`,
        ...(authenticated ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(body === undefined
          ? {}
          : { 'X-ReproForge-Request': crypto.randomUUID() }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(75000),
    }).catch(() => {
      throw new Error(
        'Local companion unavailable or timed out. Check its terminal; uncertain publications must be checked on GitHub before retrying.',
      );
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      if (response.status === 401) this.emit(null);
      const error = z
        .object({ error: z.object({ code: z.string(), message: z.string() }) })
        .safeParse(data);
      throw new Error(
        error.success
          ? `${error.data.error.code}: ${error.data.error.message}`
          : 'Companion operation failed.',
      );
    }
    return data;
  }
  async disconnect() {
    try {
      if (this.token) await this.request('/disconnect', {});
    } finally {
      this.token = '';
      this.base = '';
      this.emit(null);
    }
  }
}
// Memory only: closing DevTools revokes client-side credentials. Restart companion to re-pair.
export const companionClient = new CompanionClient();
