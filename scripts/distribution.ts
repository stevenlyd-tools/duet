import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
const schema = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const repository = 'https://github.com/stevenlyd/duet';
export const MARKETPLACE = 'stevenlyd-duet';
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
export function validVersion(version: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version);
}
export function newerVersion(next: string, before: string): boolean {
  if (!validVersion(next) || !validVersion(before)) return false;
  const a = next.split('.').map(BigInt), b = before.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** Metadata only: all hosts read the same skills/ tree; no generated skill copies. */
export function manifests(pkg: { version: string; description: string }): Record<string, string> {
  if (!validVersion(pkg.version)) throw new Error('Use a stable MAJOR.MINOR.PATCH release version');
  const common = { name: 'duet', version: pkg.version, description: pkg.description };
  const author = { name: 'Steven Liu' };
  return {
    'plugin.json': json({ $schema: schema, ...common, author, repository }),
    '.claude-plugin/plugin.json': json({ ...common, author, repository, skills: './skills/' }),
    '.claude-plugin/marketplace.json': json({ name: MARKETPLACE, owner: author,
      plugins: [{ name: 'duet', source: './', version: pkg.version, description: pkg.description }] }),
    '.agents/plugins/marketplace.json': json({ name: MARKETPLACE,
      interface: { displayName: 'Duet' }, plugins: [{ name: 'duet',
        source: { source: 'local', path: './' },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] }),
    'gemini-extension.json': json(common),
  };
}

export function sourceFiles(root: string, directory = 'skills'): string[] {
  const files: string[] = [];
  function walk(path: string) {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const next = `${path}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`No symlinks in distributed source: ${next}`);
      if (entry.isDirectory()) walk(next);
      else if (entry.isFile()) files.push(next);
      else throw new Error(`Not a regular source file: ${next}`);
    }
  }
  walk(directory);
  return files;
}

export function expectedDistribution(root = ROOT): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const files = manifests(pkg);
  const skillPath = 'skills/duet/SKILL.md';
  const skill = readFileSync(join(root, skillPath), 'utf8');
  if (!/^---\nname: duet\nmetadata:\n  version: "[^"\n]+"\n/.test(skill)) throw new Error('Duet Skill needs a metadata.version string');
  files[skillPath] = skill.replace(/^(---\nname: duet\nmetadata:\n  version: ")[^"\n]+/, `$1${pkg.version}`);
  const hashes: Record<string, string> = {};
  for (const path of [...Object.keys(files), ...sourceFiles(root), ...sourceFiles(root, 'src')].sort()) {
    hashes[path] = createHash('sha256').update(files[path] ?? readFileSync(join(root, path))).digest('hex');
  }
  // Include Pi's discovery contract without coupling to developer scripts.
  hashes['package.json#pi'] = createHash('sha256').update(json(pkg.pi)).digest('hex');
  return { ...files, 'distribution-lock.json': json({ version: pkg.version, files: hashes }) };
}

export function checkDistribution(root = ROOT): void {
  for (const [path, expected] of Object.entries(expectedDistribution(root))) {
    if (readFileSync(join(root, path), 'utf8') !== expected) throw new Error(`Stale distribution file: ${path}; run npm run distribution:generate`);
  }
}

/** Release payload changes need a newer version; docs/tests alone do not. */
export function checkRelease(base: string, root = ROOT): void {
  if (!/^[0-9a-f]{40}$/.test(base)) throw new Error('Release base must be a full Git SHA');
  const gitRead = (path: string) => execFileSync('git', ['show', `${base}:${path}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const oldPackage = JSON.parse(gitRead('package.json'));
  const next = JSON.parse(readFileSync(join(root, 'distribution-lock.json'), 'utf8'));
  let before: string | undefined;
  try { before = gitRead('distribution-lock.json'); }
  catch {
    // Distinguish first distribution release from an invalid/inaccessible base.
    execFileSync('git', ['cat-file', '-e', `${base}^{commit}`], { cwd: root, stdio: 'pipe' });
  }
  if (before !== json(next) && !newerVersion(next.version, oldPackage.version)) {
    throw new Error(`Distribution changed without a version increase (${oldPackage.version} -> ${next.version})`);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === '--write' && args.length === 1) {
      // Explicit maintainer command, confined to fixed metadata paths in this checkout.
      for (const [path, content] of Object.entries(expectedDistribution())) {
        const full = join(ROOT, path);
        for (const parent of [dirname(full), full]) {
          try { if (lstatSync(parent).isSymbolicLink()) throw new Error(`Refusing symlink: ${parent}`); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content);
      }
      console.log('Generated distribution metadata; no host installations changed.');
    } else if (args[0] === '--check' && (args.length === 1 || (args.length === 3 && args[1] === '--base'))) {
      checkDistribution();
      if (args[2]) checkRelease(args[2]);
      console.log('Distribution metadata and release checks passed.');
    } else throw new Error('Usage: distribution.ts --write | --check [--base FULL_SHA]');
  } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
