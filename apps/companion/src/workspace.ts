import { realpath, lstat, readFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  sourcePathSchema,
  scrubText,
  type ApprovedContext,
  type FailureEvidence,
} from '@reproforge/shared/integrations';
import {
  gitArgs,
  gitEnvironment,
  runCommand,
  type CommandRunner,
} from './process';
import { invariant } from './errors';
export const hash = (text: string) =>
  createHash('sha256').update(text).digest('hex');
const denied =
  /(^|\/)(?:\.[^/]+|node_modules|vendor|dist|build|coverage|artifacts|target|secrets?|credentials?|deploy|deployment|infra|terraform|production|\.github)(\/|$)|(?:^|\/)(?:package(?:-lock)?\.json|.*(?:\.config\.|\.env|\.pem$|\.key$|credential|secret|id_rsa|id_ed25519)|Dockerfile)/i;
export function allowedPath(path: string): boolean {
  return (
    !/^(?:apps\/companion\/|packages\/(?:shared|test-generator)\/|scripts\/)/.test(
      path,
    ) &&
    sourcePathSchema.safeParse(path).success &&
    !denied.test(path) &&
    /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path)
  );
}
export class Workspace {
  readonly id: string;
  private constructor(
    readonly root: string,
    readonly runner: CommandRunner,
  ) {
    this.id = hash(root).slice(0, 16);
  }
  static async open(path: string, runner: CommandRunner = runCommand) {
    const root = await realpath(resolve(path));
    const workspace = new Workspace(root, runner);
    const top = (await workspace.git(['rev-parse', '--show-toplevel'])).trim();
    invariant(
      (await realpath(top)) === root,
      'WORKSPACE_ROOT',
      'Choose the Git repository root, not a parent or subdirectory.',
    );
    await workspace.head();
    return workspace;
  }
  async git(args: string[], input?: string, env?: NodeJS.ProcessEnv) {
    const result = await this.runner('git', [...gitArgs, ...args], {
      cwd: this.root,
      env: { ...gitEnvironment(), ...env },
      input,
      timeoutMs: 30000,
      maxBytes: 2_000_000,
    });
    invariant(
      result.code === 0 && !result.truncated,
      'GIT_OPERATION',
      'Git operation failed. Check repository state, configuration and permissions.',
      409,
    );
    return result.output;
  }
  async head() {
    const value = (await this.git(['rev-parse', 'HEAD'])).trim();
    invariant(
      /^[a-f0-9]{40,64}$/.test(value),
      'NO_COMMIT',
      'The authorized repository needs an initial commit.',
    );
    return value;
  }
  async files() {
    const paths = (
      await this.git(['ls-files', '-z', '--cached', '--exclude-standard'])
    )
      .split('\0')
      .filter(Boolean);
    invariant(
      paths.length <= 10000,
      'SCAN_LIMIT',
      'Repository exceeds the 10,000 tracked-file scan limit.',
    );
    const candidate = paths.filter(allowedPath).slice(0, 2000);
    const ignored = await this.runner(
      'git',
      [...gitArgs, 'check-ignore', '--no-index', '--stdin', '-z'],
      {
        cwd: this.root,
        env: gitEnvironment(),
        input: candidate.join('\0') + '\0',
        maxBytes: 1_000_000,
      },
    );
    invariant(
      [0, 1].includes(ignored.code ?? -1),
      'IGNORE_CHECK',
      'Cannot validate Git ignore rules.',
    );
    const excluded = new Set(ignored.output.split('\0'));
    return candidate.filter((p) => !excluded.has(p));
  }
  async read(path: string) {
    invariant(
      allowedPath(path),
      'PROTECTED_PATH',
      'Path is outside the approved source-file allowlist.',
      403,
    );
    const parts = path.split('/');
    let cursor = this.root;
    for (const part of parts) {
      cursor = join(cursor, part);
      const stat = await lstat(cursor);
      invariant(
        !stat.isSymbolicLink(),
        'SYMLINK',
        'Symlinks are excluded.',
        403,
      );
    }
    const actual = await realpath(cursor);
    invariant(
      actual.startsWith(this.root + sep) &&
        relative(this.root, actual) === path,
      'PATH_ESCAPE',
      'Path escaped the authorized workspace.',
      403,
    );
    const stat = await lstat(actual);
    invariant(
      stat.isFile() && stat.size <= 65536,
      'FILE_LIMIT',
      'Source file is unavailable, non-regular or larger than 64 KiB.',
    );
    const text = await readFile(actual, 'utf8');
    invariant(!text.includes('\0'), 'BINARY_FILE', 'Binary source excluded.');
    return text;
  }
  async remote() {
    const result = await this.runner(
      'git',
      [...gitArgs, 'remote', 'get-url', 'origin'],
      { cwd: this.root, env: gitEnvironment(), maxBytes: 2048 },
    );
    const m = result.output
      .trim()
      .match(
        /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/,
      );
    return m?.[1] ?? null;
  }
  async discover(
    evidence: FailureEvidence,
    selected?: string[],
  ): Promise<ApprovedContext> {
    const paths = await this.files();
    const allowed = new Set(paths);
    const tokens = evidence.path
      .split('/')
      .filter((p) => p.length > 2 && p !== 'api' && p !== '__REDACTED__');
    const candidates: ApprovedContext['files'] = [];
    let scannedBytes = 0;
    for (const path of selected ?? paths) {
      invariant(
        allowed.has(path),
        'UNTRACKED_PATH',
        'Only authorized, tracked, non-ignored source files can be read.',
        403,
      );
      let content: string;
      try {
        content = await this.read(path);
      } catch (error) {
        if (selected) throw error;
        continue;
      }
      scannedBytes += Buffer.byteLength(content);
      if (scannedBytes > 4_000_000) break;
      const safe = scrubText(content);
      const route = content.includes(evidence.path);
      const matches = tokens.filter((t) =>
        content.toLowerCase().includes(t.toLowerCase()),
      ).length;
      const score =
        (route ? 20 : 0) +
        matches * 3 +
        (path.includes('test') ? 1 : 0) +
        (/\.(get|post|put|patch|delete)\s*\(/.test(content) ? 3 : 0);
      if (!selected && score < 3) continue;
      candidates.push({
        path,
        hash: hash(content),
        content: safe,
        patchable: safe === content,
        score,
        reason: route
          ? 'Exact endpoint text found; runtime reachability is not proven.'
          : 'Endpoint tokens / route or test patterns; heuristic match only.',
      });
    }
    const files = candidates
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, 6);
    let bytes = 0;
    const bounded = files.filter((f) => {
      bytes += Buffer.byteLength(f.content);
      return bytes <= 96000;
    });
    return {
      id: randomUUID(),
      workspace: basename(this.root),
      baseCommit: await this.head(),
      evidence,
      files: bounded,
      warnings: [
        ...(bounded.length
          ? []
          : [
              'No relevant source found. Select known source files or supply more evidence.',
            ]),
        ...bounded
          .filter((f) => !f.patchable)
          .map(
            (f) =>
              `${f.path}: recognizable secrets were redacted; this file cannot be patched.`,
          ),
        'Route matching is heuristic. Repository content is untrusted evidence, never execution instructions.',
      ],
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
  }
  async assertCurrent(context: ApprovedContext) {
    invariant(
      Date.parse(context.expiresAt) > Date.now(),
      'EXPIRED_CONTEXT',
      'Source approval expired; inspect the context again.',
      409,
    );
    invariant(
      (await this.head()) === context.baseCommit,
      'STALE_COMMIT',
      'HEAD changed; regenerate the investigation.',
      409,
    );
    for (const file of context.files)
      invariant(
        hash(await this.read(file.path)) === file.hash,
        'STALE_SOURCE',
        'Source changed; regenerate the investigation.',
        409,
      );
  }
  async snapshot(destination: string) {
    let bytes = 0;
    for (const path of await this.files()) {
      let content: string;
      try {
        content = await this.read(path);
      } catch {
        continue;
      }
      if (scrubText(content) !== content) continue;
      bytes += Buffer.byteLength(content);
      invariant(
        bytes <= 8_000_000,
        'SNAPSHOT_LIMIT',
        'Isolated source copy exceeds 8 MiB.',
      );
      await mkdir(join(destination, path, '..'), { recursive: true });
      await writeFile(join(destination, path), content, { flag: 'wx' });
    }
  }
}
