import { spawn } from 'node:child_process';
import { scrubText } from '@reproforge/shared/integrations';
export interface CommandResult {
  code: number | null;
  output: string;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
  truncated: boolean;
}
export interface CommandOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  redactOutput?: boolean;
}
export type CommandRunner = (
  file: string,
  args: string[],
  options: CommandOptions,
) => Promise<CommandResult>;
export const runCommand: CommandRunner = (file, args, options) =>
  new Promise((resolve) => {
    const started = Date.now();
    let output = '',
      bytes = 0,
      timedOut = false,
      cancelled = false,
      truncated = false,
      settled = false;
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env ?? { PATH: process.env.PATH, LANG: 'C.UTF-8' },
      shell: false,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stop = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already exited */
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs ?? 30000);
    const abort = () => {
      cancelled = true;
      stop();
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const collect = (chunk: Buffer) => {
      const remaining = (options.maxBytes ?? 65536) - bytes;
      bytes += chunk.length;
      if (remaining > 0) output += chunk.subarray(0, remaining).toString();
      if (bytes > (options.maxBytes ?? 65536)) {
        truncated = true;
        stop();
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      resolve({
        code,
        output: options.redactOutput === false ? output : scrubText(output),
        timedOut,
        cancelled,
        truncated,
        durationMs: Date.now() - started,
      });
    };
    child.on('error', () => {
      output = 'Executable unavailable or process could not start.';
      finish(null);
    });
    child.on('close', finish);
    child.stdin.on('error', () => {});
    child.stdin.end(options.input);
  });
export function gitEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: 'C.UTF-8',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
  };
}
export const gitArgs = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'protocol.ext.allow=never',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'diff.external=',
];
