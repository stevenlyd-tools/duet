import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Engine, DuetError } from '../src/engine.ts';

function git(root:string,...args:string[]) {
  const p=spawnSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-c','user.name=Test','-c','user.email=test@example.invalid',...args],{cwd:root,encoding:'utf8'});
  assert.equal(p.status,0,p.stderr); return p.stdout.trim();
}
function fixture(t:any, options:any={}) {
  const root=mkdtempSync(join(tmpdir(),'duet-engine-')); t.after(()=>rmSync(root,{recursive:true,force:true}));
  git(root,'init','-b','main'); writeFileSync(join(root,'base.txt'),'base\n'); git(root,'add','.'); git(root,'commit','-m','base');
  const engine=new Engine(root,{runChecks:()=>({ok:true}),...options});
  engine.init({projectId:'test',hooks:{checks:[{argv:['node','--version']}],envAllow:[]}});
  git(root,'add','.'); git(root,'commit','-m','duet configuration');
  return {root,engine};
}
function selected(engine:Engine,id:string,file=`${id}.txt`,contents=`${id}\n`,deps?:string[]) {
  const {experiment}=engine.start(id,{dependsOn:deps}); writeFileSync(join(experiment.path,file),contents);
  const result=engine.checkpoint(id,{select:true,description:`Implement ${id}`,acceptance:[`${id} works`]}); return {...result,experiment};
}
function throwsCode(action:()=>unknown,code:string) {assert.throws(action,(error:any)=>error instanceof DuetError&&error.code===code);}

test('A keep, B discard, C continue: alpha and hardening are isolated and reconcile rebuilds main',t=>{
  const {root,engine}=fixture(t); const main=git(root,'rev-parse','main');
  selected(engine,'A'); selected(engine,'B'); const c=selected(engine,'C');
  writeFileSync(join(c.experiment.path,'draft.txt'),'uncheckpointed');
  const first=engine.composeAlpha(); assert.equal(first.ok,true); assert.equal(first.attempt.manifest.mainCommit,main);
  assert.equal(existsSync(join(first.attempt.path,'draft.txt')),false);
  engine.discard('B'); const second=engine.composeAlpha(); assert.equal(second.ok,true); assert.equal(existsSync(join(second.attempt.path,'B.txt')),false);
  const harden=engine.harden('A'); assert.equal(harden.ok,true); assert.equal(existsSync(join(harden.attempt.path,'A.txt')),true);
  assert.equal(existsSync(join(harden.attempt.path,'B.txt')),false); assert.equal(existsSync(join(harden.attempt.path,'C.txt')),false);
  git(root,'merge','--ff-only',harden.attempt.branch!); assert.equal(engine.reconcile('A').ok,true);
  const final=engine.composeAlpha(); assert.equal(final.ok,true); assert.equal(existsSync(join(final.attempt.path,'A.txt')),true); assert.equal(existsSync(join(final.attempt.path,'C.txt')),true); assert.equal(existsSync(join(final.attempt.path,'B.txt')),false);
  assert.equal(readFileSync(join(c.experiment.path,'draft.txt'),'utf8'),'uncheckpointed');
});

test('plans and handoffs are read-only and selected snapshots stay pinned after work advances',t=>{
  const {root,engine}=fixture(t); const a=selected(engine,'A');
  const before=readFileSync(join(root,'.duet/state.json'),'utf8'); const refs=git(root,'show-ref');
  const plan=engine.planAlpha(); const handoff=engine.handoff('A'); assert.equal(plan.manifest.snapshots[0].commit,a.checkpoint.commit); assert.equal(handoff.manifest.key,plan.manifest.key);
  assert.equal(readFileSync(join(root,'.duet/state.json'),'utf8'),before); assert.equal(git(root,'show-ref'),refs);
  writeFileSync(join(a.experiment.path,'A.txt'),'later\n'); engine.checkpoint('A',{description:'later',acceptance:['later']});
  const candidate=engine.composeAlpha(); assert.equal(readFileSync(join(candidate.attempt.path,'A.txt'),'utf8'),'A\n');
  assert.equal(git(root,'rev-parse','refs/duet/checkpoints/A/cp-1'),a.checkpoint.commit);
});

