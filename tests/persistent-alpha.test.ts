import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PersistentAlpha, type AlphaConfig, type Api } from '../src/persistent-alpha.ts';
const sha = 'a'.repeat(40), otherSha = 'b'.repeat(40);
const config: AlphaConfig = {version:1,mode:'persistent',provider:'github-actions',repository:'example/app',branch:'integration/alpha',checkWorkflow:'check.yml',deployWorkflow:'deploy-alpha.yml',dataPolicy:'retain',operation:'deploy-code'};
function fixture(t: any) {
 const root=mkdtempSync(join(tmpdir(),'duet-persistent-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 execFileSync('git',['init','-q'],{cwd:root});mkdirSync(join(root,'.duet'));
 writeFileSync(join(root,'.gitignore'),'/.duet/alpha-deployments/\n');writeFileSync(join(root,'.duet/alpha.json'),JSON.stringify(config));
 const run=(id:number,event='push')=>({id,run_attempt:1,repository:{full_name:config.repository},head_repository:{full_name:config.repository},head_sha:sha,head_branch:config.branch,path:`.github/workflows/${event==='push'?config.checkWorkflow:config.deployWorkflow}`,event,status:'completed',conclusion:'success',display_title:''});
 const state={head:sha,check:run(10),checks:[run(10)],runs:[] as any[],posts:[] as any[],failPost:false,failGet:false,pages:undefined as undefined|((page:number)=>any[])};
 const calls: string[]=[];
 const api: Api=(method,path,body)=>{
  calls.push(`${method} ${path}`);
  if(method==='POST') {state.posts.push(body);assert.ok(existsSync(join(root,'.duet/alpha-deployments/request.json')),'intent must precede dispatch');if(state.failPost)throw Error('timeout');return null;}
  if(state.failGet)throw Error('access denied');
  if(path.includes('/git/ref/'))return {object:{sha:state.head}};
  if(path.includes('/workflows/check.yml/runs?'))return {total_count:state.checks.length,workflow_runs:state.checks};
  if(path.endsWith('/actions/runs/10'))return state.check;
  if(path.includes('/workflows/deploy-alpha.yml/runs?'))return {workflow_runs:state.pages?state.pages(Number(new URL('https://api.github.com/'+path).searchParams.get('page'))):state.runs};
  if(path.includes('/actions/runs/'))return state.runs.find(r=>path.endsWith('/'+r.id));
  throw Error(`Unexpected API route ${path}`);
 };
 const alpha=new PersistentAlpha(root,api);
 const correlate=(requestId:string,status='completed',conclusion:any='success')=>{const r={...run(20,'workflow_dispatch'),display_title:`Duet Alpha ${requestId}`,status,conclusion};state.runs=[r];return r;};
 return {root,state,calls,alpha,correlate};
}
test('persistent dispatch pins protocol inputs, records intent, and separates submission from result',t=>{
 const {root,state,alpha,correlate}=fixture(t);
 const sent=alpha.deploy({sha,approved:true});assert.equal(sent.state,'submitted');assert.equal(state.posts.length,1);
 assert.deepEqual(state.posts[0],{ref:config.branch,inputs:{expected_sha:sha,duet_request_id:sent.requestId}});
 assert.equal(existsSync(join(root,'.duet/config.json')),false,'no coordinator initialization');
 correlate(sent.requestId!,'in_progress',null);const before=readFileSync(join(root,'.duet/alpha-deployments/request.json'),'utf8');assert.equal(alpha.status().state,'pending');assert.equal(readFileSync(join(root,'.duet/alpha-deployments/request.json'),'utf8'),before);
 correlate(sent.requestId!);assert.equal(alpha.status().state,'succeeded');assert.equal(alpha.deploy({sha,approved:true}).unchanged,true);assert.equal(state.posts.length,1);
});
test('preflight checks full SHA, current branch, latest check and reread attempt',t=>{
 for(const fault of ['short','branch','pending','newer-failed','identity','rerun']) {
  const {state,alpha}=fixture(t);
  if(fault==='branch')state.head=otherSha;
  if(fault==='pending')state.check.status='in_progress';
  if(fault==='newer-failed'){state.checks.push({...state.check,id:11,conclusion:'failure'});}
  if(fault==='identity')state.check.head_repository.full_name='attacker/fork';
  if(fault==='rerun'){state.check.run_attempt=2;state.check.conclusion='failure';}
  assert.throws(()=>alpha.deploy({sha:fault==='short'?'abc':sha,approved:true}));assert.equal(state.posts.length,0,fault);
 }
});
test('dry run and no-local-request status do not initialize or dispatch; approval required',t=>{
 const {root,state,alpha}=fixture(t);assert.equal(alpha.status().state,'no-local-request');
 assert.equal(alpha.deploy({sha,dryRun:true}).dryRun,true);assert.equal(existsSync(join(root,'.duet/alpha-deployments')),false);
 assert.throws(()=>alpha.deploy({sha}),/APPROVAL/);assert.equal(state.posts.length,0);
});
test('uncertain dispatch is never retried even after config changes or --retry',t=>{
 const {root,state,alpha,correlate}=fixture(t);state.failPost=true;
 const first=alpha.deploy({sha,approved:true});assert.equal(first.state,'uncertain');assert.equal(state.posts.length,1);
 writeFileSync(join(root,'.duet/alpha.json'),JSON.stringify({...config,branch:'another-alpha'}));
 assert.equal(alpha.deploy({sha:otherSha,approved:true,retry:true}).state,'uncertain');assert.equal(state.posts.length,1);
 correlate(first.requestId!,'in_progress',null);assert.equal(alpha.status().state,'pending');assert.equal(alpha.deploy({sha:otherSha,approved:true,retry:true}).state,'pending');assert.equal(state.posts.length,1);
});
test('confirmed failed run requires explicit retry and preserves request history',t=>{
 const {root,state,alpha,correlate}=fixture(t);const first=alpha.deploy({sha,approved:true});correlate(first.requestId!,'completed','failure');
 assert.equal(alpha.deploy({sha,approved:true}).state,'failed');assert.equal(state.posts.length,1);
 const second=alpha.deploy({sha,approved:true,retry:true});assert.equal(second.state,'submitted');assert.notEqual(first.requestId,second.requestId);
 assert.ok(existsSync(join(root,`.duet/alpha-deployments/${first.requestId}.json`)));assert.equal(state.posts.length,2);
});
test('correlation validates every identity dimension and rejects duplicate or unavailable results',t=>{
 for(const fault of ['sha','branch','repo','head-repo','workflow','event','duplicate','access','run-id']) {
  const {state,alpha,correlate}=fixture(t);const sent=alpha.deploy({sha,approved:true});const run=correlate(sent.requestId!);
  if(fault==='sha')run.head_sha=otherSha;if(fault==='branch')run.head_branch='main';if(fault==='repo')run.repository={full_name:'other/repo'};if(fault==='head-repo')run.head_repository={full_name:'other/repo'};
  if(fault==='workflow')run.path='.github/workflows/other.yml';if(fault==='event')run.event='push';if(fault==='duplicate')state.runs.push({...run,id:21});if(fault==='access')state.failGet=true;
  if(fault==='run-id'){const original=alpha.api;alpha.api=(method,path,body)=>path.endsWith('/actions/runs/20')?{...run,id:21}:original(method,path,body);}
  assert.throws(()=>alpha.status(),undefined,fault);assert.equal(state.posts.length,1);
 }
});
test('pagination finds later correlated runs and fails closed on incomplete coverage',t=>{
 const {state,alpha,correlate}=fixture(t);const sent=alpha.deploy({sha,approved:true});const run=correlate(sent.requestId!);
 state.pages=page=>page===1?Array.from({length:100},(_,i)=>({...run,id:100+i,display_title:'Unrelated'})):[run];assert.equal(alpha.status().state,'succeeded');
 state.pages=()=>Array.from({length:100},()=>({...run,display_title:'Unrelated'}));assert.throws(()=>alpha.status(),/incomplete/);
});
test('runtime lock, ignore policy and path checks prevent unsafe receipt mutation',t=>{
 for(const fault of ['lock','ignore','symlink']) {
  const {root,state,alpha}=fixture(t);const dir=join(root,'.duet/alpha-deployments');
  if(fault==='ignore')writeFileSync(join(root,'.gitignore'),'');
  else if(fault==='symlink')symlinkSync(tmpdir(),dir);
  else {mkdirSync(dir);writeFileSync(join(dir,'lock'),'owner');}
  assert.throws(()=>alpha.deploy({sha,approved:true}));assert.equal(state.posts.length,0);
  if(fault==='lock')assert.equal(readFileSync(join(dir,'lock'),'utf8'),'owner');
 }
});
test('config rejects destructive or additional protocol inputs rather than forwarding them',t=>{
 for(const change of [{dataPolicy:'reset'},{operation:'import'},{inputs:{maintenance:'true'}},{mode:'disposable'},{repository:'../bad'}]) {
  const {root,state,alpha}=fixture(t);writeFileSync(join(root,'.duet/alpha.json'),JSON.stringify({...config,...change}));
  assert.throws(()=>alpha.deploy({sha,approved:true}),/Invalid/);assert.equal(state.posts.length,0);
 }
});
test('configured project preflight failure prevents provider dispatch and intent receipt',t=>{
 const {root,state,alpha}=fixture(t);
 writeFileSync(join(root,'.duet/alpha.json'),JSON.stringify({...config,preflight:true}));
 assert.throws(()=>alpha.deploy({sha,approved:true,approvedHooks:true}),/Preflight Git/);
 assert.equal(state.posts.length,0);
 assert.equal(existsSync(join(root,'.duet/alpha-deployments/request.json')),false);
});
