/** Fetch remote refs without touching local branches, the index or working files. */
export type FreshnessConfig = { mainBranch: string; mainRemote?: string; mainRemoteBranch?: string };
type Run = (args: string[], cwd?: string) => { status: number | null; stdout: Buffer };
export class FreshnessError extends Error {
  code: string;
  details: unknown;
  constructor(code: string, message: string, details?: unknown) { super(message); this.code = code; this.details = details; }
}
export function inspectFreshness(root: string, config: FreshnessConfig, run: Run) {
  const read = (args: string[]) => {
    const result = run(args, root);
    if (result.status !== 0) throw new FreshnessError('FRESHNESS_GIT_FAILED', 'Cannot inspect Git freshness.', { operation: args[0] });
    return result.stdout.toString('utf8').trim();
  };
  const optional = (args: string[]) => {
    const result = run(args, root);
    if (result.status === 1) return '';
    if (result.status !== 0) throw new FreshnessError('FRESHNESS_GIT_FAILED', 'Cannot read branch tracking configuration.');
    return result.stdout.toString('utf8').trim();
  };
  const setting = (key: string) => optional(['config', '--get', key]);
  for (const key of ['mainBranch', 'mainRemote', 'mainRemoteBranch'] as const) {
    const value = config[key];
    if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.startsWith('-'))) throw new FreshnessError('INVALID_CONFIG', `Invalid ${key}.`);
  }
  const remotes = read(['remote']).split('\n').filter(Boolean);
  const localResult = run(['rev-parse', '--verify', `refs/heads/${config.mainBranch}^{commit}`], root);
  const localMain = localResult.status === 0 ? localResult.stdout.toString('utf8').trim() : null;
  const head = read(['rev-parse', '--verify', 'HEAD']);
  const branch = optional(['symbolic-ref', '--quiet', '--short', 'HEAD']) || null;
  const dirty = !!read(['status', '--porcelain=v1', '--untracked-files=all']);
  const mainTrackingRemote = setting(`branch.${config.mainBranch}.remote`);
  const mainTrackingRef = setting(`branch.${config.mainBranch}.merge`);
  const remote = config.mainRemote ?? (mainTrackingRemote && mainTrackingRemote !== '.' ? mainTrackingRemote : remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : undefined);
  const remoteBranch = config.mainRemoteBranch ?? ((!config.mainRemote || config.mainRemote === mainTrackingRemote) && mainTrackingRef.startsWith('refs/heads/') ? mainTrackingRef.slice(11) : config.mainBranch);
  if (config.mainRemoteBranch && !config.mainRemote) throw new FreshnessError('MAIN_REMOTE_REQUIRED', 'mainRemoteBranch requires an explicit mainRemote.');
  if (!remote && remotes.length) throw new FreshnessError('REMOTE_AMBIGUOUS', 'Set mainRemote (and mainRemoteBranch if different); multiple remotes have no unambiguous main upstream.');
  const fetched: string[] = [];
  const fetch = (name: string) => {
    if (!remotes.includes(name) || name.startsWith('-') || run(['check-ref-format', `refs/remotes/${name}/duet-check`], root).status !== 0) throw new FreshnessError('REMOTE_MISSING', `Configured remote ${name} is unavailable; freshness is unknown.`);
    if (fetched.includes(name)) return;
    const result = run(['fetch', '--no-tags', '--prune', name, `+refs/heads/*:refs/remotes/${name}/*`], root);
    if (result.status !== 0) throw new FreshnessError('FETCH_FAILED', `Fetch failed for remote ${name}; freshness is unknown. Check access/network and retry. Local work is preserved.`);
    fetched.push(name);
  };
  const relation = (local: string, target: string) => {
    const [ahead, behind] = read(['rev-list', '--left-right', '--count', `${local}...${target}`]).split(/\s+/).map(Number);
    return { ahead, behind, state: ahead && behind ? 'diverged' : behind ? 'behind' : ahead ? 'ahead' : 'equal' };
  };
  const resolveRemote = (name: string, ref: string) => {
    if (!ref.startsWith('refs/heads/') || run(['check-ref-format', ref], root).status !== 0) throw new FreshnessError('UPSTREAM_INVALID', 'Expected an upstream branch under refs/heads/.');
    const result = run(['rev-parse', '--verify', `refs/remotes/${name}/${ref.slice(11)}^{commit}`], root);
    return result.status === 0 ? result.stdout.toString('utf8').trim() : null;
  };
  let mainCommit = localMain;
  if (remote) {
    fetch(remote);
    const resolved = resolveRemote(remote, `refs/heads/${remoteBranch}`);
    if (!resolved) throw new FreshnessError('REMOTE_MAIN_MISSING', `Remote main ${remote}/${remoteBranch} does not exist; not synchronized.`);
    mainCommit = resolved;
  }
  if (!mainCommit) throw new FreshnessError('LOCAL_MAIN_MISSING', 'No remote and no local main ref: name the intended main or configure its remote; freshness is unknown.');
  let upstream: { remote: string; branch: string; commit: string | null; state: string; ahead?: number; behind?: number } | null = null;
  if (branch) {
    const trackingRemote = setting(`branch.${branch}.remote`);
    const trackingRef = setting(`branch.${branch}.merge`);
    if (!!trackingRemote !== !!trackingRef) throw new FreshnessError('UPSTREAM_INVALID', 'Branch upstream configuration is incomplete.');
    if (trackingRemote && trackingRef) {
      let commit: string | null;
      if (trackingRemote === '.') {
        if (!trackingRef.startsWith('refs/heads/')) throw new FreshnessError('UPSTREAM_INVALID', 'Expected a local upstream branch.');
        const result = run(['rev-parse', '--verify', `${trackingRef}^{commit}`], root);
        commit = result.status === 0 ? result.stdout.toString('utf8').trim() : null;
      } else { fetch(trackingRemote); commit = resolveRemote(trackingRemote, trackingRef); }
      upstream = { remote: trackingRemote, branch: trackingRef, commit, ...(commit ? relation(head, commit) : { state: 'missing' }) };
    } else if (remote) {
      const commit = resolveRemote(remote, `refs/heads/${branch}`);
      upstream = { remote, branch: `refs/heads/${branch}`, commit, ...(commit ? relation(head, commit) : { state: 'unpublished' }) };
    }
  }
  const base = run(['merge-base', head, mainCommit], root);
  const suoChanged = base.status === 0 ? read(['diff', '--name-only', base.stdout.toString('utf8').trim(), mainCommit, '--', 'suo']).split('\n').filter(Boolean) : [];
  const blockers = upstream && ['behind', 'diverged', 'missing'].includes(upstream.state) ? [`Current branch upstream is ${upstream.state}; inspect and integrate its remote work before editing. No pull/rebase was performed.`] : [];
  return { ok: blockers.length === 0, mode: remote ? 'remote-verified' : 'local-only', checkedAt: new Date().toISOString(), fetched, head, branch, dirty,
    main: { localBranch: config.mainBranch, localCommit: localMain, remote: remote ?? null, remoteBranch: remote ? remoteBranch : null, commit: mainCommit, local: localMain ? relation(localMain, mainCommit) : {ahead: 0, behind: 0, state: 'missing'}, current: relation(head, mainCommit), suoChanged },
    upstream, blockers, notice: remote ? 'Verified fetched refs at checkedAt, not a permanent freshness guarantee. Main/Suo drift requires review; no local branch or files were changed.' : 'No remote configured: local-only evidence, not proof of remote freshness. Detached/local fixtures remain supported.' };
}
export type Freshness = ReturnType<typeof inspectFreshness>;
