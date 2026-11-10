import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Engine } from '../src/engine.ts';

function git(root: string, ...args: string[]) {
  const r = spawnSync('git', ['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-c','user.name=Test','-c','user.email=test@example.invalid',...args], {cwd:root,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr); return r.stdout.trim();
}
function commit(root: string, file: string, text: string) {
  writeFileSync(join(root,file),text); git(root,'add',file); git(root,'commit','-m',file); return git(root,'rev-parse','HEAD');
}
function fixture(t: any) {
  const dir=mkdtempSync(join(tmpdir(),'duet-fresh-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const remote=join(dir,'remote.git'), a=join(dir,'a'), b=join(dir,'b');
  git(dir,'init','--bare','--initial-branch=main',remote); git(dir,'clone',remote,a);
  commit(a,'base.txt','base\n');
  const engine=new Engine(a,{runChecks:()=>({ok:true})});
  engine.init({projectId:'fresh',hooks:{checks:[{argv:['node','--version']}],envAllow:[]}});
  git(a,'add','.');git(a,'commit','-m','config');git(a,'push','-u','origin','main');git(dir,'clone',remote,b);
  return {dir,remote,a,b,engine};
}
const code=(name:string)=>(e:any)=>e.code===name;

test('remote main advances: fresh baseline leaves occupied dirty local main untouched; repeat is stable',t=>{
  const {a,b,engine}=fixture(t); const local=git(a,'rev-parse','main');
  mkdirSync(join(b,'suo')); const remote=commit(b,'suo/product.suo.ts','remote product\n');git(b,'push');
  writeFileSync(join(a,'draft.txt'),'keep me');
  const first=engine.freshness(),second=engine.freshness();
  assert.equal(first.main.commit,remote);assert.equal(first.main.local.state,'behind');assert.equal(first.ok,false);
  assert.deepEqual(first.main.suoChanged,['suo/product.suo.ts']);assert.deepEqual(second.main,first.main);
  const start=engine.start('A');assert.equal(start.experiment.mainCommit,remote);assert.equal(start.freshness.mode,'remote-verified');
  assert.equal(git(a,'rev-parse','main'),local);assert.equal(readFileSync(join(a,'draft.txt'),'utf8'),'keep me');
  writeFileSync(join(start.experiment.path,'feature.txt'),'feature');engine.checkpoint('A',{select:true,description:'A',acceptance:['A works']});
  const harden=engine.harden('A');assert.equal(harden.attempt.manifest.mainCommit,remote);
  assert.equal(engine.composeAlpha(['A']).attempt.manifest.mainCommit,remote);
});

test('local main ahead or diverged is diagnosed, never silently discarded for remote baseline',t=>{
  const {a,b,engine}=fixture(t);commit(a,'local.txt','local');
  assert.equal(engine.freshness().main.local.state,'ahead');assert.throws(()=>engine.start('A'),code('LOCAL_MAIN_UNPUBLISHED'));
  commit(b,'remote.txt','remote');git(b,'push');
  assert.equal(engine.freshness().main.local.state,'diverged');assert.throws(()=>engine.harden('missing'),code('EXPERIMENT_NOT_FOUND'));
  assert.throws(()=>engine.start('B'),code('LOCAL_MAIN_UNPUBLISHED'));assert.equal(readFileSync(join(a,'local.txt'),'utf8'),'local');
});

test('resume checks shared experiment upstream; dirty drafts survive missing/incoming/diverged branches',t=>{
  const {a,b,engine}=fixture(t);const {experiment}=engine.start('A');
  commit(experiment.path,'a.txt','A');git(experiment.path,'push','-u','origin',experiment.branch);
  git(b,'fetch','origin');git(b,'switch','--track',`origin/${experiment.branch}`);commit(b,'friend.txt','friend');git(b,'push');
  writeFileSync(join(experiment.path,'draft.txt'),'uncommitted');
  const resume=engine.resume('A');assert.equal(resume.ok,false);assert.equal(resume.upstream?.state,'behind');assert.equal(resume.dirty,true);
  assert.throws(()=>engine.checkpoint('A',{description:'A'}),code('BRANCH_OUTDATED'));
  assert.throws(()=>engine.harden('A'),code('BRANCH_OUTDATED'));
  commit(experiment.path,'own.txt','mine');assert.equal(engine.resume('A').upstream?.state,'diverged');
  git(b,'push','origin','--delete',experiment.branch);assert.equal(engine.resume('A').upstream?.state,'missing');
  assert.equal(readFileSync(join(experiment.path,'draft.txt'),'utf8'),'uncommitted');
});

test('separate main and branch upstream remotes, renamed upstreams and unpublished branches',t=>{
  const {dir,a,b,engine}=fixture(t);const other=join(dir,'other.git');git(dir,'clone','--bare',join(dir,'remote.git'),other);
  git(a,'remote','add','collab',other);git(a,'switch','-c','feature');commit(a,'feature.txt','local');git(a,'push','-u','collab','HEAD:shared');
  const writer=join(dir,'writer');git(dir,'clone',other,writer);git(writer,'switch','shared');commit(writer,'shared.txt','new');git(writer,'push');
  const report=engine.freshness();assert.deepEqual(report.fetched,['origin','collab']);assert.equal(report.upstream?.branch,'refs/heads/shared');assert.equal(report.upstream?.state,'behind');
  git(a,'switch','--no-track','-c','unpublished','main');assert.equal(engine.freshness().upstream?.state,'unpublished');
  // An explicit main remote does not borrow another remote's differently named main upstream.
  git(b,'branch','renamed');git(b,'push','origin','renamed');git(a,'fetch','origin');git(a,'branch','--set-upstream-to=origin/renamed','main');
  assert.equal(engine.freshness({mainRemote:'collab'}).main.remoteBranch,'main');
});

test('fetch failure and absent remote main never claim freshness or create worktrees',t=>{
  const {dir,a,b,engine}=fixture(t);git(a,'remote','set-url','origin',join(dir,'missing.git'));
  assert.throws(()=>engine.freshness(),code('FETCH_FAILED'));assert.throws(()=>engine.start('A'),code('FETCH_FAILED'));
  git(a,'remote','set-url','origin',join(dir,'remote.git'));
  assert.throws(()=>engine.freshness({mainRemote:'origin',mainRemoteBranch:'absent'}),code('REMOTE_MAIN_MISSING'));
  assert.throws(()=>engine.freshness({mainRemote:'not-configured'}),code('REMOTE_MISSING'));
  assert.equal(engine.status().experiments.length,0);
});

test('hardening readiness rechecks main; main drift on resume is reported without rebuilding experiments',t=>{
  const {a,b,engine}=fixture(t);const {experiment}=engine.start('A');commit(experiment.path,'feature.txt','A');engine.checkpoint('A',{select:true,description:'A',acceptance:['works']});
  const harden=engine.harden('A');const baseline=experiment.baseCommit;
  commit(b,'newmain.txt','new');git(b,'push');
  const resume=engine.resume('A');assert.equal(resume.ok,true);assert.equal(resume.main.current.behind,1);assert.equal(resume.recordedBase,baseline);
  assert.throws(()=>engine.hardenCheck('A'),code('STALE_MAIN'));
  git(harden.attempt.path,'merge','origin/main','--no-edit');assert.equal(engine.hardenCheck('A').ok,true);
});

test('no-remote detached fixtures are explicit local-only; existing config with vanished remote fails',t=>{
  const {a,engine}=fixture(t);git(a,'remote','remove','origin');git(a,'switch','--detach');
  const report=engine.freshness();assert.equal(report.mode,'local-only');assert.equal(report.branch,null);assert.equal(report.ok,true);
  assert.equal(engine.start('local').freshness.mode,'local-only');
  const config=JSON.parse(readFileSync(join(a,'.duet/config.json'),'utf8'));config.mainRemote='origin';writeFileSync(join(a,'.duet/config.json'),JSON.stringify(config));
  assert.throws(()=>engine.freshness(),code('REMOTE_MISSING'));
});

test('standalone CLI freshness and resume expose failures; dry-run does not fetch or initialize',t=>{
  const {dir,a,b,engine}=fixture(t);
  const cli=(root:string,args:string[])=>spawnSync(process.execPath,[new URL('../src/cli.ts',import.meta.url).pathname,'--project',root,...args],{encoding:'utf8'});
  const {experiment}=engine.start('A');const resumed=cli(a,['experiment','resume','A']);assert.equal(resumed.status,0,resumed.stderr);assert.equal(JSON.parse(resumed.stdout).path,experiment.path);
  rmSync(join(b,'.duet/config.json'));
  const ordinary=cli(b,['freshness','--main','main','--remote','origin']);assert.equal(ordinary.status,0,ordinary.stderr);assert.equal(JSON.parse(ordinary.stdout).mode,'remote-verified');
  git(b,'remote','set-url','origin',join(dir,'offline.git'));
  const dry=cli(b,['freshness','--dry-run']);assert.equal(dry.status,0,dry.stderr);assert.equal(JSON.parse(dry.stdout).dryRun,true);
  const failed=cli(b,['freshness']);assert.equal(failed.status,1);assert.equal(JSON.parse(failed.stderr).code,'FETCH_FAILED');
});

test('feature-only clone checks remote main without creating local main; ambiguous remotes require selection',t=>{
  const {dir,a,remote}=fixture(t);git(a,'switch','-c','feature');commit(a,'feature.txt','feature');git(a,'push','-u','origin','feature');
  const single=join(dir,'single');git(dir,'clone','--single-branch','--branch','feature',remote,single);
  const e=new Engine(single);const report=e.freshness();assert.equal(report.mode,'remote-verified');assert.equal(report.main.local.state,'missing');assert.equal(report.upstream?.state,'equal');
  assert.equal(spawnSync('git',['rev-parse','--verify','refs/heads/main'],{cwd:single}).status,128);
  git(single,'remote','rename','origin','one');git(single,'branch','--unset-upstream');git(single,'remote','add','two',remote);
  assert.throws(()=>e.freshness(),code('REMOTE_AMBIGUOUS'));assert.equal(e.freshness({mainRemote:'two'}).main.remote,'two');
});
