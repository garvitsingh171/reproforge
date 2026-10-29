import {
  MAX_BODY_BYTES,
  sanitizeBody,
  type DiagnosticRecord,
} from '@reproforge/shared';
import { normalizeRequest } from './normalize';
export const MAX_RECORDS = 150;
export type Snapshot = {
  records: DiagnosticRecord[];
  paused: boolean;
  error: string | null;
};
export interface CaptureBridge {
  getSnapshot: () => Snapshot;
  subscribe: (listener: () => void) => () => void;
  toggle: () => void;
  clear: () => void;
  preview: (id: string) => Promise<void>;
}
export class CaptureStore implements CaptureBridge {
  private state: Snapshot = { records: [], paused: false, error: null };
  private listeners = new Set<() => void>();
  private seen = new WeakSet<object>();
  private loaders = new Map<
    string,
    chrome.devtools.network.Request['getContent']
  >();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit(next: Snapshot) {
    this.state = next;
    this.listeners.forEach((fn) => fn());
  }
  toggle = () => this.emit({ ...this.state, paused: !this.state.paused });
  clear = () => {
    this.loaders.clear();
    this.emit({ ...this.state, records: [], error: null });
  };
  accept = (entry: chrome.devtools.network.Request) => {
    if (this.state.paused || this.seen.has(entry)) return;
    this.seen.add(entry);
    try {
      const record = normalizeRequest(entry);
      if (!record) return;
      if (record.responseBody.state === 'not-loaded')
        this.loaders.set(record.id, entry.getContent);
      const records = [record, ...this.state.records].slice(0, MAX_RECORDS);
      const keep = new Set(records.map((x) => x.id));
      for (const id of this.loaders.keys())
        if (!keep.has(id)) this.loaders.delete(id);
      this.emit({ ...this.state, records });
    } catch {
      this.emit({
        ...this.state,
        error:
          'A malformed network entry could not be processed. Capture continues.',
      });
    }
  };
  preview = async (id: string) => {
    const loader = this.loaders.get(id);
    if (!loader) return;
    this.loaders.delete(id);
    const body = await new Promise<DiagnosticRecord['responseBody']>(
      (resolve) => {
        const timer = setTimeout(
          () =>
            resolve({
              state: 'excluded',
              reason: 'Chrome did not return a body within 5 seconds.',
            }),
          5000,
        );
        try {
          loader((text, encoding) => {
            clearTimeout(timer);
            resolve(
              encoding || text.length > MAX_BODY_BYTES
                ? {
                    state: 'excluded',
                    reason: 'Encoded or oversized response excluded.',
                  }
                : sanitizeBody(text, 'application/json'),
            );
          });
        } catch {
          clearTimeout(timer);
          resolve({
            state: 'excluded',
            reason: 'Response body is no longer available.',
          });
        }
      },
    );
    this.emit({
      ...this.state,
      records: this.state.records.map((r) =>
        r.id === id ? { ...r, responseBody: body } : r,
      ),
    });
  };
}
