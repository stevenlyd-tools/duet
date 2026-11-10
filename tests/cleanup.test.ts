import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const reference = readFileSync(new URL('../skills/duet/references/cleanup.md', import.meta.url), 'utf8');
// Packaging checks test the delivered contract, not autonomous agent judgment.
test('skill ships cleanup guidance with its safety boundaries', () => {
  const skill = readFileSync(new URL('../skills/duet/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /references\/cleanup.md/);
  for (const boundary of ['all open PRs', 'unpublished unique work', 'integration/alpha',
    'repository-protected branches', 'ignored files', 'current session cannot safely leave',
    'durable handoff', 'permanent loss', 'uncertain push outcome', 'refs/duet/checkpoints/*']) {
    assert.ok(reference.includes(boundary), boundary);
  }
});

function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'duet-cleanup-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const fails = (...args: string[]) => assert.notEqual(spawnSync('git', args, { cwd: root }).status, 0);
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, 'file'), 'base\n'); git('add', '.'); git('commit', '-m', 'base');
  return { root, git, fails };
}

test('squash completion can remove branch with original history preserved and local tip races refused', t => {
  const { root, git, fails } = fixture(t);
  git('switch', '-c', 'task'); writeFileSync(join(root, 'file'), 'selected\n'); git('commit', '-am', 'selected');
  const tip = git('rev-parse', 'HEAD');
  git('switch', 'main'); git('merge', '--squash', 'task'); git('commit', '-m', 'squash');
  fails('merge-base', '--is-ancestor', tip, 'main');
  const archive = `refs/duet/archive/${tip}`;
  git('update-ref', archive, tip, '0'.repeat(tip.length));
  git('update-ref', '-d', 'refs/heads/task', tip);
  fails('show-ref', '--verify', 'refs/heads/task');
  git('gc', '--prune=now');
  assert.equal(git('show', `${archive}:file`), 'selected');
  git('branch', 'task', 'main');
  fails('update-ref', '-d', 'refs/heads/task', tip);
  assert.equal(git('rev-parse', 'task'), git('rev-parse', 'main'));
});

test('remote deletion lease rejects a moved tip and accepts only the expected ref', t => {
  const { root, git, fails } = fixture(t);
  const remote = join(root, 'remote.git'); git('init', '--bare', remote); git('remote', 'add', 'origin', remote);
  git('push', 'origin', 'main:refs/heads/task'); const old = git('rev-parse', 'main');
  writeFileSync(join(root, 'file'), 'new remote work\n'); git('commit', '-am', 'new');
  const next = git('rev-parse', 'main'); git('push', 'origin', 'main:refs/heads/task');
  fails('push', `--force-with-lease=refs/heads/task:${old}`, 'origin', ':refs/heads/task');
  assert.ok(git('ls-remote', '--heads', 'origin', 'refs/heads/task').startsWith(next));
  git('push', `--force-with-lease=refs/heads/task:${next}`, 'origin', ':refs/heads/task');
  assert.equal(git('ls-remote', '--heads', 'origin', 'refs/heads/task'), '');
});

test('non-force worktree removal preserves untracked work', t => {
  const { root, git, fails } = fixture(t);
  const worktree = join(root, 'temporary'); git('worktree', 'add', '-b', 'task', worktree);
  writeFileSync(join(worktree, 'untracked'), 'keep me');
  fails('worktree', 'remove', worktree);
  assert.equal(readFileSync(join(worktree, 'untracked'), 'utf8'), 'keep me');
  assert.ok(git('worktree', 'list', '--porcelain').includes(worktree));
});
