import { projectPreflight } from './preflight.ts';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, realpathSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, constants } from 'node:fs';
import { join, resolve } from 'node:path';

export type AlphaConfig = {
  version: 1; mode: 'persistent'; provider: 'github-actions'; repository: string;
  branch: string; checkWorkflow: string; deployWorkflow: string;
  dataPolicy: 'retain'; operation: 'deploy-code';
  preflight?: boolean;
};
type Run = { id: number; run_attempt: number; head_sha: string; head_branch: string; path: string;
  event: string; status: string; conclusion: string | null; display_title: string;
  repository: { full_name: string }; head_repository: { full_name: string } };
export type Api = (method: 'GET' | 'POST', path: string, body?: unknown) => any;
type Request = { id: string; sha: string; config: AlphaConfig; configDigest: string; createdAt: string; submitted: boolean };
const configKeys = ['version','mode','provider','repository','branch','checkWorkflow','deployWorkflow','dataPolicy','operation'].sort();
const shaPattern = /^[a-f0-9]{40}$/;

/** Fixed API transport, never an arbitrary deployment hook. Credentials stay with gh. */
export const githubApi: Api = (method, path, body) => {
  const args = ['api','--hostname','github.com','--method',method,path];
  if (body !== undefined) args.push('--input','-');
  const result = spawnSync('gh', args, { input: body === undefined ? undefined : JSON.stringify(body), encoding:'utf8', timeout:30000, maxBuffer:4*1024*1024 });
  // Do not emit API bodies/stderr, which may contain private provider diagnostics.
  if (result.error || result.status !== 0) throw new Error(`GitHub ${method} request failed or timed out; outcome may be uncertain. Verify gh installation/access without exposing credentials.`);
  if (!result.stdout.trim()) return null;
  try { return JSON.parse(result.stdout); } catch { throw new Error('GitHub returned an unreadable response; verify the outcome before retrying.'); }
};

