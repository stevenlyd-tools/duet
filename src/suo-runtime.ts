import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Where a project that pins Suo as a dependency has its installed runtime. */
export function projectSuoRuntime(root: string): string | null {
 const cli = join(resolve(root), 'node_modules/@stevenlyd/suo/dist/cli.js');
 return existsSync(cli) ? cli : null;
}

/** Points at the project's installed runtime, when there is one, without selecting it. */
export function suoRuntimeHint(root: string, selected?: string): string {
 const local = projectSuoRuntime(root);
 return local && (!selected || resolve(selected) !== local) ? ` This project has an installed Suo runtime at ${local}; pass it if it matches the loaded Suo Skill.` : '';
}

/** Runs the explicitly selected Suo CLI. A Skill or plugin install carries Suo's compiled
 * dist/ without its npm dependencies, so selecting it fails with a Node module error; that
 * case is reported as a selection mistake with the fix instead of a stack trace. */
export function runSuo(root: string, cli: string, args: string[], options: { timeout: number; maxBuffer: number }): string {
 try {
  return execFileSync(process.execPath, [resolve(cli), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
 } catch (error) {
  const stderr = String((error as { stderr?: unknown }).stderr ?? '');
  const missing = /ERR_MODULE_NOT_FOUND[\s\S]*?Cannot find package '([^']+)'|Cannot find package '([^']+)'[\s\S]*?ERR_MODULE_NOT_FOUND/.exec(stderr);
  if (missing) throw new Error(`Selected Suo CLI ${cli} cannot load its dependency "${missing[1] ?? missing[2]}". A Skill or plugin install contains Suo's dist/ without node_modules and cannot run; select an installed Suo runtime instead (the project's pinned dependency or a separate runtime install, see Suo's docs/distribution.md).${suoRuntimeHint(root, cli)}`);
  throw error;
 }
}
