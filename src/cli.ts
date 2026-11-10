#!/usr/bin/env node
import {readFileSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import {suoCompletion} from './completion.ts';
import {deliveryReceipt} from './delivery.ts';
import {diagnostics} from './diagnostics.ts';
import {Engine} from './engine.ts';
import {makeHooks} from './hooks.ts';
import {issueCompletion} from './issue-completion.ts';
import {observeManifest} from './manifest.ts';
import {PersistentAlpha} from './persistent-alpha.ts';
import {projectPreflight} from './preflight.ts';

const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const usage = `Duet v${version} (Node >=22.18)
Usage: duet --project PATH COMMAND [options]
  init [--main main] [--remote NAME] [--remote-main BRANCH] [--project-id NAME]
  status
  doctor
  freshness [--main main] [--remote NAME] [--remote-main BRANCH]
  experiment start ID [--depends a,b]
  experiment resume ID
  experiment checkpoint ID --description TEXT --acceptance TEXT [--select]
  experiment select ID [--checkpoint CP_ID]
  experiment discard ID
  alpha plan|compose|check [--ids a,c] [--approve-hooks]
  alpha deploy --sha FULL_SHA [--approve-deploy] [--retry] [--dry-run]
  alpha deployment-status
  handoff ID
  handoff-import FILE
  harden ID [--checkpoint CP_ID] [--approve-hooks]
  harden-check ID [--approve-hooks]
  reconcile ID [--merged SHA]
  completion --suo-cli PATH --sha FULL_SHA --ids UNIT_IDS
  manifest URL --component NAME --sha FULL_SHA
  preflight --sha FULL_SHA [--approve-hooks] [--dry-run]
  issue-completion FILE
  receipt FILE
Options: --dry-run (no mutations), --approve-hooks (review configured commands first).
The Duet skill workflow also supports ordinary Git and project CI/CD; CLI initialization is optional.
freshness and experiment resume fetch refs (no local branch/file edits); no init needed for freshness.
Read-only local records: status, alpha plan, handoff ID (require existing coordinator state).
init, experiment, compose/check, harden, import and reconcile mutate local state/Git; checks run reviewed hooks.
alpha deploy dispatches the project's own GitHub Actions workflow declared in .duet/alpha.json. No reset/import operation is supported.
status reads local coordinator receipts; alpha deployment-status queries correlated GitHub workflow results, not live health.
Staging/production use project CI/CD with actual gates and exact SHA.
Roles and instruction files are guidance, not authentication.`;

const booleanFlags = new Set(['help', 'dry-run', 'approve-hooks', 'approve-deploy', 'retry', 'select']);
const valueFlags = new Set(['project', 'main', 'remote', 'remote-main', 'project-id', 'depends', 'description', 'acceptance', 'checkpoint', 'ids', 'merged', 'sha', 'suo-cli', 'component']);
const subcommands: Record<string, string[]> = {
  experiment: ['start', 'resume', 'checkpoint', 'select', 'discard'],
  alpha: ['plan', 'compose', 'check', 'deploy', 'deployment-status'],
};
/** Flags each command accepts, besides the global --project, --dry-run and --help. */
const allowedFlags: Record<string, string[]> = {
  init: ['main', 'remote', 'remote-main', 'project-id'],
  status: [],
  doctor: [],
  freshness: ['main', 'remote', 'remote-main'],
  'experiment start': ['depends'],
  'experiment resume': [],
  'experiment checkpoint': ['description', 'acceptance', 'select'],
  'experiment select': ['checkpoint'],
  'experiment discard': [],
  'alpha plan': ['ids'],
  'alpha compose': ['ids', 'approve-hooks'],
  'alpha check': ['approve-hooks'],
  'alpha deploy': ['approve-hooks', 'sha', 'approve-deploy', 'retry'],
  'alpha deployment-status': [],
  handoff: [],
  'handoff-import': [],
  harden: ['approve-hooks', 'checkpoint'],
  'harden-check': ['approve-hooks'],
  reconcile: ['merged'],
  completion: ['suo-cli', 'sha', 'ids'],
  manifest: ['component', 'sha'],
  preflight: ['sha', 'approve-hooks'],
  'issue-completion': [],
  receipt: [],
};
/** Highest number of positional arguments, counting the command itself. */
const positionalLimits: Record<string, number> = {
  init: 1, status: 1, doctor: 1, freshness: 1, experiment: 3, alpha: 2, handoff: 2, 'handoff-import': 2,
  harden: 2, 'harden-check': 2, reconcile: 2, completion: 1, manifest: 2, preflight: 1, 'issue-completion': 2, receipt: 2,
};

function readJson(path: string, limitBytes: number, label: string): unknown {
  if (statSync(path).size > limitBytes) throw new Error(`${label} exceeds ${limitBytes / 1024 / 1024} MiB.`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

try {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const key = arg.slice(2);
    if (key in flags) throw new Error(`Duplicate flag: --${key}`);
    if (booleanFlags.has(key)) flags[key] = true;
    else if (valueFlags.has(key) && args[i + 1] && !args[i + 1].startsWith('--')) flags[key] = args[++i];
    else throw new Error(`Unknown flag or missing value: ${arg}`);
  }
  if (flags.help || !positional.length) { console.log(usage); process.exit(0); }

  const [command, sub, arg] = positional;
  const commandKey = command in subcommands ? `${command} ${sub}` : command;
  if (!(commandKey in allowedFlags)) throw new Error(`Unknown command: ${positional.join(' ')}`);
  if (positional.length > positionalLimits[command]) throw new Error('Unexpected positional arguments. See --help.');
  for (const key of Object.keys(flags)) {
    if (!['project', 'dry-run', 'help', ...allowedFlags[commandKey]].includes(key)) throw new Error(`Flag --${key} is not valid for ${commandKey}.`);
  }

  const root = resolve(String(flags.project ?? process.cwd()));
  const dryRun = flags['dry-run'] === true;
  const approvedHooks = flags['approve-hooks'] === true;
  let instance: Engine | undefined;
  const engine = () => instance ??= new Engine(root, makeHooks(root, approvedHooks));
  const text = (key: string) => typeof flags[key] === 'string' ? String(flags[key]) : undefined;
  const list = (key: string) => text(key)?.split(',').map(item => item.trim()).filter(Boolean);
  const required = (value: string | undefined, what = 'An experiment ID') => { if (!value) throw new Error(`${what} is required.`); return value; };
  const mainOptions = () => ({
    ...(text('main') ? {mainBranch: text('main')} : {}),
    ...(text('remote') ? {mainRemote: text('remote')} : {}),
    ...(text('remote-main') ? {mainRemoteBranch: text('remote-main')} : {}),
  });

  let result: unknown;
  if (command === 'doctor') result = diagnostics(root);
  else if (command === 'completion') {
    result = suoCompletion(root, required(text('suo-cli'), 'The installed Suo CLI (--suo-cli PATH)'), text('sha') ?? '', list('ids') ?? []);
  } else if (command === 'manifest') {
    result = dryRun
      ? {dryRun: true, endpoint: sub, component: flags.component, sha: flags.sha}
      : await observeManifest(required(sub, 'A manifest URL'), {component: text('component') ?? '', revision: text('sha') ?? ''});
  } else if (command === 'preflight') result = projectPreflight(root, text('sha') ?? '', approvedHooks, dryRun);
  else if (command === 'issue-completion') result = issueCompletion(readJson(resolve(required(sub, 'An input file')), 8 * 1024 * 1024, 'Issue assessment'));
  else if (command === 'receipt') result = deliveryReceipt(readJson(resolve(required(sub, 'An input file')), 1024 * 1024, 'Receipt input'));
  else if (commandKey === 'alpha deployment-status') result = new PersistentAlpha(root).status();
  else if (commandKey === 'alpha deploy') {
    if (approvedHooks && !text('sha')) throw new Error('Alpha deployment requires pinned validation, not arbitrary deploy hooks.');
    const alpha = new PersistentAlpha(root);
    if (approvedHooks && !alpha.config().preflight) throw new Error('Alpha deployment uses configured validation, not arbitrary deploy hooks; set preflight: true to require pinned project validators.');
    result = alpha.deploy({sha: text('sha') ?? '', approved: flags['approve-deploy'] === true, dryRun, retry: flags.retry === true, approvedHooks});
  } else if (dryRun && command !== 'status' && commandKey !== 'alpha plan') {
    result = {
      dryRun: true, project: root, command: positional, options: flags,
      notice: 'No hooks, Git changes, or state writes performed. Execute without --dry-run after reviewing.',
      ...(command === 'alpha' ? {plan: engine().planAlpha(list('ids'))} : {}),
    };
  } else if (command === 'init') result = engine().init({mainBranch: 'main', ...mainOptions(), ...(text('project-id') ? {projectId: text('project-id')} : {})});
  else if (command === 'freshness') result = engine().freshness(mainOptions());
  else if (command === 'status') result = engine().status();
  else if (commandKey === 'experiment start') result = engine().start(required(arg), {dependsOn: list('depends')});
  else if (commandKey === 'experiment resume') result = engine().resume(required(arg));
  else if (commandKey === 'experiment checkpoint') result = engine().checkpoint(required(arg), {select: flags.select === true, description: text('description'), acceptance: text('acceptance')});
  else if (commandKey === 'experiment select') result = engine().select(required(arg), text('checkpoint'));
  else if (commandKey === 'experiment discard') result = engine().discard(required(arg));
  else if (commandKey === 'alpha plan') result = engine().planAlpha(list('ids'));
  else if (commandKey === 'alpha compose') result = engine().composeAlpha(list('ids'));
  else if (commandKey === 'alpha check') result = engine().checkAlpha();
  else if (command === 'handoff') result = engine().handoff(required(sub));
  else if (command === 'handoff-import') result = engine().importHandoff(readJson(resolve(required(sub, 'A handoff file')), 1024 * 1024, 'Handoff file'));
  else if (command === 'harden') result = engine().harden(required(sub), {checkpoint: text('checkpoint')});
  else if (command === 'harden-check') result = engine().hardenCheck(required(sub));
  else if (command === 'reconcile') result = engine().reconcile(required(sub), {mergedCommit: text('merged')});

  console.log(JSON.stringify(result, null, 2));
  if ((result as {ok?: boolean} | undefined)?.ok === false) process.exitCode = 1;
} catch (error) {
  const failure = error as {message?: string; code?: unknown; details?: unknown};
  console.error(JSON.stringify({ok: false, error: error instanceof Error ? error.message : String(error), code: failure?.code, details: failure?.details}, null, 2));
  process.exitCode = 1;
}
