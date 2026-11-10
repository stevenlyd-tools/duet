import { inspectFreshness, type FreshnessConfig } from './freshness.ts';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export class DuetError extends Error {
  code: string;
  details: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'DuetError';
    this.code = code;
    this.details = details;
  }
}

export type Config = {
  version: 1;
  projectId: string;
  mainBranch: string;
  mainRemote?: string;
  mainRemoteBranch?: string;
  hooks: Record<string, unknown>;
};
export type Pin = { id: string; checkpoint: string };
export type Checkpoint = {
  id: string;
  commit: string;
  baseCommit: string;
  mainCommit: string;
  dependencies: Pin[];
  description: string;
  acceptance: string[];
  createdAt: string;
};
export type Experiment = {
  id: string;
  branch: string;
  path: string;
  mainCommit: string;
  baseCommit: string;
  dependencies: Pin[];
  checkpoints: Checkpoint[];
  selected?: string;
  status: 'active' | 'discarded' | 'merged';
  createdAt: string;
  mergedCommit?: string;
  mergedCheckpoint?: string;
};
export type ManifestSnapshot = {
  id: string;
  checkpoint: string;
  commit: string;
  baseCommit: string;
  dependencies: Pin[];
  description: string;
  acceptance: string[];
  alreadyInMain: boolean;
};
export type Manifest = {
  version: 1;
  projectId: string;
  mainBranch: string;
  mainCommit: string;
  requested: string[];
  snapshots: ManifestSnapshot[];
  key: string;
};
export type HookContext = {
  kind: 'alpha' | 'harden';
  cwd: string;
  id?: string;
  manifest: Manifest;
  config: Config;
};
export type HookResult = { ok: boolean; details?: unknown };
export type EngineOptions = {
  runChecks?: (context: HookContext) => HookResult;
};
export type Attempt = {
  id: string;
  kind: 'alpha' | 'harden';
  experiment?: string;
  path: string;
  branch?: string;
  manifest: Manifest;
  status: 'building' | 'conflict' | 'check-failed' | 'ready';
  head?: string;
  checks?: HookResult;
  checkedConfigDigest?: string;
  error?: { code: string; message: string; details?: unknown };
  createdAt: string;
};
type State = {
  version: 1;
  projectId: string;
  experiments: Record<string, Experiment>;
  attempts: Attempt[];
  integratedSnapshots?: {id:string;checkpoint:string;commit:string;mergedCommit:string}[];
  candidate?: string;
  latestAlphaAttempt?: string;
};
export type InitOptions = { mainRemote?: string; mainRemoteBranch?: string; mainBranch?: string; projectId?: string; hooks?: Record<string, unknown> };
export type CheckpointOptions = {
  select?: boolean;
  message?: string;
  description?: string;
  acceptance?: string[] | string;
};

const stamp = () => new Date().toISOString();
const validId = (value: string, kind = 'experiment') => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)
      || ['__proto__', 'constructor', 'prototype'].includes(value)) {
    throw new DuetError('INVALID_ID', `Invalid ${kind} ID. Use 1–64 letters, numbers, underscores, or hyphens; start with a letter or number.`);
  }
  return value;
};
const errorInfo = (error: unknown) => error instanceof DuetError
  ? { code: error.code, message: error.message, details: error.details }
  : { code: 'FAILED', message: error instanceof Error ? error.message : String(error) };
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Project-local Git orchestration. No operation checks out, resets, pushes, or deploys main. */
export class Engine {
  root: string;
  options: EngineOptions;
  duetDir: string;
  constructor(projectRoot: string, options: EngineOptions = {}) {
    this.root = realpathSync(resolve(projectRoot));
    this.options = options;
    const gitRoot = this.git(['rev-parse', '--show-toplevel']).trim();
    if (realpathSync(gitRoot) !== this.root) {
      throw new DuetError('PROJECT_ROOT_REQUIRED', `Use the repository root: ${gitRoot}`);
    }
    this.duetDir = join(this.root, '.duet');
    this.assertSafePath(this.duetDir);
  }

  init(options: InitOptions = {}) {
    this.assertSafePath(this.duetDir);
    mkdirSync(this.duetDir, { recursive: true });
    return this.lock(() => {
      const configPath = join(this.duetDir, 'config.json');
      if (existsSync(configPath)) {
        const config = this.config();
        if (!existsSync(join(this.duetDir, 'state.json'))) {
          const worktrees = this.managedPath('worktrees');
          const refs = this.git(['for-each-ref', '--format=%(refname)', 'refs/heads/duet', 'refs/duet']).trim();
          if ((existsSync(worktrees) && readdirSync(worktrees).length) || refs) throw new DuetError('STATE_MISSING', 'Runtime state is missing but Duet worktrees or local refs exist. Restore the state before continuing.');
          this.ensureRuntimeIgnored();
          this.save({ version: 1, projectId: config.projectId, experiments: {}, attempts: [] });
          return { ok: true, initialized: true, runtimeOnly: true, root: this.root, config };
        }
        this.state(config);
        return { ok: true, initialized: false, root: this.root, config };
      }
      const mainBranch = options.mainBranch ?? 'main';
      this.validateMainBranch(mainBranch);
      this.resolveMain(mainBranch);
      const config: Config = {
        version: 1,
        projectId: validId(options.projectId ?? `project-${randomUUID().slice(0, 8)}`, 'project'),
        mainBranch,
        ...(options.mainRemote ? {mainRemote: options.mainRemote} : {}),
        ...(options.mainRemoteBranch ? {mainRemoteBranch: options.mainRemoteBranch} : {}),
        hooks: options.hooks ?? {
          checks: [], envAllow: [],
        },
      };
      this.writeJson(configPath, config);
      this.ensureRuntimeIgnored();
      this.save({ version: 1, projectId: config.projectId, experiments: {}, attempts: [] });
      return { ok: true, initialized: true, root: this.root, config, next: 'Local coordination initialized. Review and commit .duet/config.json and .gitignore, then configure local checks. Alpha deployment uses the project CI/CD.' };
    });
  }

  configure(patch: { mainBranch?: string; hooks?: Record<string, unknown> }) {
    return this.lock(() => {
      const config = this.config();
      if (patch.mainBranch !== undefined) {
        this.validateMainBranch(patch.mainBranch);
        this.resolveMain(patch.mainBranch);
        config.mainBranch = patch.mainBranch;
      }
      if (patch.hooks !== undefined) config.hooks = patch.hooks;
      this.writeJson(join(this.duetDir, 'config.json'), config);
      return { ok: true, config };
    });
  }