test('explicit dependency deltas are imported exactly once and unrelated selection is excluded',t=>{
  const {engine}=fixture(t); selected(engine,'A'); const c=selected(engine,'C','C.txt','C\n',['A']); selected(engine,'B');
  assert.equal(readFileSync(join(c.experiment.path,'A.txt'),'utf8'),'A\n');
  const harden=engine.harden('C'); assert.equal(harden.ok,true); assert.deepEqual(harden.attempt.manifest.snapshots.map(s=>s.id),['A','C']);
  assert.equal(existsSync(join(harden.attempt.path,'B.txt')),false);
  engine.discard('A'); throwsCode(()=>engine.planAlpha(['C']),'DEPENDENCY_DISCARDED');
});

test('conflict and failed checks never replace the last good candidate or allow a stale check',t=>{
  let checks=true;const {engine}=fixture(t,{runChecks:()=>({ok:checks})}); selected(engine,'A','base.txt','A\n');
  const good=engine.composeAlpha(['A']); assert.equal(good.ok,true); assert.equal(good.attempt.status,'ready');
  selected(engine,'B','base.txt','B\n'); const conflict=engine.composeAlpha(['A','B']); assert.equal(conflict.ok,false); assert.equal(conflict.attempt.status,'conflict');
  assert.equal(engine.status().candidate?.id,good.attempt.id); throwsCode(()=>engine.checkAlpha(),'LATEST_COMPOSE_FAILED');
  checks=false; const failed=engine.composeAlpha(['A']); assert.equal(failed.attempt.status,'check-failed'); assert.equal(engine.checkAlpha().ok,false);
  checks=true; const retried=engine.checkAlpha(); assert.equal(retried.ok,true); assert.equal(retried.attempt.status,'ready');
});

test('same pinned manifest composes deterministic heads',t=>{
  const {engine}=fixture(t); selected(engine,'A');
  const a=engine.composeAlpha(); const b=engine.composeAlpha(); assert.equal(a.attempt.head,b.attempt.head); assert.equal(a.attempt.manifest.key,b.attempt.manifest.key);
});

test('hardening engineering commits require final checks and squash merge content proof',t=>{
  const {root,engine}=fixture(t);selected(engine,'A'); const harden=engine.harden('A');
  writeFileSync(join(harden.attempt.path,'A.txt'),'hardened\n');git(harden.attempt.path,'add','.');git(harden.attempt.path,'commit','-m','engineering fixes');
  git(root,'merge','--squash',harden.attempt.branch!);git(root,'commit','-m','squash A');
  throwsCode(()=>engine.reconcile('A'),'CANDIDATE_CHANGED');
  const final=engine.hardenCheck('A'); assert.equal(final.ok,true); assert.equal(engine.reconcile('A').ok,true);
});

test('unsafe IDs, dirty candidates, secrets, external filters, and dangling metadata symlinks fail safely',t=>{
  const {root,engine}=fixture(t); throwsCode(()=>engine.start('../escape'),'INVALID_ID');
  const {experiment}=engine.start('A');writeFileSync(join(experiment.path,'.env'),'SECRET=not-real');
  throwsCode(()=>engine.checkpoint('A',{description:'A',acceptance:['A'],select:true}),'POSSIBLE_SECRET_FILES');
  rmSync(join(experiment.path,'.env'));writeFileSync(join(experiment.path,'A.txt'),'A');engine.checkpoint('A',{description:'A',acceptance:['A'],select:true});
  const candidate=engine.composeAlpha();writeFileSync(join(candidate.attempt.path,'dirty.txt'),'dirty');throwsCode(()=>engine.checkAlpha(),'DIRTY_CANDIDATE');
  git(root,'config','filter.untrusted.clean','touch /tmp/duet-should-not-run');throwsCode(()=>engine.start('B'),'UNSUPPORTED_GIT_FILTER');
  const other=mkdtempSync(join(tmpdir(),'duet-symlink-'));t.after(()=>rmSync(other,{recursive:true,force:true}));git(other,'init','-b','main');symlinkSync(join(other,'missing'),join(other,'.duet'));throwsCode(()=>new Engine(other),'UNSAFE_PATH');
});

test('project locks prevent concurrent mutations and do not block read-only plans',t=>{
  const {root,engine}=fixture(t);selected(engine,'A');writeFileSync(join(root,'.duet/lock'),'test owner');
  throwsCode(()=>engine.start('B'),'PROJECT_LOCKED');assert.equal(engine.planAlpha().ok,true);assert.equal(readFileSync(join(root,'.duet/lock'),'utf8'),'test owner');
});

