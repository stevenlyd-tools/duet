import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {projectPreflight} from '../src/preflight.ts';
test('checks pinned inputs, requires authorization, fails on schema bug and cleans only its worktree',t=>{
 const root=mkdtempSync(join(tmpdir(),'duet-validator-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 git('init','-q');git('config','user.name','Test');git('config','user.email','test@example.invalid');mkdirSync(join(root,'.duet'));
 writeFileSync(join(root,'.duet/preflight.json'),JSON.stringify({version:1,checks:[{argv:[process.execPath,'validate.cjs']}]}));
 writeFileSync(join(root,'validate.cjs'),"if(require('./manifest.json').version!==1) process.exit(1)");
 writeFileSync(join(root,'manifest.json'),'{}');git('add','.');git('commit','-qm','bad metadata');const bad=git('rev-parse','HEAD');
 writeFileSync(join(root,'manifest.json'),'{"version":1}');git('add','.');git('commit','-qm','fix metadata');const good=git('rev-parse','HEAD');
 const before=git('worktree','list','--porcelain');
 assert.equal(projectPreflight(root,good,false,true).state,'not-run');
 assert.throws(()=>projectPreflight(root,good),/APPROVAL/);
 assert.throws(()=>projectPreflight(root,bad,true),/failed/);
 writeFileSync(join(root,'manifest.json'),'{}'); // dirty checkout cannot replace deployment inputs
 assert.equal(projectPreflight(root,good,true).state,'passed');
 assert.equal(git('worktree','list','--porcelain'),before);assert.match(git('status','--short'),/manifest.json/);
});