  /** Task-start/resume check; fetches refs, never edits working files or local branches. */
  freshness(overrides: Partial<FreshnessConfig> = {}, cwd = this.root) {
    const config = existsSync(join(this.duetDir, 'config.json')) ? this.config() : { mainBranch: 'main' };
    try { return inspectFreshness(cwd, { ...config, ...overrides }, (args, path) => this.gitResult(args, path)); }
    catch (error) {
      if (error instanceof Error && 'code' in error) throw new DuetError(String(error.code), error.message, (error as {details?: unknown}).details);
      throw error;
    }
  }

  resume(id: string) {
    const experiment = this.activeExperiment(this.state(this.config()), validId(id));
    this.verifyExperimentWorktree(experiment);
    return { ...this.freshness({}, experiment.path), experiment: id, path: experiment.path, recordedBase: experiment.baseCommit,
      next: 'Review upstream and main/Suo drift before continuing. Managed baselines stay pinned; use a fresh ID only when intentionally refreshing.' };
  }

  private freshBase(cwd = this.root, checkUpstream = false) {
    const freshness = checkUpstream ? this.requireCurrentBranch(cwd) : this.freshness({}, cwd);
    if (freshness.mode === 'remote-verified' && freshness.main.local.ahead > 0) throw new DuetError('LOCAL_MAIN_UNPUBLISHED', 'Local main has commits absent from remote main. Reconcile/publish the intended main explicitly before creating a new baseline.', freshness);
    return freshness;
  }

  private requireCurrentBranch(cwd: string) {
    const freshness = this.freshness({}, cwd);
    if (!freshness.ok) throw new DuetError('BRANCH_OUTDATED', 'The branch has missing or incoming upstream work. Inspect and synchronize without discarding local edits, then retry.', freshness);
    return freshness;
  }

  status() {
    const config = this.config();
    const state = this.state(config);
    return {
      ok: true, root: this.root, config, deploymentEvidence: 'Local CLI receipts only; project CI/CD and live provider state are not queried.', mainCommit: this.resolveMain(config.mainBranch),
      experiments: Object.values(state.experiments).map(experiment => ({ ...experiment,
        dirty: existsSync(experiment.path) ? this.isDirty(experiment.path) : null,
        worktreeExists: existsSync(experiment.path),
      })),
      candidate: state.attempts.find(attempt => attempt.id === state.candidate) ?? null,
      attempts: state.attempts,
    };
  }

  start(id: string, options: { dependsOn?: string[] } = {}) {
    validId(id);
    return this.lock(() => {
      const config = this.config();
      const state = this.state(config);
      if (Object.hasOwn(state.experiments, id)) throw new DuetError('EXPERIMENT_EXISTS', `Experiment ${id} already exists.`);
      const dependencies = [...new Set(options.dependsOn ?? [])].map(dependency => {
        validId(dependency);
        if (dependency === id) throw new DuetError('DEPENDENCY_CYCLE', 'An experiment cannot depend on itself.');
        const experiment = this.experiment(state, dependency);
        if (experiment.status !== 'active' || !experiment.selected) throw new DuetError('DEPENDENCY_NOT_SELECTED', `Dependency ${dependency} needs an active selected checkpoint.`);
        return { id: dependency, checkpoint: experiment.selected };
      });
      const freshness = this.freshBase();
      const mainCommit = freshness.main.commit;
      const branch = `duet/experiment/${id}`;
      const path = this.managedPath('worktrees', 'experiments', id);
      if (existsSync(path)) throw new DuetError('PATH_EXISTS', `Worktree path already exists: ${path}`);
      this.git(['worktree', 'add', '-b', branch, path, mainCommit]);
      // Explicit dependencies form a pinned development baseline, never an alpha branch.
      try {
        const dependencyPlan = this.makeManifest(config, state, [], mainCommit, dependencies);
        this.applySnapshots(path, dependencyPlan);
      } catch (error) {
        throw new DuetError('DEPENDENCY_CONFLICT', `Dependency application failed in ${path}. The isolated worktree is preserved for inspection.`, { path, branch, error: errorInfo(error) });
      }
      const experiment: Experiment = {
        id, branch, path, mainCommit, baseCommit: this.head(path), dependencies,
        checkpoints: [], status: 'active', createdAt: stamp(),
      };
      state.experiments[id] = experiment;
      this.save(state);
      return { ok: true, experiment: copy(experiment), freshness };
    });
  }

  checkpoint(id: string, options: CheckpointOptions = {}) {
    validId(id);
    return this.lock(() => {
      const config = this.config();
      const state = this.state(config);
      const experiment = this.activeExperiment(state, id);
      this.verifyExperimentWorktree(experiment);
      this.requireCurrentBranch(experiment.path);
      const description = (options.description ?? options.message ?? '').trim();
      const acceptance = (Array.isArray(options.acceptance) ? options.acceptance : options.acceptance ? [options.acceptance] : []).map(item => item.trim()).filter(Boolean);
      if (options.select && (!description || !acceptance.length)) throw new DuetError('ACCEPTANCE_REQUIRED', 'A selected checkpoint needs a description and at least one acceptance criterion.');
      const conflicts = this.git(['ls-files', '--unmerged'], experiment.path).trim();
      if (conflicts) throw new DuetError('UNRESOLVED_CONFLICTS', `Resolve conflicts in ${experiment.path} before checkpointing.`);
      if (!this.isAncestor(experiment.baseCommit, this.head(experiment.path))) throw new DuetError('BASE_CHANGED', 'Experiment history no longer contains its pinned baseline.');
      this.assertNoSecretChanges(experiment);
      if (this.isDirty(experiment.path)) {
        this.git(['add', '--all', '--', '.'], experiment.path);
        this.git(['commit', '-m', options.message?.trim() || `Duet checkpoint: ${id}`], experiment.path);
      }
      this.assertNoSecretChanges(experiment);
      const checkpoint: Checkpoint = {
        id: `cp-${experiment.checkpoints.length + 1}`,
        commit: this.head(experiment.path), baseCommit: experiment.baseCommit,
        mainCommit: experiment.mainCommit, dependencies: copy(experiment.dependencies),
        description, acceptance, createdAt: stamp(),
      };
      this.git(['update-ref', `refs/duet/checkpoints/${id}/${checkpoint.id}`, checkpoint.commit, '0'.repeat(checkpoint.commit.length)]);
      experiment.checkpoints.push(checkpoint);
      if (options.select) experiment.selected = checkpoint.id;
      this.save(state);
      return { ok: true, experiment: id, checkpoint: copy(checkpoint), selected: experiment.selected ?? null };
    });
  }

