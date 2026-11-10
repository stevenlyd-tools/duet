import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
type Json = Record<string, any>;

function git(root: string, ...args: string[]): string {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
  });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed:\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

function cli(root: string, args: string[], success = true): Json {
  const result = spawnSync(process.execPath, [cliPath, '--project', root, ...args], {
    encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
  });
  assert.equal(result.status, success ? 0 : 1,
    `CLI ${args.join(' ')} exit mismatch:\n${result.stdout}\n${result.stderr}`);
  const output = result.stdout.trim() || result.stderr.trim();
  assert.ok(output.startsWith('{'), `Expected structured JSON, got: ${output}`);
  return JSON.parse(output);
}

function commit(root: string, message: string): string {
  git(root, 'add', '--all');
  git(root, 'commit', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

function fixture(t: any, initialize = true) {
  const directory = mkdtempSync(join(tmpdir(), 'duet-cli-fixture-'));
  const root = join(directory, 'project with spaces');
  mkdirSync(root);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  git(root, 'init', '--initial-branch=main');
  git(root, 'config', 'user.name', 'Duet Test');
  git(root, 'config', 'user.email', 'duet-test@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'config', 'core.hooksPath', '/dev/null');
  writeFileSync(join(root, 'base.txt'), 'main\n');
  writeFileSync(join(root, 'shared.txt'), 'original\n');
  writeFileSync(join(root, 'check.cjs'), `const fs = require('node:fs');
const code = Number(fs.readFileSync(process.argv[2], 'utf8'));
if (!fs.existsSync('base.txt')) process.exit(99);
process.exit(code);
`);
  const initial = commit(root, 'Initial fixture');
  const checkControl = join(directory, 'check-exit');
  writeFileSync(checkControl, '0');
  if (initialize) {
    cli(root, ['init', '--main', 'main', '--project-id', 'cli-fixture']);
    const configPath = join(root, '.duet', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.hooks = {
      checks: [{ argv: [process.execPath, 'check.cjs', checkControl] }],
      envAllow: [],
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    commit(root, 'Configure fixture checks');
  }
  return { root, directory, initial, checkControl };
}

function experiment(root: string, id: string, files: Record<string, string>, depends?: string[]) {
  const result = cli(root, ['experiment', 'start', id, ...(depends ? ['--depends', depends.join(',')] : [])]);
  const path = result.experiment.path;
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(path, name), contents);
  const sha = commit(path, `Experiment ${id}`);
  const checkpoint = cli(root, ['experiment', 'checkpoint', id, '--description', `Try ${id}`,
    '--acceptance', `The ${id} fixture behaves as specified`, '--select']).checkpoint;
  assert.equal(checkpoint.commit, sha);
  return { path, sha, checkpoint, branch: result.experiment.branch };
}

function filesAt(root: string, ref: string): string[] {
  return git(root, 'ls-tree', '-r', '--name-only', ref).split('\n');
}

test('A/B/C alpha uses pinned commits; hardening A excludes B and C; merge and reconcile preserve the remainder', t => {
  const { root } = fixture(t);
  const mainBefore = git(root, 'rev-parse', 'main');
  const A = experiment(root, 'A', { 'A.txt': 'A checkpoint one\n' });
  experiment(root, 'B', { 'B.txt': 'B checkpoint one\n' });
  experiment(root, 'C', { 'C.txt': 'C checkpoint one\n' });

  // A moving experiment tip and a dirty main worktree must not leak into the pinned composition.
  writeFileSync(join(A.path, 'not-selected.txt'), 'later A change\n');
  commit(A.path, 'Unselected later change');
  writeFileSync(join(root, 'local-only.txt'), 'preserve dirty main worktree\n');
  const plan = cli(root, ['alpha', 'plan']);
  assert.deepEqual(plan.manifest.requested, ['A', 'B', 'C']);
  assert.equal(plan.manifest.snapshots.find((s: Json) => s.id === 'A').commit, A.sha);
  const alpha = cli(root, ['alpha', 'compose', '--approve-hooks']).attempt;
  const alphaFiles = filesAt(root, alpha.head);
  for (const id of ['A', 'B', 'C']) assert.ok(alphaFiles.includes(`${id}.txt`));
  assert.ok(!alphaFiles.includes('not-selected.txt'));
  assert.ok(!alphaFiles.includes('local-only.txt'));
  assert.equal(git(root, 'rev-parse', 'main'), mainBefore);
  assert.equal(readFileSync(join(root, 'local-only.txt'), 'utf8'), 'preserve dirty main worktree\n');
  rmSync(join(root, 'local-only.txt'));

  const handoff = cli(root, ['handoff', 'A']);
  assert.deepEqual(handoff.manifest.requested, ['A']);
  assert.equal(handoff.experiments[0].commit, A.sha);
  assert.ok(handoff.experiments[0].description);
  assert.ok(handoff.experiments[0].acceptance.length);
  const hardened = cli(root, ['harden', 'A', '--approve-hooks']).attempt;
  assert.equal(hardened.manifest.mainCommit, mainBefore);
  assert.deepEqual(hardened.manifest.snapshots.map((s: Json) => s.id), ['A']);
  const hardeningFiles = filesAt(root, hardened.head);
  assert.ok(hardeningFiles.includes('A.txt'));
  for (const excluded of ['B.txt', 'C.txt', 'not-selected.txt']) assert.ok(!hardeningFiles.includes(excluded));
  assert.equal(git(root, 'rev-parse', 'main'), mainBefore);

  git(root, 'merge', '--no-ff', hardened.branch, '-m', 'Reviewed A merge');
  const merged = git(root, 'rev-parse', 'main');
  const reconciled = cli(root, ['reconcile', 'A', '--merged', merged]);
  assert.equal(reconciled.mergedCommit, merged);
  const next = cli(root, ['alpha', 'compose', '--approve-hooks']).attempt;
  assert.deepEqual(next.manifest.requested, ['B', 'C']);
  assert.equal(next.manifest.mainCommit, merged);
  for (const id of ['A', 'B', 'C']) assert.ok(filesAt(root, next.head).includes(`${id}.txt`));
  assert.equal(cli(root, ['status']).experiments.find((e: Json) => e.id === 'A').status, 'merged');
});

test('failed checks mark the candidate and an explicit re-check recovers it', t => {
  const { root, checkControl } = fixture(t);
  experiment(root, 'A', { 'A.txt': 'A\n' });
  cli(root, ['alpha', 'compose', '--approve-hooks']);
  experiment(root, 'B', { 'B.txt': 'B\n' });

  writeFileSync(checkControl, '7');
  const failedBuild = cli(root, ['alpha', 'compose', '--approve-hooks'], false);
  assert.equal(failedBuild.attempt.status, 'check-failed');
  writeFileSync(checkControl, '0');
  const candidate = cli(root, ['alpha', 'compose', '--approve-hooks']).attempt;
  assert.equal(candidate.status, 'ready');

  writeFileSync(checkControl, '8');
  const failedCheck = cli(root, ['alpha', 'check', '--approve-hooks'], false);
  assert.equal(failedCheck.attempt.id, candidate.id);
  assert.equal(failedCheck.attempt.status, 'check-failed');
  writeFileSync(checkControl, '0');
  const rechecked = cli(root, ['alpha', 'check', '--approve-hooks']).attempt;
  assert.equal(rechecked.id, candidate.id);
  assert.equal(rechecked.status, 'ready');
  assert.equal(cli(root, ['status']).candidate.head, candidate.head);
});

test('composition conflict preserves the last good candidate, main, and source experiments', t => {
  const { root } = fixture(t);
  const main = git(root, 'rev-parse', 'main');
  const A = experiment(root, 'A', { 'shared.txt': 'A owns this line\n' });
  const B = experiment(root, 'B', { 'shared.txt': 'B owns this line\n' });
  const good = cli(root, ['alpha', 'compose', '--ids', 'A', '--approve-hooks']).attempt;
  const conflict = cli(root, ['alpha', 'compose', '--ids', 'A,B', '--approve-hooks'], false);
  assert.equal(conflict.attempt.status, 'conflict');
  assert.ok(existsSync(conflict.attempt.path));
  assert.equal(cli(root, ['status']).candidate.id, good.id);
  assert.equal(cli(root, ['alpha', 'check', '--approve-hooks'], false).code, 'LATEST_COMPOSE_FAILED');
  assert.equal(git(root, 'rev-parse', 'main'), main);
  assert.equal(git(A.path, 'rev-parse', 'HEAD'), A.sha);
  assert.equal(git(B.path, 'rev-parse', 'HEAD'), B.sha);
  assert.equal(git(A.path, 'status', '--porcelain'), '');
  assert.equal(git(B.path, 'status', '--porcelain'), '');
});

test('declared dependencies are pinned and included; incompatible checkpoint selections fail', t => {
  const { root } = fixture(t);
  const A = experiment(root, 'A', { 'A.txt': 'old A\n' });
  experiment(root, 'B', { 'B.txt': 'unrelated B\n' });
  const C = experiment(root, 'C', { 'C.txt': 'depends on old A\n' }, ['A']);
  assert.equal(readFileSync(join(C.path, 'A.txt'), 'utf8'), 'old A\n');
  const plan = cli(root, ['alpha', 'plan', '--ids', 'C']);
  assert.deepEqual(plan.manifest.requested, ['C']);
  assert.deepEqual(plan.manifest.snapshots.map((s: Json) => s.id), ['A', 'C']);
  assert.equal(plan.manifest.snapshots[0].commit, A.sha);
  const hardening = cli(root, ['harden', 'C', '--approve-hooks']).attempt;
  assert.ok(filesAt(root, hardening.head).includes('A.txt'));
  assert.ok(filesAt(root, hardening.head).includes('C.txt'));
  assert.ok(!filesAt(root, hardening.head).includes('B.txt'));

  writeFileSync(join(A.path, 'A.txt'), 'new A\n');
  commit(A.path, 'A changed after C pinned it');
  cli(root, ['experiment', 'checkpoint', 'A', '--description', 'New A', '--acceptance', 'New A works', '--select']);
  const incompatible = cli(root, ['alpha', 'plan'], false);
  assert.equal(incompatible.code, 'DEPENDENCY_VERSION_CONFLICT');
  const pinned = cli(root, ['alpha', 'compose', '--ids', 'C', '--approve-hooks']).attempt;
  assert.equal(readFileSync(join(pinned.path, 'A.txt'), 'utf8'), 'old A\n');
  cli(root, ['experiment', 'discard', 'A']);
  assert.equal(cli(root, ['alpha', 'plan', '--ids', 'C'], false).code, 'DEPENDENCY_DISCARDED');
});

test('dry runs, invalid identifiers, and missing acceptance cannot mutate state or refs', t => {
  const { root } = fixture(t, false);
  const before = git(root, 'show-ref');
  assert.equal(cli(root, ['init', '--dry-run']).dryRun, true);
  assert.equal(existsSync(join(root, '.duet')), false);
  cli(root, ['init']);
  const statePath = join(root, '.duet', 'state.json');
  const initialState = readFileSync(statePath, 'utf8');
  assert.equal(cli(root, ['experiment', 'start', 'planned', '--dry-run']).dryRun, true);
  assert.equal(readFileSync(statePath, 'utf8'), initialState);
  assert.equal(git(root, 'show-ref'), before);
  for (const id of ['../escape', 'a/b', 'x;echo-owned', 'constructor', 'x'.repeat(65)]) {
    assert.equal(cli(root, ['experiment', 'start', id], false).code, 'INVALID_ID');
    assert.equal(readFileSync(statePath, 'utf8'), initialState);
  }
  const started = cli(root, ['experiment', 'start', 'A']);
  writeFileSync(join(started.experiment.path, 'unreviewed.txt'), 'keep me\n');
  const beforeInvalidCheckpoint = readFileSync(statePath, 'utf8');
  const noAcceptance = cli(root, ['experiment', 'checkpoint', 'A', '--description', 'Missing criteria', '--select'], false);
  assert.equal(noAcceptance.code, 'ACCEPTANCE_REQUIRED');
  assert.equal(readFileSync(statePath, 'utf8'), beforeInvalidCheckpoint);
  assert.equal(readFileSync(join(started.experiment.path, 'unreviewed.txt'), 'utf8'), 'keep me\n');
  assert.equal(git(started.experiment.path, 'rev-parse', 'HEAD'), started.experiment.baseCommit);
});

test('approval is required before configured hooks; dry run cannot execute a hook', t => {
  const { root } = fixture(t);
  experiment(root, 'A', { 'A.txt': 'A\n' });
  const deniedCompose = cli(root, ['alpha', 'compose'], false);
  assert.equal(deniedCompose.attempt.status, 'check-failed');
  assert.match(JSON.stringify(deniedCompose.attempt.checks), /HOOK_APPROVAL_REQUIRED/);
  const snapshot = readFileSync(join(root, '.duet', 'state.json'), 'utf8');
  assert.equal(cli(root, ['alpha', 'check', '--approve-hooks', '--dry-run']).dryRun, true);
  assert.equal(readFileSync(join(root, '.duet', 'state.json'), 'utf8'), snapshot);
  const deniedCheck = cli(root, ['alpha', 'check'], false);
  assert.match(JSON.stringify(deniedCheck.attempt.checks), /HOOK_APPROVAL_REQUIRED/);
  assert.equal(cli(root, ['alpha', 'check', '--approve-hooks']).attempt.status, 'ready');
});

test('changed experiment branch and dirty candidate are rejected without losing edits', t => {
  const { root } = fixture(t);
  const A = experiment(root, 'A', { 'A.txt': 'A\n' });
  const alpha = cli(root, ['alpha', 'compose', '--approve-hooks']).attempt;
  git(A.path, 'switch', '-c', 'someone-elses-work');
  writeFileSync(join(A.path, 'keep.txt'), 'private local change\n');
  const changed = cli(root, ['experiment', 'checkpoint', 'A', '--description', 'Wrong branch', '--acceptance', 'No', '--select'], false);
  assert.equal(changed.code, 'BRANCH_CHANGED');
  assert.equal(readFileSync(join(A.path, 'keep.txt'), 'utf8'), 'private local change\n');
  writeFileSync(join(alpha.path, 'dirty.txt'), 'do not delete\n');
  const dirty = cli(root, ['alpha', 'check', '--approve-hooks'], false);
  assert.equal(dirty.code, 'DIRTY_CANDIDATE');
  assert.equal(readFileSync(join(alpha.path, 'dirty.txt'), 'utf8'), 'do not delete\n');
});

test('runtime path symlinks cannot redirect initialization outside the repository', t => {
  const { root, directory } = fixture(t, false);
  const outside = join(directory, 'outside');
  mkdirSync(outside);
  symlinkSync(outside, join(root, '.duet'), 'dir');
  const result = cli(root, ['init'], false);
  assert.match(JSON.stringify(result), /symlink|unsafe/i);
  assert.equal(existsSync(join(outside, 'config.json')), false);
  assert.equal(existsSync(join(outside, 'state.json')), false);
});

test('unknown commands and unsupported flags fail visibly', t => {
  const { root } = fixture(t);
  for (const args of [
    ['production', 'deploy'], ['alpha', 'deploy', '--ids', 'A'], ['status', '--approve-hooks'],
    ['status', '--project', root], ['experiment', 'start', 'A', 'unexpected'], ['alpha', 'compose', '--bogus'],
  ]) assert.equal(cli(root, args, false).ok, false);
});

test('engineering edits require a fresh harden-check before reconciliation', t => {
  const { root } = fixture(t);
  experiment(root, 'A', { 'A.txt': 'prototype A\n' });
  const hardening = cli(root, ['harden', 'A', '--checkpoint', 'cp-1', '--approve-hooks']).attempt;
  writeFileSync(join(hardening.path, 'A.txt'), 'engineered A\n');
  writeFileSync(join(hardening.path, 'A-test.txt'), 'test coverage added during engineering\n');
  assert.equal(cli(root, ['harden-check', 'A', '--approve-hooks'], false).code, 'DIRTY_HARDENING');
  const engineered = commit(hardening.path, 'Engineer and test A');
  git(root, 'merge', '--no-ff', hardening.branch, '-m', 'Reviewed engineered A');
  const merged = git(root, 'rev-parse', 'main');
  assert.equal(cli(root, ['reconcile', 'A', '--merged', merged], false).code, 'CANDIDATE_CHANGED');
  const checked = cli(root, ['harden-check', 'A', '--approve-hooks']).attempt;
  assert.equal(checked.head, engineered);
  assert.equal(checked.status, 'ready');
  assert.equal(cli(root, ['reconcile', 'A', '--merged', merged]).ok, true);
});

test('a stale handoff checkpoint cannot silently harden a newer selection', t => {
  const { root } = fixture(t);
  const A = experiment(root, 'A', { 'A.txt': 'first A\n' });
  const handoff = cli(root, ['handoff', 'A']);
  writeFileSync(join(A.path, 'A.txt'), 'second A\n');
  commit(A.path, 'New A checkpoint');
  cli(root, ['experiment', 'checkpoint', 'A', '--description', 'Second A', '--acceptance', 'Second A works', '--select']);
  const before = readFileSync(join(root, '.duet', 'state.json'), 'utf8');
  const result = cli(root, ['harden', 'A', '--checkpoint', handoff.experiments[0].checkpoint, '--approve-hooks'], false);
  assert.equal(result.code, 'STALE_SELECTION');
  assert.equal(readFileSync(join(root, '.duet', 'state.json'), 'utf8'), before);
});

test('advanced main invalidates a composed candidate until it is recomposed', t => {
  const { root } = fixture(t);
  experiment(root, 'A', { 'A.txt': 'A\n' });
  cli(root, ['alpha', 'compose', '--approve-hooks']);
  writeFileSync(join(root, 'main-update.txt'), 'reviewed main change\n');
  commit(root, 'Advance main after composition');
  assert.equal(cli(root, ['alpha', 'check', '--approve-hooks'], false).code, 'STALE_MAIN');
  const fresh = cli(root, ['alpha', 'compose', '--approve-hooks']).attempt;
  assert.equal(cli(root, ['alpha', 'check', '--approve-hooks']).attempt.head, fresh.head);
});

test('checkpoint secret filename guard rejects risky auto-staging and leaves files untouched', t => {
  const { root } = fixture(t);
  const started = cli(root, ['experiment', 'start', 'A']).experiment;
  writeFileSync(join(started.path, '.env'), 'FAKE_TEST_SECRET=not-a-real-secret\n');
  const before = readFileSync(join(root, '.duet', 'state.json'), 'utf8');
  const result = cli(root, ['experiment', 'checkpoint', 'A', '--description', 'A', '--acceptance', 'A works', '--select'], false);
  assert.equal(result.code, 'POSSIBLE_SECRET_FILES');
  assert.equal(readFileSync(join(root, '.duet', 'state.json'), 'utf8'), before);
  assert.equal(git(started.path, 'diff', '--cached', '--name-only'), '');
  assert.equal(readFileSync(join(started.path, '.env'), 'utf8'), 'FAKE_TEST_SECRET=not-a-real-secret\n');
});

test('separate project roots keep same-named experiments and runtime state isolated', t => {
  const first = fixture(t);
  const second = fixture(t);
  const A1 = experiment(first.root, 'A', { 'first-project.txt': 'first\n' });
  const A2 = experiment(second.root, 'A', { 'second-project.txt': 'second\n' });
  const secondBefore = readFileSync(join(second.root, '.duet', 'state.json'), 'utf8');
  cli(first.root, ['alpha', 'compose', '--approve-hooks']);
  cli(first.root, ['experiment', 'discard', 'A']);
  assert.equal(readFileSync(join(second.root, '.duet', 'state.json'), 'utf8'), secondBefore);
  assert.notEqual(A1.path, A2.path);
  assert.ok(!filesAt(first.root, A1.sha).includes('second-project.txt'));
  assert.ok(!filesAt(second.root, A2.sha).includes('first-project.txt'));
  assert.equal(cli(second.root, ['status']).experiments[0].status, 'active');
});

test('a fresh clone imports only a reviewed fetched handoff and hardens its pinned checkpoint', t => {
  const { root, directory } = fixture(t);
  const A = experiment(root, 'A', { 'A.txt': 'reviewed portable A\n' });
  experiment(root, 'B', { 'B.txt': 'not handed off\n' });
  const report = cli(root, ['handoff', 'A']);
  const reportPath = join(directory, 'reviewed-A.json');
  writeFileSync(reportPath, JSON.stringify(report));
  writeFileSync(join(A.path, 'later-A.txt'), 'not part of the handoff\n');
  commit(A.path, 'Later unselected A work');

  const receiver = join(directory, 'receiving clone');
  git(directory, 'clone', '--no-local', '--single-branch', '--branch', 'main', root, receiver);
  git(receiver, 'config', 'user.name', 'Duet Receiving Test');
  git(receiver, 'config', 'user.email', 'duet-receiver@example.invalid');
  git(receiver, 'config', 'commit.gpgsign', 'false');
  git(receiver, 'config', 'core.hooksPath', '/dev/null');
  assert.ok(existsSync(join(receiver, '.duet', 'config.json')));
  assert.equal(existsSync(join(receiver, '.duet', 'state.json')), false);
  cli(receiver, ['init']);
  const before = readFileSync(join(receiver, '.duet', 'state.json'), 'utf8');
  cli(receiver, ['handoff-import', reportPath], false);
  assert.equal(readFileSync(join(receiver, '.duet', 'state.json'), 'utf8'), before);

  git(receiver, 'fetch', 'origin', `${A.branch}:refs/remotes/origin/${A.branch}`);
  assert.equal(cli(receiver, ['handoff-import', reportPath]).ok, true);
  const importedState = readFileSync(join(receiver, '.duet', 'state.json'), 'utf8');
  assert.equal(cli(receiver, ['handoff-import', reportPath]).ok, true);
  assert.equal(readFileSync(join(receiver, '.duet', 'state.json'), 'utf8'), importedState);
  const imported = cli(receiver, ['status']).experiments;
  assert.deepEqual(imported.map((e: Json) => e.id), ['A']);
  assert.ok(imported[0].path.startsWith(join(realpathSync(receiver), '.duet', 'worktrees')));
  assert.notEqual(imported[0].path, A.path);
  const hardening = cli(receiver, ['harden', 'A', '--checkpoint', A.checkpoint.id, '--approve-hooks']).attempt;
  assert.equal(hardening.manifest.snapshots[0].commit, A.sha);
  assert.ok(filesAt(receiver, hardening.head).includes('A.txt'));
  assert.ok(!filesAt(receiver, hardening.head).includes('B.txt'));
  assert.ok(!filesAt(receiver, hardening.head).includes('later-A.txt'));
  assert.equal(readFileSync(join(A.path, 'later-A.txt'), 'utf8'), 'not part of the handoff\n');

  // Import is a reviewed one-way snapshot, not an implicit synchronization overwrite.
  cli(root, ['experiment', 'checkpoint', 'A', '--description', 'New portable A', '--acceptance', 'Later A reviewed', '--select']);
  writeFileSync(reportPath, JSON.stringify(cli(root, ['handoff', 'A'])));
  const beforeConflict = readFileSync(join(receiver, '.duet', 'state.json'), 'utf8');
  assert.equal(cli(receiver, ['handoff-import', reportPath], false).code, 'HANDOFF_CONFLICT');
  assert.equal(readFileSync(join(receiver, '.duet', 'state.json'), 'utf8'), beforeConflict);
});

test('handoff import rejects mismatched project identity and altered pinned manifests without state writes', t => {
  const { root, directory } = fixture(t);
  experiment(root, 'A', { 'A.txt': 'A\n' });
  const report = cli(root, ['handoff', 'A']);
  const file = join(directory, 'tampered-handoff.json');
  const before = readFileSync(join(root, '.duet', 'state.json'), 'utf8');
  const mismatch = structuredClone(report);
  mismatch.projectId = 'another-project';
  writeFileSync(file, JSON.stringify(mismatch));
  cli(root, ['handoff-import', file], false);
  assert.equal(readFileSync(join(root, '.duet', 'state.json'), 'utf8'), before);
  const altered = structuredClone(report);
  altered.manifest.snapshots[0].commit = git(root, 'rev-parse', 'main');
  writeFileSync(file, JSON.stringify(altered));
  cli(root, ['handoff-import', file], false);
  assert.equal(readFileSync(join(root, '.duet', 'state.json'), 'utf8'), before);
});

test('a dependency pinned to an older checkpoint is not silently treated as a newer merged checkpoint', t => {
  const { root } = fixture(t);
  const A = experiment(root, 'A', { 'A.txt': 'A checkpoint one\n' });
  experiment(root, 'C', { 'C.txt': 'depends on A checkpoint one\n' }, ['A']);
  writeFileSync(join(A.path, 'A.txt'), 'A checkpoint two\n');
  commit(A.path, 'Second A checkpoint');
  cli(root, ['experiment', 'checkpoint', 'A', '--description', 'Second A', '--acceptance', 'Second A works', '--select']);
  const hardening = cli(root, ['harden', 'A', '--checkpoint', 'cp-2', '--approve-hooks']).attempt;
  git(root, 'merge', '--no-ff', hardening.branch, '-m', 'Reviewed second A');
  const reconciled = cli(root, ['reconcile', 'A', '--merged', git(root, 'rev-parse', 'main')]);
  assert.equal(reconciled.nextPlan.error.code, 'DEPENDENCY_VERSION_MERGED');
  assert.equal(cli(root, ['alpha', 'plan', '--ids', 'C'], false).code, 'DEPENDENCY_VERSION_MERGED');
});

test('persistent CLI routing fails closed and status needs no coordinator', t => {
  const { root, directory } = fixture(t, false);
  assert.equal(cli(root, ['alpha', 'deployment-status']).state, 'no-local-request');
  assert.equal(existsSync(join(root, '.duet')), false);
  mkdirSync(join(root, '.duet'));
  const path = join(root, '.duet', 'alpha.json');
  writeFileSync(path, '{ fixture-content-must-not-leak');
  const invalid = cli(root, ['alpha', 'deploy', '--sha', 'a'.repeat(40), '--approve-deploy'], false);
  assert.match(invalid.error, /Invalid persistent Alpha configuration JSON/);
  assert.doesNotMatch(invalid.error, /fixture-content-must-not-leak/);
  assert.match(cli(root, ['alpha', 'deploy', '--approve-hooks'], false).error, /not arbitrary deploy hooks/);
  rmSync(path);
  symlinkSync(join(directory, 'missing-config'), path);
  assert.match(cli(root, ['alpha', 'deploy', '--approve-hooks'], false).error, /not arbitrary deploy hooks/);
  assert.match(cli(root, ['alpha', 'deploy', '--sha', 'a'.repeat(40), '--approve-deploy'], false).error, /Unsafe persistent Alpha path/);
  rmSync(path);
  writeFileSync(path, JSON.stringify({ version:1, mode:'persistent', provider:'github-actions', repository:'example/app', branch:'integration/alpha', checkWorkflow:'check.yml', deployWorkflow:'deploy-alpha.yml', dataPolicy:'retain', operation:'deploy-code' }));
  assert.match(cli(root, ['alpha', 'deploy', '--sha', 'a'.repeat(40)], false).error, /DEPLOY_APPROVAL_REQUIRED/);
  assert.equal(existsSync(join(root, '.duet', 'alpha-deployments')), false);
});