test('fresh clones initialize runtime but lost state with local refs refuses reset',t=>{
  const {root,engine}=fixture(t);const cloned=mkdtempSync(join(tmpdir(),'duet-clone-'));t.after(()=>rmSync(cloned,{recursive:true,force:true}));
  git(cloned,'clone',root,'.');const remoteEngine=new Engine(cloned);const result=remoteEngine.init();assert.equal(result.initialized,true);assert.equal(result.runtimeOnly,true);assert.deepEqual(remoteEngine.status().experiments,[]);
  selected(engine,'A');rmSync(join(root,'.duet/state.json'));throwsCode(()=>engine.init(),'STATE_MISSING');
});

test('main movement invalidates a composed candidate until it is recomposed',t=>{
  const {root,engine}=fixture(t);selected(engine,'A');engine.composeAlpha();
  writeFileSync(join(root,'main-update.txt'),'update');git(root,'add','.');git(root,'commit','-m','main update');throwsCode(()=>engine.checkAlpha(),'STALE_MAIN');
  assert.equal(engine.composeAlpha().ok,true);assert.equal(engine.checkAlpha().ok,true);
});

test('dependency versions and cycles are rejected without mutating state',t=>{
  const {root,engine}=fixture(t);const a=selected(engine,'A');selected(engine,'C','C.txt','C',['A']);
  writeFileSync(join(a.experiment.path,'A.txt'),'v2');engine.checkpoint('A',{select:true,description:'A v2',acceptance:['v2']});
  throwsCode(()=>engine.planAlpha(['A','C']),'DEPENDENCY_VERSION_CONFLICT');
  const statePath=join(root,'.duet/state.json');const state=JSON.parse(readFileSync(statePath,'utf8'));state.experiments.A.checkpoints[0].dependencies=[{id:'C',checkpoint:'cp-1'}];writeFileSync(statePath,JSON.stringify(state));
  throwsCode(()=>engine.planAlpha(['C']),'DEPENDENCY_CYCLE');
});

test('configured Git filters are refused during read-only status and checkpoint diff',t=>{
  const {root,engine}=fixture(t);const a=selected(engine,'A');const marker=join(root,'filter-ran');
  git(root,'config','filter.evil.clean',`touch ${marker}`);writeFileSync(join(a.experiment.path,'.gitattributes'),'*.txt filter=evil\n');writeFileSync(join(a.experiment.path,'A.txt'),'changed');
  throwsCode(()=>engine.status(),'UNSUPPORTED_GIT_FILTER');throwsCode(()=>engine.checkpoint('A'),'UNSUPPORTED_GIT_FILTER');assert.equal(existsSync(marker),false);
});

test('checks mutating source fail and an unchecked descendant cannot reconcile',t=>{
  let mutate=false;const {root,engine}=fixture(t,{runChecks:(ctx:any)=>{if(mutate)writeFileSync(join(ctx.cwd,'mutated.txt'),'unexpected');return {ok:true};}});selected(engine,'A');mutate=true;
  const failed=engine.composeAlpha();assert.equal(failed.ok,false);assert.equal(failed.attempt.status,'check-failed');mutate=false;
  const harden=engine.harden('A');git(root,'merge','--ff-only',harden.attempt.branch!);writeFileSync(join(root,'A.txt'),'unchecked edit');git(root,'add','.');git(root,'commit','-m','unchecked change');
  throwsCode(()=>engine.reconcile('A'),'MERGE_UNVERIFIED');
  assert.equal(engine.reconcile('A',{mergedCommit:harden.attempt.head}).ok,true);
});

test('portable handoff with a reconciled dependency imports and repeats safely',t=>{
  const {root,engine}=fixture(t);selected(engine,'A');selected(engine,'C','C.txt','C',['A']);
  const hardened=engine.harden('A');git(root,'merge','--ff-only',hardened.attempt.branch!);engine.reconcile('A');const report=engine.handoff('C');
  const cloned=mkdtempSync(join(tmpdir(),'duet-merged-handoff-'));t.after(()=>rmSync(cloned,{recursive:true,force:true}));git(cloned,'clone',root,'.');
  const recipient=new Engine(cloned,{runChecks:()=>({ok:true})});recipient.init();assert.equal(recipient.importHandoff(report).ok,true);assert.equal(recipient.importHandoff(report).ok,true);
  const c=recipient.harden('C',{checkpoint:'cp-1'});assert.equal(c.ok,true);assert.equal(readFileSync(join(c.attempt.path,'A.txt'),'utf8'),'A\n');assert.equal(readFileSync(join(c.attempt.path,'C.txt'),'utf8'),'C');
});