  select(id: string, checkpointId?: string) {
    validId(id);
    return this.lock(() => {
      const config = this.config();
      const state = this.state(config);
      const experiment = this.activeExperiment(state, id);
      const checkpoint = checkpointId ? this.snapshot(state, { id, checkpoint: checkpointId }) : experiment.checkpoints.at(-1);
      if (!checkpoint) throw new DuetError('NO_CHECKPOINT', `Experiment ${id} has no checkpoint.`);
      this.requireAcceptance(id, checkpoint);
      experiment.selected = checkpoint.id;
      // Validate the selected dependency closure before recording it.
      this.makeManifest(config, state, [id]);
      this.save(state);
      return { ok: true, experiment: id, selected: checkpoint.id, commit: checkpoint.commit };
    });
  }

  discard(id: string) {
    validId(id);
    return this.lock(() => {
      const config = this.config();
      const state = this.state(config);
      const experiment = this.activeExperiment(state, id);
      experiment.status = 'discarded';
      delete experiment.selected;
      this.save(state);
      return { ok: true, experiment: id, status: 'discarded', path: experiment.path, preserved: true,
        next: 'The branch and worktree are retained. Rebuild alpha to remove this experiment from the preview.' };
    });
  }

  planAlpha(ids?: string[]) {
    const config = this.config();
    const state = this.state(config);
    const requested = ids ?? Object.values(state.experiments).filter(experiment => experiment.status === 'active' && experiment.selected).map(experiment => experiment.id);
    const manifest = this.makeManifest(config, state, requested);
    return { ok: true, manifest, mutation: false, candidateWillInclude: manifest.snapshots.filter(snapshot => !snapshot.alreadyInMain).map(snapshot => snapshot.id) };
  }

  composeAlpha(ids?: string[]) {
    return this.lock(() => {
      const config = this.config();
      const state = this.state(config);
      const requested = ids ?? Object.values(state.experiments).filter(experiment => experiment.status === 'active' && experiment.selected).map(experiment => experiment.id);
      const freshness = this.freshBase();
      const manifest = this.makeManifest(config, state, requested, freshness.main.commit);
      const result = this.build(state, config, manifest, 'alpha');
      if (result.attempt.head) state.candidate = result.attempt.id;
      this.save(state);
      return { ...result, freshness };
    });
  }

  checkAlpha() {
    return this.lock(() => {
      const config = this.config();
      const state = this.state(config);
      const attempt = this.candidate(state);
      this.verifyAttempt(attempt);
      if (state.latestAlphaAttempt && state.latestAlphaAttempt !== attempt.id) throw new DuetError('LATEST_COMPOSE_FAILED', 'The most recent alpha composition failed. Compose a fresh candidate before checking or deploying.');
      const freshness = this.freshBase();
      if (freshness.main.commit !== attempt.manifest.mainCommit) throw new DuetError('STALE_MAIN', 'Main changed after composition; review and recompose before checking.', freshness);
      const checks = this.runChecks(config, attempt);
      attempt.checks = checks;
      attempt.status = checks.ok ? 'ready' : 'check-failed';
      this.save(state);
      return { ok: checks.ok, attempt: copy(attempt) };
    });
  }

  harden(id: string, options: { checkpoint?: string } = {}) {
    validId(id);
    return this.lock(() => {
      const config = this.config();
      const state = this.state(config);
      const experiment = this.activeExperiment(state, id);
      if (options.checkpoint && experiment.selected !== options.checkpoint) throw new DuetError('STALE_SELECTION', 'The selected checkpoint no longer matches this handoff. Review a fresh handoff.');
      const freshness = existsSync(experiment.path) ? this.freshBase(experiment.path, true) : this.freshBase();
      const manifest = this.makeManifest(config, state, [id], freshness.main.commit);
      const result = this.build(state, config, manifest, 'harden', id);
      this.save(state);
      return { ...result, freshness };
    });
  }

  hardenCheck(id: string) {
    validId(id);
    return this.lock(() => {
      const config = this.config();
      const state = this.state(config);
      const experiment = this.activeExperiment(state, id);
      const attempt = [...state.attempts].reverse().find(item => item.kind === 'harden' && item.experiment === id);
      if (!attempt) throw new DuetError('HARDEN_REQUIRED', `Create a hardening worktree for ${id} first.`);
      if (!attempt.manifest.snapshots.some(snapshot => snapshot.id === id && snapshot.checkpoint === experiment.selected)) throw new DuetError('STALE_HARDENING', 'Selection changed after hardening. Start a new hardening worktree.');
      this.assertSafePath(attempt.path);
      if (!existsSync(attempt.path) || this.git(['symbolic-ref', '--short', 'HEAD'], attempt.path).trim() !== attempt.branch) throw new DuetError('BRANCH_CHANGED', 'The hardening branch changed or its worktree is missing.');
      if (this.isDirty(attempt.path)) throw new DuetError('DIRTY_HARDENING', 'Review and commit hardening edits before running harden-check.');
      const freshness = this.requireCurrentBranch(attempt.path);
      const head = this.head(attempt.path);
      if (freshness.mode === 'remote-verified' && !this.isAncestor(freshness.main.commit, head)) throw new DuetError('STALE_MAIN', 'Main advanced outside this hardening branch. Merge/rebase according to project policy, review Suo drift and rerun checks.', freshness);
      if (!this.isAncestor(attempt.manifest.mainCommit, head)) throw new DuetError('BASE_CHANGED', 'Hardening must descend from its recorded main snapshot.');
      this.assertNoSecretChanges({ ...experiment, path: attempt.path, baseCommit: attempt.manifest.mainCommit });
      attempt.head = head;
      attempt.checks = this.runChecks(config, attempt);
      attempt.status = attempt.checks.ok ? 'ready' : 'check-failed';
      delete attempt.error;
      this.save(state);
      return { ok: attempt.checks.ok, attempt: copy(attempt) };
    });
  }

