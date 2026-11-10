import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makeHooks} from '../src/hooks.ts';
const cwd=mkdtempSync(join(tmpdir(),'duet-hooks-test-'));
test.after(()=>rmSync(cwd,{recursive:true,force:true}));
const ctx=(hooks:any)=>({cwd,manifest:{},config:{hooks}});
test('hooks require explicit approval and nonempty basic checks',()=>{
 assert.throws(()=>makeHooks(cwd,false).runChecks(ctx({checks:[]})),/APPROVAL/);
 assert.throws(()=>makeHooks(cwd,true).runChecks(ctx({checks:[]})),/CHECKS_REQUIRED/);
});
test('no shell interpolation, scoped environment, clean HOME',()=>{
 process.env.DUET_TEST_SECRET='hidden';
 const result=makeHooks(cwd,true).runChecks(ctx({checks:[{argv:[process.execPath,'-e',`if(process.env.DUET_TEST_SECRET||process.env.GITHUB_TOKEN||process.env.NODE_OPTIONS)process.exit(2);if(process.argv[1]!=='$(echo injection)')process.exit(3)`,'$(echo injection)']}]}));
 assert.equal(result.ok,true);
 delete process.env.DUET_TEST_SECRET;
});
test('failed command returns false and unsafe env names rejected',()=>{
 assert.equal(makeHooks(cwd,true).runChecks(ctx({checks:[{argv:[process.execPath,'-e','process.exit(4)']}]})).ok,false);
 assert.throws(()=>makeHooks(cwd,true).runChecks(ctx({checks:[{argv:['true']}],envAllow:['PROD_TOKEN']})),/UNSAFE_ENV/);
});
test('reserved process variables cannot be overridden',()=>{
 for(const name of ['DUET_ENVIRONMENT','PATH','HOME','TMPDIR','CI']) {
   assert.throws(()=>makeHooks(cwd,true).runChecks(ctx({checks:[{argv:['true']}],envAllow:[name]})),/UNSAFE_ENV/);
 }
});