test('merging a hardening result records its explicit dependency as integrated',t=>{
  const {root,engine}=fixture(t);selected(engine,'A');selected(engine,'C','C.txt','C',['A']);
  const hardened=engine.harden('C');git(root,'merge','--ff-only',hardened.attempt.branch!);engine.reconcile('C');
  const remaining=engine.planAlpha();assert.equal(remaining.manifest.snapshots.find(s=>s.id==='A')?.alreadyInMain,true);
  const alpha=engine.composeAlpha();assert.equal(alpha.ok,true);assert.equal(readFileSync(join(alpha.attempt.path,'A.txt'),'utf8'),'A\n');
});

test('init rejects a hard-linked gitignore without changing its external alias',t=>{
  const root=mkdtempSync(join(tmpdir(),'duet-hardlink-root-'));const outside=mkdtempSync(join(tmpdir(),'duet-hardlink-outside-'));
  t.after(()=>{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});});
  git(root,'init','-b','main');writeFileSync(join(root,'base.txt'),'base');git(root,'add','.');git(root,'commit','-m','base');
  const source=join(outside,'ignore.txt');writeFileSync(source,'keep this unchanged\n');linkSync(source,join(root,'.gitignore'));
  throwsCode(()=>new Engine(root).init(),'UNSAFE_PATH');assert.equal(readFileSync(source,'utf8'),'keep this unchanged\n');assert.equal(readFileSync(join(root,'.gitignore'),'utf8'),'keep this unchanged\n');
});

test('checkpoint permits deleting a secret-like file already tracked on main',t=>{
  const {root,engine}=fixture(t);writeFileSync(join(root,'.env'),'synthetic test fixture only\n');git(root,'add','.env');git(root,'commit','-m','pre-existing test fixture');
  const {experiment}=engine.start('remove-secret-file');rmSync(join(experiment.path,'.env'));
  const cp=engine.checkpoint('remove-secret-file',{select:true,description:'Remove tracked environment file',acceptance:['Environment file is absent']});assert.equal(cp.ok,true);
  const hardened=engine.harden('remove-secret-file');assert.equal(hardened.ok,true);assert.equal(existsSync(join(hardened.attempt.path,'.env')),false);
});

test('initialization defaults to no hooks and leaves configs from older versions untouched',t=>{
 const {root}=fixture(t);rmSync(join(root,'.duet'),{recursive:true,force:true});
 const engine=new Engine(root);const created=engine.init();
 assert.deepEqual(created.config.hooks,{checks:[],envAllow:[]});
 // Older versions wrote deploy/alpha hook fields; they are ignored, never rewritten.
 const legacy={...created.config,hooks:{checks:[],deploy:null,alpha:{environment:'alpha',disposable:true,target:'SET_ME'},envAllow:[]}};
 writeFileSync(join(root,'.duet/config.json'),JSON.stringify(legacy));const before=readFileSync(join(root,'.duet/config.json'),'utf8');
 assert.equal(engine.init().initialized,false);assert.equal(readFileSync(join(root,'.duet/config.json'),'utf8'),before);
 assert.equal(engine.status().ok,true);
});

test('plan, status and handoff are read-only; compose, check and harden need no deployment configuration',t=>{
 const {root,engine}=fixture(t);selected(engine,'A');
 const before=readFileSync(join(root,'.duet/state.json'),'utf8');const refs=git(root,'show-ref');
 engine.status();engine.planAlpha();const handoff=engine.handoff('A');
 assert.equal(readFileSync(join(root,'.duet/state.json'),'utf8'),before);assert.equal(git(root,'show-ref'),refs);
 assert.match(handoff.constraints.join(' '),/applicable existing authorization/);assert.doesNotMatch(handoff.constraints.join(' '),/Obtain fresh approval/);
 assert.equal(engine.composeAlpha().ok,true);assert.equal(engine.checkAlpha().ok,true);assert.equal(engine.harden('A').ok,true);
});