  reconcile(id: string, options: { mergedCommit?: string } = {}) {
    validId(id);
    return this.lock(() => {
      const config = this.config();
      const state = this.state(config);
      const experiment = this.activeExperiment(state, id);
      const attempt = [...state.attempts].reverse().find(item => item.kind === 'harden' && item.experiment === id && item.status === 'ready' && item.checks?.ok);
      if (!attempt?.head) throw new DuetError('HARDEN_REQUIRED', `Harden ${id} successfully before reconciling it.`);
      this.verifyAttempt(attempt);
      if (attempt.checkedConfigDigest !== this.configDigest(config)) throw new DuetError('CHECK_CONFIG_CHANGED', 'Hook configuration changed. Run harden-check again.');
      if (!attempt.manifest.snapshots.some(snapshot => snapshot.id === id && snapshot.checkpoint === experiment.selected)) throw new DuetError('STALE_HARDENING', 'The selected checkpoint changed after hardening. Harden it again.');
      const freshness = this.freshBase();
      const mainCommit = freshness.main.commit;
      const mergedCommit = options.mergedCommit ? this.resolveCommit(options.mergedCommit) : mainCommit;
      if (!this.isAncestor(mergedCommit, mainCommit)) throw new DuetError('NOT_ON_MAIN', 'The merged commit must be contained in current main.');
      // Verify the checked content even for a merge commit. An unchecked descendant
      // cannot silently add engineering edits to the experiment's changed files.
      const files = this.git(['diff', '--name-only', '-z', '--no-ext-diff', attempt.manifest.mainCommit, attempt.head]).split('\0').filter(Boolean);
      if (!files.length || files.some(file => this.git(['diff', '--name-only', '--no-ext-diff', attempt.head!, mergedCommit, '--', file]).trim())) {
        throw new DuetError('MERGE_UNVERIFIED', 'The merge does not match the checked hardening result. For a squash merge or later main changes, provide the exact merge commit. Run harden-check after any engineering edits.');
      }
      state.integratedSnapshots ??= [];
      for(const snapshot of attempt.manifest.snapshots) {
        const record={id:snapshot.id,checkpoint:snapshot.checkpoint,commit:snapshot.commit,mergedCommit};
        state.integratedSnapshots=state.integratedSnapshots.filter(item=>!(item.id===record.id&&item.checkpoint===record.checkpoint));
        state.integratedSnapshots.push(record);
      }
      experiment.status = 'merged';
      experiment.mergedCommit = mergedCommit;
      experiment.mergedCheckpoint = experiment.selected;
      delete experiment.selected;
      this.save(state);
      const remaining = Object.values(state.experiments).filter(item => item.status === 'active' && item.selected).map(item => item.id);
      let nextPlan: unknown;
      try { nextPlan = this.makeManifest(config, state, remaining, mainCommit); }
      catch (error) { nextPlan = { error: errorInfo(error) }; }
      return { ok: true, experiment: id, mergedCommit, mainCommit, nextPlan,
        next: 'Rebuild alpha from current main and the remaining selected checkpoints, then deploy it through the project Alpha workflow. Existing worktrees and checkpoints remain unchanged.' };
    });
  }

  handoff(id?: string) {
    if (id) validId(id);
    const config = this.config();
    const state = this.state(config);
    const manifest = id ? this.makeManifest(config, state, [id]) : this.planAlpha().manifest;
    return {
      ok: true, version: 1, projectRoot: this.root, projectId: config.projectId,
      purpose: id ? 'harden-selected-experiment' : 'alpha-preview', manifest,
      experiments: manifest.snapshots.map(snapshot => {
        const experiment = this.experiment(state, snapshot.id);
        return { id: snapshot.id, worktree: experiment.path, branch: experiment.branch, checkpoint: snapshot.checkpoint,
          commit: snapshot.commit, baseCommit: snapshot.baseCommit, description: snapshot.description,
          acceptance: snapshot.acceptance, dependencies: snapshot.dependencies,
          checkpointData: copy(this.snapshot(state, { id: snapshot.id, checkpoint: snapshot.checkpoint })),
          status: experiment.status, mergedCommit: experiment.mergedCommit, mergedCheckpoint: experiment.mergedCheckpoint,
          integration: state.integratedSnapshots?.find(item=>item.id===snapshot.id&&item.checkpoint===snapshot.checkpoint&&item.commit===snapshot.commit) };
      }),
      constraints: ['Use this exact pinned manifest.', 'Do not import the alpha worktree or branch wholesale.',
        'Do not touch unrelated experiments.', 'No production operations.', 'Use applicable existing authorization for the exact action, scope and environment; obtain a decision only when authorization is missing or changed, while respecting actual host and upstream gates.',
        'This handoff is local coordination evidence, not approval, identity verification or proof of deployment. Retained-data Alpha uses project CI/CD.'],
    };
  }

  private ensureRuntimeIgnored() {
    // Config and these ignore rules are portable; all execution state remains local.
    const ignorePath = join(this.root, '.gitignore');
    this.assertSafePath(ignorePath);
    if(existsSync(ignorePath)&&lstatSync(ignorePath).nlink>1)throw new DuetError('UNSAFE_PATH','Refusing a hard-linked .gitignore.');
    const existing = existsSync(ignorePath) ? readFileSync(ignorePath, 'utf8') : '';
    const rules = ['/.duet/state.json', '/.duet/lock', '/.duet/worktrees/', '/.duet/handoffs/', '/.duet/*.tmp'];
    const missing = rules.filter(rule => !existing.split(/\r?\n/).includes(rule));
    if (missing.length) writeFileSync(ignorePath, existing + (existing && !existing.endsWith('\n') ? '\n' : '') + '\n# Duet project-local runtime\n' + missing.join('\n') + '\n');
  }

