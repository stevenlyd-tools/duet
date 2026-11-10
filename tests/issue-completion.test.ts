import test from 'node:test';
import assert from 'node:assert/strict';
import {issueCompletion} from '../src/issue-completion.ts';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const now=Date.parse('2026-10-22T12:00:00Z');
const base=()=>({version:1,issue:{url:'https://github.com/acme/project/issues/1',state:'open',reason:'unknown',observedAt:new Date(now).toISOString()},scopeReviewed:true,requirements:[{id:'report',scope:'measurement',criterion:'Report agreed measurements and conclusions',state:'met',evidence:['report.md']}],authorization:'allowed',optOut:false,attempt:'none'});
const assess=(b:any)=>issueCompletion(b,now);
test('measurement completion needs neither implementation nor deployment; deterministic and pure',()=>{const b=base(),before=JSON.stringify(b);assert.equal(assess(b).nextAction,'close-with-existing-authorization');assert.equal(assess(b).closure,'unverified');assert.deepEqual(assess(b),assess(b));assert.equal(JSON.stringify(b),before)});
for(const scope of ['definition','implementation','promotion','deployment','acceptance'])test(`${scope} is required only when included and cannot be skipped`,()=>{const b=base();b.requirements.push({id:scope,scope,criterion:'Required original obligation',state:'unmet',evidence:['follow-up issue']});assert.equal(assess(b).complete,false);assert.equal(assess(b).nextAction,'keep-open');b.requirements[1].state='met';assert.equal(assess(b).nextAction,'close-with-existing-authorization')});
test('merged PR/evidence alone and linked follow-up cannot satisfy unmet acceptance',()=>{const b=base();b.requirements[0].state='unknown';b.requirements[0].evidence=['merged PR','green CI','separately filed remainder'];assert.equal(assess(b).nextAction,'keep-open')});
test('missing evidence or unreviewed whole scope leaves open',()=>{const b=base();b.requirements[0].evidence=[];assert.equal(assess(b).complete,false);b.requirements[0].evidence=['report'];b.scopeReviewed=false;assert.equal(assess(b).nextAction,'keep-open')});
for(const authorization of ['required','denied','unknown'])test(`${authorization} host/user authorization cannot be bypassed`,()=>{assert.equal(assess({...base(),authorization}).nextAction,'blocked-authorization')});
test('explicit opt-out keeps completed work open',()=>assert.equal(assess({...base(),optOut:true}).nextAction,'keep-open-opt-out'));
for(const reason of ['completed','not_planned','unknown'])test(`already closed ${reason} is idempotent without inventing acceptance`,()=>{const b=base();b.issue.state='closed';b.issue.reason=reason;b.scopeReviewed=false;b.authorization='denied';assert.equal(assess(b).nextAction,'none-already-closed');assert.equal(assess(b).closure,`observed-closed-${reason}`);assert.equal(assess(b).complete,false)});
for(const attempt of ['pending','uncertain'])test(`${attempt} requires readback even with old closed snapshot`,()=>{const b={...base(),attempt};b.issue.state='closed';assert.equal(assess(b).nextAction,'read-remote');assert.equal(assess(b).closure,'unverified')});
for(const attempt of ['failed','succeeded'])test(`${attempt} with remote still open cannot claim closure or blind retry`,()=>assert.equal(assess({...base(),attempt}).nextAction,'reconcile-attempt'));
test('successful write with subsequent closed observation is distinguishable from incomplete acceptance',()=>{const b={...base(),attempt:'succeeded'};b.issue.state='closed';b.issue.reason='completed';assert.equal(assess(b).closure,'observed-closed-completed')});
for(const offset of [-86400001,1])test(`stale/future read ${offset} requests remote refresh`,()=>{const b=base();b.issue.observedAt=new Date(now+offset).toISOString();assert.equal(assess(b).nextAction,'read-remote')});
test('unknown remote status requires read, not a close',()=>{const b=base();b.issue.state='unknown';assert.equal(assess(b).nextAction,'read-remote')});
test('strict schema rejects missing scope, extra approval flags, coercion and malformed identity',()=>{
 for(const edit of [(b:any)=>b.requirements=[],(b:any)=>b.requirements.push(b.requirements[0]),(b:any)=>b.approved=true,(b:any)=>b.optOut='false',(b:any)=>b.issue.url='https://github.com/issues/repo/pull/1',(b:any)=>b.requirements[0].criterion='',(b:any)=>b.issue.observedAt='2026-02-30T12:00:00Z',(b:any)=>b.issue.observedAt='yesterday',(b:any)=>b.requirements[0].evidence=[null]]){const b=base();edit(b);assert.throws(()=>assess(b));}
});
test('CLI roundtrip is read-only and needs no initialized repository',()=>{
 const root=mkdtempSync(join(tmpdir(),'duet-closure-'));
 try {const b=base();b.issue.observedAt=new Date().toISOString();const file=join(root,'input.json');const before=JSON.stringify(b);writeFileSync(file,before);const out=execFileSync(process.execPath,[new URL('../src/cli.ts',import.meta.url).pathname,'--project',root,'issue-completion',file],{encoding:'utf8'});assert.equal(JSON.parse(out).nextAction,'close-with-existing-authorization');assert.equal(readFileSync(file,'utf8'),before);assert.throws(()=>execFileSync(process.execPath,[new URL('../src/cli.ts',import.meta.url).pathname,'issue-completion',file,'--approve-deploy'],{stdio:'pipe'}));} finally {rmSync(root,{recursive:true,force:true});}
});
test('distributed skill exposes closure and real authorization boundary',()=>{const s=readFileSync(new URL('../skills/duet/SKILL.md',import.meta.url),'utf8');assert.match(s,/references\/issue-closure.md/);const r=readFileSync(new URL('../skills/duet/references/issue-closure.md',import.meta.url),'utf8');for(const phrase of ['override platform approval requirements','do not add another conversational approval','Read back the remote Issue','leave the original Issue open','do not reopen, re-close'])assert.ok(r.includes(phrase),phrase)});
