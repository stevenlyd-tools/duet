import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, MARKETPLACE, checkDistribution, checkRelease, expectedDistribution, newerVersion } from '../scripts/distribution.ts';

const read = (path: string) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
function fixture(t: any) {
  const root = mkdtempSync(join(tmpdir(), 'duet-distribution-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ['package.json', 'skills', 'src', 'plugin.json', '.claude-plugin', 'gemini-extension.json', 'distribution-lock.json']) {
    cpSync(join(ROOT, path), join(root, path), { recursive: true });
  }
  return root;
}
function generate(root: string) {
  for (const [path, content] of Object.entries(expectedDistribution(root))) writeFileSync(join(root, path), content);
}

test('committed native metadata and content hashes are current', () => {
  assert.doesNotThrow(() => checkDistribution());
});

test('native manifests expose one canonical skill tree and no permission or executable components', () => {
  const portable = read('plugin.json');
  // Structural contract from Agent Plugins 1.0; no remote schema fetch in CI.
  assert.equal(portable.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.match(portable.name, /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
  assert.ok(portable.name.length <= 64);
  assert.deepEqual(Object.keys(portable).sort(), ['$schema', 'author', 'description', 'name', 'repository', 'version']);
  assert.equal(portable.repository, 'https://github.com/stevenlyd-tools/duet');
  assert.equal(read('.claude-plugin/plugin.json').skills, './skills/');
  assert.deepEqual(Object.keys(read('gemini-extension.json')).sort(), ['description', 'name', 'version']);
  assert.deepEqual(read('package.json').pi, { skills: ['./skills'] });
  for (const path of ['plugin.json', '.claude-plugin/plugin.json', 'gemini-extension.json']) {
    assert.equal(read(path).version, read('package.json').version);
    assert.equal(read(path).name, 'duet');
  }
  assert.match(readFileSync(join(ROOT, 'skills/duet/SKILL.md'), 'utf8'), /^---\nname: duet\n/);
  assert.ok(readFileSync(join(ROOT, 'skills/duet/references/boundaries.md'), 'utf8').length > 0);
  for (const path of ['mcp.json', '.mcp.json', '.app.json', 'hooks', 'hooks.json', '.codex/config.toml', '.claude/settings.json', 'GEMINI.md', 'extensions']) {
    assert.equal(existsSync(join(ROOT, path)), false, `Unexpected executable/settings surface: ${path}`);
  }
});

test('the package ships no marketplace of its own; the stevenlyd-tools catalog lists it', () => {
  assert.equal(MARKETPLACE, 'stevenlyd-tools');
  for (const path of ['.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json']) assert.equal(existsSync(join(ROOT, path)), false, path);
  assert.deepEqual(Object.keys(expectedDistribution()).filter(path => path.includes('marketplace')), []);
});

test('changed skill, CLI, Pi metadata and stale generated manifests fail validation', t => {
  for (const path of ['skills/duet/SKILL.md', 'src/cli.ts', 'plugin.json']) {
    const root = fixture(t);
    writeFileSync(join(root, path), readFileSync(join(root, path), 'utf8') + '\n');
    assert.throws(() => checkDistribution(root), /Stale distribution file/);
  }
  const root = fixture(t);
  const pkg = read('package.json');
  pkg.pi.skills = ['./another-directory'];
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
  assert.throws(() => checkDistribution(root), /Stale distribution file/);
});

test('release gate requires a version increase for changed shipped content, not identical payload', t => {
  const root = fixture(t);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' } }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Duet Test'); git('config', 'user.email', 'duet@example.invalid');
  git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'baseline');
  const base = git('rev-parse', 'HEAD');
  assert.doesNotThrow(() => checkRelease(base, root));
  writeFileSync(join(root, 'skills/duet/SKILL.md'), readFileSync(join(root, 'skills/duet/SKILL.md'), 'utf8') + '\nChanged skill\n');
  generate(root);
  assert.throws(() => checkRelease(base, root), /without a version increase/);
  const pkg = read('package.json'); pkg.version = pkg.version.split('.').map((v: string, i: number) => i === 2 ? Number(v) + 1 : v).join('.');
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg)); generate(root);
  assert.doesNotThrow(() => checkRelease(base, root));
  assert.throws(() => checkRelease('--help', root), /full Git SHA/);
});

test('stable versions compare numerically and reject non-release or malformed values', () => {
  assert.equal(newerVersion('0.10.0', '0.9.0'), true);
  for (const version of ['0.2.0', '0.1.9', '0.2.1-beta', '01.3.0', 'garbage']) {
    assert.equal(newerVersion(version, '0.2.0'), false);
  }
});