function parseJson(text: string, label: string): any { try { return JSON.parse(text); } catch { throw new Error(`Invalid ${label} JSON; content omitted to protect private configuration.`); } }
function validateConfig(value: any): AlphaConfig {
  if (!value || JSON.stringify(Object.keys(value).filter(k => k !== 'preflight').sort()) !== JSON.stringify(configKeys) ||
      (value.preflight !== undefined && typeof value.preflight !== 'boolean') ||
      value.version !== 1 || value.mode !== 'persistent' || value.provider !== 'github-actions' ||
      value.dataPolicy !== 'retain' || value.operation !== 'deploy-code' ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository ?? '') ||
      value.repository.split('/').some((part: string) => /^\.+$/.test(part)) ||
      typeof value.branch !== 'string' || !value.branch || value.branch.startsWith('-') ||
      spawnSync('git',['check-ref-format',`refs/heads/${value.branch}`]).status !== 0 ||
      ![value.checkWorkflow,value.deployWorkflow].every(v => typeof v === 'string' && /^[A-Za-z0-9_-]+\.ya?ml$/.test(v)) ||
      value.checkWorkflow === value.deployWorkflow) throw new Error('Invalid .duet/alpha.json: use the explicit persistent GitHub Actions retain/deploy-code contract, with no extra inputs or credentials.');
  return value;
}
function digest(config: AlphaConfig) { return createHash('sha256').update(JSON.stringify([...configKeys.map(k => [k,(config as any)[k]]), ...(config.preflight === undefined ? [] : [['preflight',config.preflight]])])).digest('hex'); }
function safe(root: string, relative: string) {
  let path = root;
  for (const part of relative.split('/')) {
    path = join(path,part);
    if (!existsSync(path)) {
      try { lstatSync(path); } catch (error) { if ((error as any).code === 'ENOENT') continue; throw error; }
    }
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) throw new Error(`Unsafe persistent Alpha path: ${relative}`);
  }
  return path;
}
function atomic(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd,JSON.stringify(value,null,2)+'\n'); fsyncSync(fd); } finally { closeSync(fd); }
  try { renameSync(temp,path); const directory = openSync(resolve(path,'..'),constants.O_RDONLY); try { fsyncSync(directory); } finally { closeSync(directory); } } finally { if (existsSync(temp)) unlinkSync(temp); }
}
export class PersistentAlpha {
  root: string; api: Api;
  constructor(root: string, api: Api = githubApi) { this.root = realpathSync(resolve(root)); this.api = api; }
  config() { return validateConfig(parseJson(readFileSync(safe(this.root,'.duet/alpha.json'),'utf8'),'persistent Alpha configuration')); }
  private request(): Request | undefined {
    const path = safe(this.root,'.duet/alpha-deployments/request.json');
    if (!existsSync(path)) return undefined;
    const r = parseJson(readFileSync(path,'utf8'),'persistent Alpha receipt');
    validateConfig(r.config);
    if (!/^[0-9a-f-]{36}$/.test(r.id ?? '') || !shaPattern.test(r.sha ?? '') || r.configDigest !== digest(r.config) || typeof r.submitted !== 'boolean' || !Number.isFinite(Date.parse(r.createdAt))) throw new Error('Invalid persistent Alpha request receipt; do not discard an uncertain request.');
    return r;
  }
  private base(c: AlphaConfig) { return `repos/${c.repository}`; }
  private verifyRun(run: Run, c: AlphaConfig, sha: string, workflow: string, event: string) {
    if (!run || !Number.isSafeInteger(run.id) || run.id < 1 || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1 ||
        run.repository?.full_name !== c.repository || run.head_repository?.full_name !== c.repository ||
        run.head_sha !== sha || run.head_branch !== c.branch || run.path !== `.github/workflows/${workflow}` || run.event !== event) throw new Error('Provider run identity does not match the pinned repository/branch/SHA/workflow/event.');
  }
  private preflight(c: AlphaConfig, sha: string) {
    const branchHead = () => this.api('GET',`${this.base(c)}/git/ref/heads/${encodeURIComponent(c.branch)}`)?.object?.sha;
    if (branchHead() !== sha) throw new Error('Configured branch is not at the expected SHA; no dispatch sent.');
    const list = this.api('GET',`${this.base(c)}/actions/workflows/${c.checkWorkflow}/runs?branch=${encodeURIComponent(c.branch)}&event=push&head_sha=${sha}&per_page=100&page=1`);
    if (!Array.isArray(list?.workflow_runs) || !Number.isSafeInteger(list.total_count) || list.total_count !== list.workflow_runs.length || list.workflow_runs.length === 0 || list.total_count > 100) throw new Error('Latest push Check is missing or query coverage is incomplete; no dispatch sent.');
    const latest = [...list.workflow_runs].sort((a,b) => b.id-a.id)[0];
    this.verifyRun(latest,c,sha,c.checkWorkflow,'push');
    const current = this.api('GET',`${this.base(c)}/actions/runs/${latest.id}`);
    this.verifyRun(current,c,sha,c.checkWorkflow,'push');
    if (current.id !== latest.id || current.run_attempt < latest.run_attempt) throw new Error('Check run identity/attempt changed unexpectedly; no dispatch sent.');
    if (current.status !== 'completed' || current.conclusion !== 'success') throw new Error('Latest same-SHA push Check has not succeeded; no dispatch sent.');
    if (branchHead() !== sha) throw new Error('Branch moved during preflight; no dispatch sent.');
    return { checkRunId: current.id, checkRunAttempt: current.run_attempt };
  }
  private observe(r: Request) {
    const c = r.config; const matches: Run[] = [];
    let complete = false;
    for (let page=1;page<=10;page++) {
      const list = this.api('GET',`${this.base(c)}/actions/workflows/${c.deployWorkflow}/runs?branch=${encodeURIComponent(c.branch)}&event=workflow_dispatch&per_page=100&page=${page}`);
      if (!Array.isArray(list?.workflow_runs)) throw new Error('Deployment lookup unavailable; this is not an empty queue.');
      matches.push(...list.workflow_runs.filter((run: Run) => run.display_title === `Duet Alpha ${r.id}`));
      if (list.workflow_runs.length < 100) { complete = true; break; }
    }
    if (!complete) throw new Error('Deployment lookup incomplete after 1000 runs; do not redispatch an uncertain request.');
    if (matches.length > 1) throw new Error('Multiple deployment runs match this request; investigate before any new dispatch.');
    if (!matches.length) return { state:'uncertain' as const, requestId:r.id, sha:r.sha, message:'No correlated run visible yet; dispatch may have executed. Do not retry or delete the receipt.' };
    this.verifyRun(matches[0],c,r.sha,c.deployWorkflow,'workflow_dispatch');
    const run: Run = this.api('GET',`${this.base(c)}/actions/runs/${matches[0].id}`);
    this.verifyRun(run,c,r.sha,c.deployWorkflow,'workflow_dispatch');
    if (run.id !== matches[0].id || run.run_attempt < matches[0].run_attempt || run.display_title !== `Duet Alpha ${r.id}`) throw new Error('Deployment correlation changed; do not redispatch.');
    return { state:run.status === 'completed' ? (run.conclusion === 'success' ? 'succeeded' as const : 'failed' as const) : 'pending' as const,
      requestId:r.id,sha:r.sha,runId:run.id,runAttempt:run.run_attempt,conclusion:run.conclusion,
      url:`https://github.com/${c.repository}/actions/runs/${run.id}`,
      evidence:'Correlated workflow result only; release artifact contents and live health are not independently verified by this CLI.' };
  }
  status() {
    const r = this.request();
    if (!r) return { ok:true,state:'no-local-request',message:'No local persistent deployment receipt; remote Alpha deployment state has not been queried.' };
    const result = this.observe(r);
    return { ok:result.state !== 'failed' && result.state !== 'uncertain',...result };
  }
  deploy(options: { sha: string; approved?: boolean; dryRun?: boolean; retry?: boolean; approvedHooks?: boolean }) {
    if (!shaPattern.test(options.sha ?? '')) throw new Error('Persistent Alpha requires --sha with a full lowercase 40-character commit SHA.');
    const c = this.config();
    if (options.dryRun) return { ok:true,dryRun:true,mode:'persistent',sha:options.sha,...this.preflight(c,options.sha),...(c.preflight ? {projectPreflight:projectPreflight(this.root,options.sha,false,true)} : {}),message:'Read-only preflight; no dispatch or local state writes. The workflow must revalidate SHA/CI at execution.' };
    if (!options.approved) throw new Error('DEPLOY_APPROVAL_REQUIRED: use --approve-deploy only within applicable existing authorization and actual host/upstream permissions.');
    const directory = safe(this.root,'.duet/alpha-deployments');
    const isIgnored = (path: string) => spawnSync('git',['check-ignore','--quiet','--no-index',path],{cwd:this.root}).status === 0;
    const ignored = ['request.json','lock'].every(name => isIgnored(`.duet/alpha-deployments/${name}`));
    const tracked = spawnSync('git',['ls-files','--','.duet/alpha-deployments'],{cwd:this.root,encoding:'utf8'});
    if (!ignored || tracked.status !== 0 || tracked.stdout.trim()) throw new Error('Ignore /.duet/alpha-deployments/ and keep its receipts untracked before publishing. Do not delete existing receipts.');
    mkdirSync(directory,{recursive:true});
    const lock = safe(this.root,'.duet/alpha-deployments/lock');
    let fd: number;
    try { fd = openSync(lock,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600); }
    catch { throw new Error('Persistent Alpha operation is locked; inspect the owning process, do not automatically remove its lock.'); }
    try {
      const previous = this.request();
      if (previous) {
        const result = this.observe(previous);
        if (result.state === 'pending' || result.state === 'uncertain') return { ok:false,...result };
        if (previous.configDigest === digest(c) && previous.sha === options.sha && result.state === 'succeeded') return { ok:true,unchanged:true,...result };
        if (result.state === 'failed' && !options.retry) return { ok:false,...result,message:'Prior run failed; inspect migration/provider outcome before explicitly using --retry. Failure does not imply rollback.' };
      }
      const validation = c.preflight ? projectPreflight(this.root,options.sha,options.approvedHooks) : {state:'not-configured'};
      const checks = {...this.preflight(c,options.sha),projectPreflight:validation};
      const r: Request = { id:randomUUID(),sha:options.sha,config:c,configDigest:digest(c),createdAt:new Date().toISOString(),submitted:false };
      if (!isIgnored(`.duet/alpha-deployments/${r.id}.json`)) throw new Error('Request archive is not ignored; no dispatch sent.');
      // Durable intent precedes the request: crashes/errors cannot safely imply no dispatch.
      atomic(safe(this.root,`.duet/alpha-deployments/${r.id}.json`),r);
      atomic(safe(this.root,'.duet/alpha-deployments/request.json'),r);
      try {
        this.api('POST',`${this.base(c)}/actions/workflows/${c.deployWorkflow}/dispatches`,{ref:c.branch,inputs:{expected_sha:r.sha,duet_request_id:r.id}});
      } catch {
        return { ok:false,state:'uncertain',requestId:r.id,sha:r.sha,message:'Dispatch failed or timed out after intent was recorded; it may have executed. Use alpha deployment-status, never blindly retry.' };
      }
      r.submitted = true;
      atomic(safe(this.root,`.duet/alpha-deployments/${r.id}.json`),r);
      atomic(safe(this.root,'.duet/alpha-deployments/request.json'),r);
      return { ok:true,state:'submitted',requestId:r.id,sha:r.sha,...checks,message:'Dispatch accepted, not deployment success. Use alpha deployment-status to observe the correlated run.' };
    } finally { closeSync(fd); unlinkSync(lock); }
  }
}
