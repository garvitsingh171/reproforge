import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTwoFilesPatch, parsePatch, applyPatch } from 'diff';
import {
  scrubText,
  type ApprovedContext,
  type FixProposal,
  type ModelPatch,
  type Verification,
} from '@reproforge/shared/integrations';
import { Workspace, hash, allowedPath } from './workspace';
import { invariant } from './errors';
export interface StagedCopy {
  root: string;
  baseline: string;
  patched: string;
}
export class PatchService {
  readonly proposals = new Map<string, FixProposal>();
  readonly stages = new Map<string, StagedCopy>();
  readonly reports = new Map<string, Verification>();
  constructor(private workspace: Workspace) {}
  propose(context: ApprovedContext, model: ModelPatch): FixProposal {
    invariant(
      this.proposals.size < 20,
      'PROPOSAL_LIMIT',
      'Clear the session before creating more proposals.',
    );
    const grouped = new Map<string, ModelPatch['edits']>();
    for (const edit of model.edits) {
      invariant(
        allowedPath(edit.path),
        'PROTECTED_PATH',
        'Proposed changes include a protected path.',
        403,
      );
      const list = grouped.get(edit.path) ?? [];
      list.push(edit);
      grouped.set(edit.path, list);
    }
    invariant(
      grouped.size <= 5,
      'PATCH_LIMIT',
      'At most five files may change.',
    );
    const files: FixProposal['files'] = [];
    let changed = 0;
    for (const [path, edits] of grouped) {
      const source = context.files.find((f) => f.path === path);
      invariant(
        source?.patchable,
        'UNAPPROVED_FILE',
        'A patch may only edit approved, unredacted source files.',
        403,
      );
      let after = source.content;
      for (const edit of edits) {
        invariant(
          !/DEMO_MODE|mode\s*(?:===|==|=)\s*['"]fixed['"]/.test(edit.after),
          'MODE_SWITCH',
          'Changing demo mode is not a source-repair demonstration.',
        );
        invariant(
          edit.before.split('\n').length <= 80 &&
            edit.after.split('\n').length <= 80,
          'PATCH_LIMIT',
          'An edit may change at most 80 lines; use a minimal patch.',
        );
        const first = after.indexOf(edit.before);
        invariant(
          first >= 0 && after.indexOf(edit.before, first + 1) < 0,
          'PATCH_CONFLICT',
          'An edit must match exactly one source span.',
          409,
        );
        invariant(
          scrubText(edit.after) === edit.after,
          'SECRET_PATCH',
          'Proposed code contains a recognizable secret.',
          403,
        );
        after =
          after.slice(0, first) +
          edit.after +
          after.slice(first + edit.before.length);
      }
      invariant(
        after !== source.content,
        'EMPTY_PATCH',
        'The proposal makes no change.',
      );
      invariant(
        Buffer.byteLength(after) <= 65536,
        'PATCH_LIMIT',
        'Patched source exceeds 64 KiB.',
      );
      const diff = createTwoFilesPatch(
        `a/${path}`,
        `b/${path}`,
        source.content,
        after,
        '',
        '',
        { context: 3 },
      );
      const parsed = parsePatch(diff);
      invariant(
        parsed.length === 1 &&
          applyPatch(source.content, parsed[0]!, { fuzzFactor: 0 }) === after,
        'INVALID_PATCH',
        'Generated unified diff could not be validated.',
      );
      const lines = diff.split('\n');
      const added = lines.filter(
          (l) => l.startsWith('+') && !l.startsWith('+++'),
        ).length,
        removed = lines.filter(
          (l) => l.startsWith('-') && !l.startsWith('---'),
        ).length;
      changed += added + removed;
      files.push({
        path,
        originalHash: source.hash,
        afterHash: hash(after),
        before: source.content,
        after,
        diff,
        added,
        removed,
        explanation: scrubText(edits.map((e) => e.explanation).join('\n')),
      });
    }
    invariant(
      changed <= 300,
      'PATCH_LIMIT',
      'A proposal may change at most 300 lines.',
    );
    const proposal: FixProposal = {
      id: randomUUID(),
      contextId: context.id,
      workspace: context.workspace,
      baseCommit: context.baseCommit,
      summary: scrubText(model.summary),
      files,
      tests: model.tests.map(scrubText),
      risks: model.risks.map(scrubText),
      assumptions: model.assumptions.map(scrubText),
      state: 'proposed',
    };
    this.proposals.set(proposal.id, proposal);
    return proposal;
  }
  get(id: string) {
    const value = this.proposals.get(id);
    invariant(value, 'PROPOSAL_MISSING', 'Proposal not found.', 404);
    return value;
  }
  async current(p: FixProposal) {
    invariant(
      (await this.workspace.head()) === p.baseCommit,
      'STALE_COMMIT',
      'HEAD changed. Regenerate the proposal.',
      409,
    );
    for (const file of p.files)
      invariant(
        hash(await this.workspace.read(file.path)) === file.originalHash,
        'STALE_SOURCE',
        'Source changed since review. Regenerate the proposal.',
        409,
      );
  }
  async stage(id: string, approved: boolean) {
    invariant(
      approved,
      'APPROVAL_REQUIRED',
      'Explicit staging approval is required.',
      403,
    );
    const p = this.get(id);
    invariant(
      p.state === 'proposed',
      'INVALID_STATE',
      'Only a reviewed proposal can be staged.',
      409,
    );
    await this.current(p);
    const root = await mkdtemp(join(tmpdir(), 'reproforge-stage-'));
    const baseline = join(root, 'baseline'),
      patched = join(root, 'patched');
    await mkdir(baseline);
    await mkdir(patched);
    try {
      await this.workspace.snapshot(baseline);
      await this.workspace.snapshot(patched);
      await this.current(p);
      for (const file of p.files) {
        invariant(
          hash(await readFile(join(patched, file.path), 'utf8')) ===
            file.originalHash,
          'SNAPSHOT_CONFLICT',
          'Source changed during staging.',
          409,
        );
        await writeFile(join(patched, file.path), file.after);
      }
      this.stages.set(id, { root, baseline, patched });
      p.state = 'staged';
      p.stageLocation = patched;
      return p;
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  }
  async assertStage(id: string) {
    const stage = this.stages.get(id);
    invariant(
      stage,
      'NOT_STAGED',
      'Stage the proposal before verification.',
      409,
    );
    const p = this.get(id);
    for (const file of p.files) {
      invariant(
        hash(await readFile(join(stage.baseline, file.path), 'utf8')) ===
          file.originalHash &&
          hash(await readFile(join(stage.patched, file.path), 'utf8')) ===
            file.afterHash,
        'STAGE_CHANGED',
        'Staged files changed unexpectedly; discard and regenerate.',
        409,
      );
    }
    return stage;
  }
  async reject(id: string) {
    const p = this.get(id);
    invariant(
      !['branched', 'pushed', 'pr-created'].includes(p.state),
      'BRANCH_EXISTS',
      'A local or remote branch already exists. It will not be deleted automatically.',
      409,
    );
    const stage = this.stages.get(id);
    if (stage) await rm(stage.root, { recursive: true, force: true });
    this.stages.delete(id);
    p.state = 'rejected';
    delete p.stageLocation;
    return p;
  }
  async close() {
    for (const stage of this.stages.values())
      await rm(stage.root, { recursive: true, force: true });
    this.stages.clear();
  }
}
