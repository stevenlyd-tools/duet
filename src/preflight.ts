import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHooks } from './hooks.ts';

/** Project-owned validators run against a detached exact-SHA worktree, never
 * against ambient uncommitted deployment inputs. This is not a sandbox. */
export function projectPreflight(root: string, sha: string, approved = false, dryRun = false) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Preflight requires a full commit SHA.');
  const git = (args: string[]) => {
    const r = spawnSync('git', ['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',...args], {cwd:root,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
    if (r.status !== 0 || r.error) throw new Error('Preflight Git read/worktree operation failed; verify the pinned commit is available.');
    return r.stdout.trim();
  };
  if (git(['rev-parse',`${sha}^{commit}`]) !== sha) throw new Error('Preflight SHA must identify a commit.');
  const config = JSON.parse(git(['show',`${sha}:.duet/preflight.json`]));
  if (config.version !== 1 || !Array.isArray(config.checks) || !config.checks.length || Object.keys(config).some(k=>!['version','checks'].includes(k))) throw new Error('Invalid project preflight: expected version 1 and nonempty checks.');
  if (dryRun) return {ok:true,sha,state:'not-run',checks:config.checks,notice:'Review pinned commands before --approve-hooks. Checks do not authorize deployment.'};
  if (!approved) throw new Error('HOOK_APPROVAL_REQUIRED: review pinned project preflight commands and use --approve-hooks within existing authorization.');
  const drivers = spawnSync('git',['config','--get-regexp','^(filter\\..*\\.(clean|smudge|process)|merge\\..*\\.driver)$'],{cwd:root,encoding:'utf8'});
  if (drivers.status !== 1) throw new Error('External Git drivers must be absent in a reviewed isolated clone before preflight.');
  const directory = mkdtempSync(join(tmpdir(),'duet-preflight-'));
  const cwd = join(directory,'checkout');
  let added = false;
  try {
    git(['worktree','add','--detach',cwd,sha]); added = true;
    const result = makeHooks(root,true).runChecks({cwd,manifest:{sha},config:{hooks:{checks:config.checks}}});
    if (!result.ok) throw new Error('Project preflight failed; no deployment dispatch sent.');
    return {...result,sha,state:'passed',notice:'Project validators passed for pinned inputs; provider must revalidate at execution.'};
  } finally {
    if (added) git(['worktree','remove','--force',cwd]);
    rmSync(directory,{recursive:true,force:true});
  }
}