  /** Import reviewed metadata only. Git objects must already be fetched through normal authorized Git. */
  importHandoff(report: any) {
    return this.lock(() => {
      const config = this.config();
      const state = this.state(config);
      if (!report || report.version !== 1 || report.projectId !== config.projectId || !report.manifest || !Array.isArray(report.experiments)) throw new DuetError('INVALID_HANDOFF', 'Expected a v1 handoff from this project. Share the committed project configuration, not credentials.');
      const manifest = report.manifest as Manifest;
      if (manifest.version !== 1 || manifest.projectId !== config.projectId || manifest.mainBranch !== config.mainBranch || !Array.isArray(manifest.requested) || !manifest.requested.length || !Array.isArray(manifest.snapshots) || manifest.snapshots.length !== report.experiments.length) throw new DuetError('INVALID_HANDOFF', 'Handoff manifest shape or project identity does not match.');
      const unsigned = { ...manifest }; delete (unsigned as Partial<Manifest>).key;
      if (createHash('sha256').update(JSON.stringify(unsigned)).digest('hex') !== manifest.key) throw new DuetError('INVALID_HANDOFF', 'Handoff manifest integrity check failed.');
      this.validateHash(manifest.mainCommit); this.resolveCommit(manifest.mainCommit);
      const prospective = copy(state);
      const incoming = new Set<string>();
      const pins: {ref:string;commit:string;exists:boolean}[] = [];
      for (const record of report.experiments) {
        const id = validId(record?.id);
        if (incoming.has(id)) throw new DuetError('INVALID_HANDOFF', 'Duplicate experiment in handoff.');
        incoming.add(id);
        const raw = record.checkpointData;
        if (!raw || typeof raw !== 'object' || !Array.isArray(raw.dependencies) || !Array.isArray(raw.acceptance) || typeof raw.description !== 'string' || typeof raw.createdAt !== 'string') throw new DuetError('INVALID_HANDOFF', `Missing portable checkpoint metadata for ${id}. Export a new handoff.`);
        const cp: Checkpoint = {
          id: validId(raw.id, 'checkpoint'), commit: raw.commit, baseCommit: raw.baseCommit, mainCommit: raw.mainCommit,
          dependencies: raw.dependencies.map((pin: any) => ({id:validId(pin?.id),checkpoint:validId(pin?.checkpoint,'checkpoint')})),
          description: raw.description, acceptance: [...raw.acceptance], createdAt: raw.createdAt,
        };
        for (const sha of [cp.commit,cp.baseCommit,cp.mainCommit]) {this.validateHash(sha);this.resolveCommit(sha);}
        this.requireAcceptance(id,cp);
        if (!this.isAncestor(cp.baseCommit,cp.commit) || !this.isAncestor(cp.mainCommit,cp.baseCommit)) throw new DuetError('INVALID_HANDOFF', 'Checkpoint ancestry does not match its recorded baseline.');
        const snapshot = manifest.snapshots.find(item=>item.id===id);
        if (!snapshot || snapshot.checkpoint!==cp.id || snapshot.commit!==cp.commit || snapshot.baseCommit!==cp.baseCommit || snapshot.description!==cp.description || JSON.stringify(snapshot.acceptance)!==JSON.stringify(cp.acceptance) || JSON.stringify(snapshot.dependencies)!==JSON.stringify(cp.dependencies)) throw new DuetError('INVALID_HANDOFF', 'Checkpoint data differs from the pinned manifest.');
        const path = this.managedPath('worktrees','experiments',id);
        const candidate: Experiment = {id,branch:`duet/experiment/${id}`,path,mainCommit:cp.mainCommit,baseCommit:cp.baseCommit,dependencies:copy(cp.dependencies),checkpoints:[cp],selected:cp.id,status:'active',createdAt:cp.createdAt};
        if (record.status==='merged') {
          this.validateHash(record.mergedCommit);this.resolveCommit(record.mergedCommit);
          if (record.mergedCheckpoint!==cp.id || !this.isAncestor(record.mergedCommit,this.resolveMain(config.mainBranch))) throw new DuetError('INVALID_HANDOFF','Merged dependency is not verifiable on local main. Sync main or export a new handoff.');
          const local=state.experiments[id];
          const locallyVerified=local?.status==='merged' && local.mergedCheckpoint===cp.id && local.mergedCommit===record.mergedCommit;
          const ancestryVerified=this.isAncestor(cp.commit,record.mergedCommit);
          const changed=this.git(['diff','--no-ext-diff','--no-textconv','--name-only','-z',cp.baseCommit,cp.commit,'--']).split('\0').filter(Boolean);
          const contentVerified=changed.length>0 && changed.every(file=>!this.git(['diff','--no-ext-diff','--no-textconv','--name-only',cp.commit,record.mergedCommit,'--',file]).trim());
          if(!locallyVerified&&!ancestryVerified&&!contentVerified)throw new DuetError('HANDOFF_MERGE_UNVERIFIED','A claimed merged dependency lacks local ancestry or matching changed-file evidence. Import before merging, or reconcile it locally; an ancestor label alone is insufficient.');
          candidate.status='merged';candidate.mergedCommit=record.mergedCommit;candidate.mergedCheckpoint=cp.id;delete candidate.selected;
        } else if(record.status!=='active') throw new DuetError('INVALID_HANDOFF','Only active or verified merged dependencies may be imported.');
        if(record.integration) {
          const integrated=record.integration;
          if(integrated.id!==id||integrated.checkpoint!==cp.id||integrated.commit!==cp.commit)throw new DuetError('INVALID_HANDOFF','Integration proof identifies another checkpoint.');
          this.validateHash(integrated.mergedCommit);this.resolveCommit(integrated.mergedCommit);
          if(!this.isAncestor(integrated.mergedCommit,this.resolveMain(config.mainBranch)))throw new DuetError('HANDOFF_MERGE_UNVERIFIED','Integrated checkpoint is not on local main.');
          const local=(state.integratedSnapshots??[]).some(item=>item.id===id&&item.checkpoint===cp.id&&item.commit===cp.commit&&item.mergedCommit===integrated.mergedCommit);
          const changed=this.git(['diff','--no-ext-diff','--no-textconv','--name-only','-z',cp.baseCommit,cp.commit,'--']).split('\0').filter(Boolean);
          const matches=changed.length>0&&changed.every(file=>!this.git(['diff','--no-ext-diff','--no-textconv','--name-only',cp.commit,integrated.mergedCommit,'--',file]).trim());
          if(!local&&!this.isAncestor(cp.commit,integrated.mergedCommit)&&!matches)throw new DuetError('HANDOFF_MERGE_UNVERIFIED','Integrated dependency has no local content or ancestry proof.');
          prospective.integratedSnapshots??=[];
          if(!prospective.integratedSnapshots.some(item=>item.id===id&&item.checkpoint===cp.id&&item.commit===cp.commit))prospective.integratedSnapshots.push({id,checkpoint:cp.id,commit:cp.commit,mergedCommit:integrated.mergedCommit});
        }
        const existing = prospective.experiments[id];
        if (existing) {
          const same=existing.checkpoints.find(item=>item.id===cp.id);
          if (!same || JSON.stringify(same)!==JSON.stringify(cp) || (existing.status==='active'&&existing.selected!==cp.id) || existing.status!==candidate.status) throw new DuetError('HANDOFF_CONFLICT', `Existing experiment ${id} differs. Existing work and selection were preserved; reconcile it manually.`);
        } else {
          if (existsSync(path)) throw new DuetError('HANDOFF_CONFLICT',`Existing unmanaged worktree for ${id}.`);
          prospective.experiments[id]=candidate;
        }
        const ref=`refs/duet/checkpoints/${id}/${cp.id}`;
        const old=this.gitResult(['rev-parse','--verify','--quiet',ref]);
        if (old.status===0 && old.stdout.toString().trim()!==cp.commit) throw new DuetError('HANDOFF_CONFLICT',`Existing immutable ref differs for ${id}@${cp.id}.`);
        if(old.status!==0&&old.status!==1) throw new DuetError('GIT_FAILED','Could not inspect checkpoint ref.');
        pins.push({ref,commit:cp.commit,exists:old.status===0});
      }
      // Reconstruct the source plan to verify closure, ordering, status, and the exact pin set.
      const reconstructed=this.makeManifest(config,prospective,manifest.requested,manifest.mainCommit);
      if(reconstructed.key!==manifest.key)throw new DuetError('INVALID_HANDOFF','Handoff dependency closure does not reproduce its source manifest.');
      for(const pin of pins) if(!pin.exists)this.git(['update-ref',pin.ref,pin.commit,'0'.repeat(pin.commit.length)]);
      this.save(prospective);
      return {ok:true,imported:[...incoming],sourceManifestKey:manifest.key,manifest:this.makeManifest(config,prospective,manifest.requested),next:'Review the imported checkpoints, then harden the chosen ID with --checkpoint CP_ID. No source worktree, remote fetch, push, hook execution, or deployment was performed.'};
    });
  }

