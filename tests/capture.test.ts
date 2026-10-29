import { describe, it, expect, vi } from 'vitest';
import { normalizeRequest } from '../apps/extension/src/features/network-capture/normalize';
import {
  CaptureStore,
  MAX_RECORDS,
} from '../apps/extension/src/features/network-capture/store';
import { har } from './fixtures';
describe('DevTools capture', () => {
  it('normalizes supported failures without credentials or origin', () => {
    const r = normalizeRequest(har());
    expect(r).toMatchObject({
      status: 422,
      method: 'POST',
      path: '/api/investments',
      duration: 42,
      needsAuth: true,
    });
    expect(JSON.stringify(r)).not.toContain('secret');
    expect(JSON.stringify(r)).not.toContain('production.example');
  });
  it('filters success, cancellations, assets, invalid HAR', () => {
    for (const status of [0, 200, 302, 399, 600])
      expect(normalizeRequest(har({ status }))).toBeNull();
    expect(normalizeRequest(har({ resource: 'image' }))).toBeNull();
    expect(normalizeRequest(null)).toBeNull();
  });
  it('deduplicates same events but preserves distinct repeated requests; pause/clear works', () => {
    const store = new CaptureStore(),
      entry = har(),
      listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.accept(entry);
    store.accept(entry);
    store.accept(har());
    expect(store.getSnapshot().records).toHaveLength(2);
    store.toggle();
    store.accept(har());
    expect(store.getSnapshot().records).toHaveLength(2);
    store.toggle();
    store.accept(har());
    expect(store.getSnapshot().records).toHaveLength(3);
    store.clear();
    expect(store.getSnapshot().records).toHaveLength(0);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
  it('bounds retained records and loads sanitized response only on demand', async () => {
    const store = new CaptureStore();
    const entry = har();
    const loader = vi.spyOn(entry, 'getContent');
    store.accept(entry);
    expect(loader).not.toHaveBeenCalled();
    const id = store.getSnapshot().records[0]!.id;
    await store.preview(id);
    expect(loader).toHaveBeenCalledOnce();
    expect(JSON.stringify(store.getSnapshot())).not.toContain(
      'secret-response',
    );
    expect(store.getSnapshot().records[0]?.responseBody.state).toBe(
      'available',
    );
    for (let i = 0; i < MAX_RECORDS + 10; i++) store.accept(har());
    expect(store.getSnapshot().records).toHaveLength(MAX_RECORDS);
  });
  it('does not fetch oversized, unknown-size, or non-JSON previews', () => {
    for (const options of [{ size: 1e9 }, { size: -1 }, { mime: 'text/plain' }])
      expect(normalizeRequest(har(options))?.responseBody.state).toBe(
        'excluded',
      );
  });
  it('handles failed, encoded and timed-out previews; clearing prevents late resurrection', async () => {
    const store = new CaptureStore();
    const entry = har();
    entry.getContent = (() => {
      throw new Error('lost');
    }) as typeof entry.getContent;
    store.accept(entry);
    await store.preview(store.getSnapshot().records[0]!.id);
    expect(store.getSnapshot().records[0]?.responseBody.state).toBe('excluded');
    const late = har();
    let complete: ((s: string, e: string) => void) | undefined;
    late.getContent = ((cb: (s: string, e: string) => void) => {
      complete = cb;
    }) as typeof late.getContent;
    store.accept(late);
    const pending = store.preview(store.getSnapshot().records[0]!.id);
    store.clear();
    complete?.('{}', '');
    await pending;
    expect(store.getSnapshot().records).toHaveLength(0);
  });
});

it('does not retain custom method values and includes HTTP failure boundaries', () => {
  expect(normalizeRequest(har({ method: 'PRIVATEVALUE' }))?.method).toBe(
    'UNSUPPORTED',
  );
  for (const status of [400, 499, 500, 599])
    expect(normalizeRequest(har({ status }))?.status).toBe(status);
});

it('times out a response preview without blocking capture', async () => {
  vi.useFakeTimers();
  try {
    const store = new CaptureStore();
    const entry = har();
    entry.getContent = (() => {}) as typeof entry.getContent;
    store.accept(entry);
    const promise = store.preview(store.getSnapshot().records[0]!.id);
    await vi.advanceTimersByTimeAsync(5001);
    await promise;
    expect(store.getSnapshot().records[0]?.responseBody.reason).toContain(
      '5 seconds',
    );
    store.accept(har());
    expect(store.getSnapshot().records).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});