  private config(): Config {
    const path = join(this.duetDir, 'config.json');
    this.assertSafePath(path);
    if (!existsSync(path)) throw new DuetError('NOT_INITIALIZED', 'Local coordinator is not initialized. Use duet init only if local coordination is needed; the Duet skill can run with ordinary Git and project CI/CD without initialization.');
    const config = this.readJson<Config>(path);
    if (config.version !== 1 || typeof config.projectId !== 'string' || !config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) throw new DuetError('INVALID_CONFIG', 'Unsupported or invalid Duet config.');
    validId(config.projectId, 'project');
    this.validateMainBranch(config.mainBranch);
    return config;
  }
  private state(config: Config): State {
    const path = join(this.duetDir, 'state.json');
    this.assertSafePath(path);
    if (!existsSync(path)) throw new DuetError('STATE_MISSING', 'Runtime state is missing. Do not reinitialize over existing worktrees. Restore the local state or use a fresh project clone.');
    const state = this.readJson<State>(path);
    if (state.version !== 1 || state.projectId !== config.projectId || !state.experiments || !Array.isArray(state.attempts)) throw new DuetError('INVALID_STATE', 'Invalid state or project/config identity mismatch.');
    for (const [id, experiment] of Object.entries(state.experiments)) {
      validId(id);
      if (experiment.id !== id || experiment.path !== this.managedPath('worktrees', 'experiments', id) || experiment.branch !== `duet/experiment/${id}` || !Array.isArray(experiment.checkpoints) || !Array.isArray(experiment.dependencies)) throw new DuetError('INVALID_STATE', `Invalid experiment state: ${id}`);
      this.validateHash(experiment.baseCommit); this.validateHash(experiment.mainCommit);
      for (const checkpoint of experiment.checkpoints) {
        validId(checkpoint.id, 'checkpoint'); this.validateHash(checkpoint.commit); this.validateHash(checkpoint.baseCommit); this.validateHash(checkpoint.mainCommit);
        if (!Array.isArray(checkpoint.dependencies) || !Array.isArray(checkpoint.acceptance)) throw new DuetError('INVALID_STATE', 'Invalid checkpoint metadata.');
      }
    }
    if(state.integratedSnapshots!==undefined&&!Array.isArray(state.integratedSnapshots))throw new DuetError('INVALID_STATE','Invalid integration records.');
    for(const item of state.integratedSnapshots??[]) {validId(item.id);validId(item.checkpoint,'checkpoint');this.validateHash(item.commit);this.validateHash(item.mergedCommit);}
    for (const attempt of state.attempts) {
      validId(attempt.id, 'attempt');
      if (!['alpha', 'harden'].includes(attempt.kind) || attempt.path !== this.managedPath('worktrees', attempt.kind, attempt.id)) throw new DuetError('INVALID_STATE', 'Invalid attempt path.');
      if (attempt.head) this.validateHash(attempt.head);
    }
    return state;
  }
  private makeManifest(config: Config, state: State, ids: string[], mainCommit = this.resolveMain(config.mainBranch), extraPins: Pin[] = []): Manifest {
    const requested = [...new Set(ids)].sort();
    const snapshots: ManifestSnapshot[] = [];
    const included = new Map<string, string>();
    const visiting = new Set<string>();
    const visit = (pin: Pin) => {
      validId(pin.id); validId(pin.checkpoint, 'checkpoint');
      if (visiting.has(pin.id)) throw new DuetError('DEPENDENCY_CYCLE', `Dependency cycle involving ${pin.id}.`);
      const existing = included.get(pin.id);
      if (existing && existing !== pin.checkpoint) throw new DuetError('DEPENDENCY_VERSION_CONFLICT', `Two different checkpoints of ${pin.id} are required: ${existing}, ${pin.checkpoint}.`);
      if (existing) return;
      const experiment = this.experiment(state, pin.id);
      if (experiment.status === 'discarded') throw new DuetError('DEPENDENCY_DISCARDED', `Required experiment ${pin.id} was discarded. Remove the dependency or choose another checkpoint.`);
      if (experiment.status === 'merged' && experiment.mergedCheckpoint !== pin.checkpoint) throw new DuetError('DEPENDENCY_VERSION_MERGED', `Dependency ${pin.id}@${pin.checkpoint} differs from the checkpoint merged to main. Reconcile the dependent experiment before continuing.`);
      const snapshot = this.snapshot(state, pin);
      this.requireAcceptance(pin.id, snapshot);
      this.resolveCommit(snapshot.commit); this.resolveCommit(snapshot.baseCommit);
      if (!this.isAncestor(snapshot.baseCommit, snapshot.commit)) throw new DuetError('INVALID_SNAPSHOT', `${pin.id}'s snapshot does not descend from its baseline.`);
      visiting.add(pin.id);
      for (const dependency of [...snapshot.dependencies].sort((a, b) => a.id.localeCompare(b.id))) visit(dependency);
      visiting.delete(pin.id);
      const alreadyInMain = (state.integratedSnapshots??[]).some(item=>item.id===pin.id&&item.checkpoint===pin.checkpoint&&item.commit===snapshot.commit&&this.isAncestor(item.mergedCommit,mainCommit)) || this.isAncestor(snapshot.commit, mainCommit) || (experiment.status === 'merged' && experiment.mergedCheckpoint === pin.checkpoint && !!experiment.mergedCommit && this.isAncestor(experiment.mergedCommit, mainCommit));
      included.set(pin.id, pin.checkpoint);
      snapshots.push({ id: pin.id, checkpoint: snapshot.id, commit: snapshot.commit, baseCommit: snapshot.baseCommit,
        dependencies: copy(snapshot.dependencies), description: snapshot.description, acceptance: copy(snapshot.acceptance), alreadyInMain });
    };
    for (const id of requested) {
      validId(id);
      const experiment = this.activeExperiment(state, id);
      if (!experiment.selected) throw new DuetError('NOT_SELECTED', `Experiment ${id} has no selected checkpoint.`);
      visit({ id, checkpoint: experiment.selected });
    }
    for (const pin of extraPins) visit(pin);
    const data = { version: 1 as const, projectId: config.projectId, mainBranch: config.mainBranch, mainCommit, requested, snapshots };
    const key = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    return { ...data, key };
  }
  private build(state: State, config: Config, manifest: Manifest, kind: 'alpha' | 'harden', experiment?: string) {
    const id = `${kind}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const path = this.managedPath('worktrees', kind, id);
    const branch = kind === 'harden' ? `duet/harden/${experiment}/${id}` : undefined;
    const attempt: Attempt = { id, kind, experiment, path, branch, manifest, status: 'building', createdAt: stamp() };
    state.attempts.push(attempt);
    if (kind === 'alpha') state.latestAlphaAttempt = id;
    this.save(state); // Persist before executing any potentially failing work.
    try {
      this.git(branch ? ['worktree', 'add', '-b', branch, path, manifest.mainCommit] : ['worktree', 'add', '--detach', path, manifest.mainCommit]);
      this.applySnapshots(path, manifest);
      attempt.head = this.head(path);
    } catch (error) {
      attempt.status = 'conflict'; attempt.error = errorInfo(error);
      this.save(state);
      return { ok: false, attempt: copy(attempt) };
    }
    attempt.checks = this.runChecks(config, attempt);
    attempt.status = attempt.checks.ok ? 'ready' : 'check-failed';
    this.save(state);
    return { ok: attempt.checks.ok, attempt: copy(attempt) };
  }
  private applySnapshots(path: string, manifest: Manifest) {
    for (const snapshot of manifest.snapshots) {
      if (snapshot.alreadyInMain) continue;
      const patch = this.gitBuffer(['diff', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', snapshot.baseCommit, snapshot.commit, '--']);
      if (!patch.length) continue;
      this.git(['apply', '--index', '--3way', '--whitespace=nowarn', '-'], path, patch);
      if (this.git(['diff', '--cached', '--name-only'], path).trim()) this.git(['commit', '-m', `Duet import ${snapshot.id}@${snapshot.checkpoint}\n\nPinned snapshot: ${snapshot.commit}\nBaseline: ${snapshot.baseCommit}`], path, undefined, { GIT_AUTHOR_DATE: this.git(['show', '-s', '--format=%cI', snapshot.commit]).trim(), GIT_COMMITTER_DATE: this.git(['show', '-s', '--format=%cI', snapshot.commit]).trim() });
    }
  }
  private runChecks(config: Config, attempt: Attempt): HookResult {
    delete attempt.checkedConfigDigest;
    const checks = config.hooks.checks;
    if (!Array.isArray(checks) || checks.length === 0) return { ok: false, details: 'Configure at least one explicit check in .duet/config.json.' };
    if (!this.options.runChecks) return { ok: false, details: 'No check runner is configured.' };
    const configHash = this.configDigest(config);
    let result: HookResult;
    try { result = this.validHookResult(this.options.runChecks(this.context(config, attempt))); }
    catch (error) { result = { ok: false, details: errorInfo(error) }; }
    if (this.configDigest(this.config()) !== configHash || this.head(attempt.path) !== attempt.head || this.isDirty(attempt.path)) {
      return { ok: false, details: { message: 'Checks changed source files, HEAD, or trusted configuration. Source must remain clean and pinned.', runner: result } };
    }
    if (result.ok) attempt.checkedConfigDigest = configHash;
    return result;
  }
  private context(config: Config, attempt: Attempt): HookContext {
    return { kind: attempt.kind, cwd: attempt.path, id: attempt.experiment, manifest: copy(attempt.manifest), config: copy(config) };
  }
  private validHookResult(result: HookResult): HookResult {
    if (!result || typeof result.ok !== 'boolean' || typeof (result as unknown as { then?: unknown }).then === 'function') throw new DuetError('INVALID_HOOK_RESULT', 'Hook runners must return a synchronous { ok: boolean, details? } result.');
    return result;
  }
  private candidate(state: State) {
    const attempt = state.attempts.find(item => item.id === state.candidate && item.kind === 'alpha');
    if (!attempt) throw new DuetError('NO_CANDIDATE', 'Compose a successful alpha candidate first.');
    return attempt;
  }
  private verifyAttempt(attempt: Attempt) {
    this.assertSafePath(attempt.path);
    if (!existsSync(attempt.path) || !attempt.head || this.head(attempt.path) !== attempt.head) throw new DuetError('CANDIDATE_CHANGED', 'Candidate HEAD changed or its worktree is missing. Compose a fresh candidate.');
    if (this.isDirty(attempt.path)) throw new DuetError('DIRTY_CANDIDATE', 'The candidate worktree is dirty. Compose a fresh candidate; existing files are preserved.');
    const manifest = { ...attempt.manifest }; delete (manifest as Partial<Manifest>).key;
    if (createHash('sha256').update(JSON.stringify(manifest)).digest('hex') !== attempt.manifest.key) throw new DuetError('INVALID_MANIFEST', 'Candidate manifest integrity check failed.');
  }
  private assertNoSecretChanges(experiment: Experiment) {
    const files = new Set([
      ...this.git(['diff', '--diff-filter=ACMRTUXB', '--name-only', '-z', '--no-ext-diff', experiment.baseCommit, '--'], experiment.path).split('\0'),
      ...this.git(['ls-files', '--others', '--exclude-standard', '-z'], experiment.path).split('\0'),
    ].filter(Boolean));
    const blocked = [...files].filter(file => {
      const name = file.split('/').at(-1)!;
      return (/^\.env(?:\.|$)/i.test(name) && !/^\.env\.(?:example|sample|template)$/i.test(name))
        || /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519|credentials\.json)$/i.test(name)
        || /\.(?:pem|key)$/i.test(name) || /(?:^|\/)(?:\.aws|\.ssh)\//i.test(file);
    });
    if (blocked.length) throw new DuetError('POSSIBLE_SECRET_FILES', 'Checkpoint refused because changed files may contain secrets. Remove them from the experiment and use local ignored configuration.', { files: blocked });
  }
  private verifyExperimentWorktree(experiment: Experiment) {
    this.assertSafePath(experiment.path);
    if (!existsSync(experiment.path)) throw new DuetError('WORKTREE_MISSING', `Worktree is missing: ${experiment.path}`);
    const branch = this.git(['symbolic-ref', '--short', 'HEAD'], experiment.path).trim();
    if (branch !== experiment.branch) throw new DuetError('BRANCH_CHANGED', `Expected ${experiment.branch}, found ${branch}.`);
    if (realpathSync(this.git(['rev-parse', '--show-toplevel'], experiment.path).trim()) !== realpathSync(experiment.path)) throw new DuetError('WORKTREE_CHANGED', 'The experiment path is no longer its Git worktree.');
  }
  private requireAcceptance(id: string, checkpoint: Checkpoint) {
    if (typeof checkpoint.description !== 'string' || !checkpoint.description.trim() || !checkpoint.acceptance.length || checkpoint.acceptance.some(item => typeof item !== 'string' || !item.trim())) throw new DuetError('ACCEPTANCE_REQUIRED', `${id}@${checkpoint.id} needs a description and at least one acceptance criterion. Create a new checkpoint with that metadata.`);
  }
  private experiment(state: State, id: string): Experiment {
    validId(id);
    if (!Object.hasOwn(state.experiments, id)) throw new DuetError('EXPERIMENT_NOT_FOUND', `Unknown experiment: ${id}`);
    return state.experiments[id];
  }
  private activeExperiment(state: State, id: string) {
    const experiment = this.experiment(state, id);
    if (experiment.status !== 'active') throw new DuetError('EXPERIMENT_INACTIVE', `Experiment ${id} is ${experiment.status}.`);
    return experiment;
  }
  private snapshot(state: State, pin: Pin) {
    validId(pin.checkpoint, 'checkpoint');
    const result = this.experiment(state, pin.id).checkpoints.find(item => item.id === pin.checkpoint);
    if (!result) throw new DuetError('CHECKPOINT_NOT_FOUND', `Unknown checkpoint: ${pin.id}@${pin.checkpoint}`);
    return result;
  }
  private validateMainBranch(branch: string) {
    if (typeof branch !== 'string' || branch.startsWith('-') || branch.startsWith('duet/') || branch.startsWith('refs/') || !branch.trim()) throw new DuetError('INVALID_MAIN_BRANCH', 'Use a valid local main branch name outside duet/.');
    this.git(['check-ref-format', '--branch', branch]);
  }
  private resolveMain(branch: string) {
    return this.git(['rev-parse', '--verify', `refs/heads/${branch}^{commit}`]).trim();
  }
  private validateHash(hash: string) {
    if (typeof hash !== 'string' || !/^[0-9a-f]{40,64}$/.test(hash)) throw new DuetError('INVALID_STATE', 'Expected an immutable full Git commit ID.');
  }
  private resolveCommit(commit: string) {
    if (typeof commit !== 'string' || !/^[0-9a-f]{7,64}$/.test(commit)) throw new DuetError('INVALID_COMMIT', 'Use a Git commit SHA, not a branch or revision expression.');
    return this.git(['rev-parse', '--verify', `${commit}^{commit}`]).trim();
  }
  private head(cwd: string) { return this.git(['rev-parse', '--verify', 'HEAD^{commit}'], cwd).trim(); }
  private isAncestor(ancestor: string, descendant: string) {
    const result = this.gitResult(['merge-base', '--is-ancestor', ancestor, descendant]);
    if (result.status === 0) return true;
    if (result.status === 1) return false;
    throw new DuetError('GIT_FAILED', 'Could not inspect commit ancestry.', result.stderr.toString());
  }
  private isDirty(cwd: string) { return Boolean(this.git(['status', '--porcelain=v1', '--untracked-files=all'], cwd).trim()); }
  private git(args: string[], cwd = this.root, input?: Buffer, extraEnv: Record<string, string> = {}) { return this.gitBuffer(args, cwd, input, extraEnv).toString('utf8'); }
  private gitBuffer(args: string[], cwd = this.root, input?: Buffer, extraEnv: Record<string, string> = {}) {
    const result = this.gitResult(args, cwd, input, extraEnv);
    if (result.error || result.status !== 0) throw new DuetError('GIT_FAILED', `Git failed: ${args[0]}`, { args, cwd, status: result.status, error: result.error?.message, stderr: result.stderr?.toString('utf8'), stdout: result.stdout?.toString('utf8') });
    return result.stdout;
  }
  private gitResult(args: string[], cwd = this.root, input?: Buffer, extraEnv: Record<string, string> = {}) {
    if (['worktree', 'add', 'commit', 'apply', 'update-ref', 'status', 'diff'].includes(args[0])) this.assertNoExternalGitDrivers(cwd);
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
    return spawnSync('git', ['--literal-pathspecs', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false', '-c', 'user.name=Duet', '-c', 'user.email=duet@localhost', ...args], {
      cwd, input, env: { ...env, GIT_TERMINAL_PROMPT: '0', ...extraEnv }, shell: false, maxBuffer: 64 * 1024 * 1024, ...(args[0] === 'fetch' ? {timeout: 60_000} : {}),
    });
  }
  private assertNoExternalGitDrivers(cwd = this.root) {
    const result = this.gitResult(['config', '--get-regexp', '^(filter\\..*\\.(clean|smudge|process)|merge\\..*\\.driver)$'], cwd);
    if (result.status === 0 && result.stdout.length) {
      const names = result.stdout.toString('utf8').trim().split('\n').map(line => line.split(/\s/)[0]);
      throw new DuetError('UNSUPPORTED_GIT_FILTER', 'External Git filters or merge drivers could execute code outside approved hooks. Use a reviewed isolated clone with those drivers disabled; Duet will not bypass them or silently rewrite filtered files.', { configKeys: names });
    }
    if (result.status !== 0 && result.status !== 1) throw new DuetError('GIT_CONFIG_FAILED', 'Could not verify Git filter configuration.');
  }
  private managedPath(...parts: string[]) {
    const path = join(this.duetDir, ...parts);
    this.assertSafePath(path);
    return path;
  }
  private assertSafePath(path: string) {
    const normalized = resolve(path);
    const rel = relative(this.root, normalized);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new DuetError('UNSAFE_PATH', 'Managed paths must remain within the project.');
    let current = this.root;
    for (const part of rel.split(sep).filter(Boolean)) {
      current = join(current, part);
      try {
        if (lstatSync(current).isSymbolicLink()) throw new DuetError('UNSAFE_PATH', `Managed path contains a symlink: ${current}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
  private readJson<T>(path: string): T {
    try { return JSON.parse(readFileSync(path, 'utf8')); }
    catch (error) { throw new DuetError('INVALID_JSON', `Cannot read ${relative(this.root, path)}.`, errorInfo(error)); }
  }
  private writeJson(path: string, value: unknown) {
    this.assertSafePath(path);
    mkdirSync(dirname(path), { recursive: true });
    const temp = join(dirname(path), `${path.slice(path.lastIndexOf(sep) + 1)}.${randomUUID()}.tmp`);
    const fd = openSync(temp, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temp, path);
  }
  private save(state: State) { this.writeJson(join(this.duetDir, 'state.json'), state); }
  private configDigest(config: Config) { return createHash('sha256').update(JSON.stringify(config)).digest('hex'); }
  private lock<T>(action: () => T): T {
    this.assertSafePath(this.duetDir);
    if (!existsSync(this.duetDir)) throw new DuetError('NOT_INITIALIZED', 'Local coordinator is not initialized. Initialize only if needed for this CLI operation; the skill workflow can use ordinary Git and project CI/CD.');
    const path = join(this.duetDir, 'lock');
    this.assertSafePath(path);
    let fd: number;
    try { fd = openSync(path, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new DuetError('PROJECT_LOCKED', 'Another Duet operation holds this project lock. If a process crashed, inspect .duet/lock and remove it only after verifying that process is stopped.');
      throw error;
    }
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: stamp(), root: this.root })); return action(); }
    finally { closeSync(fd); rmSync(path); }
  }
}
