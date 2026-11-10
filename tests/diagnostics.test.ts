import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {diagnostics} from '../src/diagnostics.ts';
test('diagnostics reports divergent instructions without claiming automatic update',t=>{
 const root=mkdtempSync(join(tmpdir(),'duet-doctor-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'.duet/skills/duet'),{recursive:true});writeFileSync(join(root,'.duet/skills/duet/SKILL.md'),'old instructions');
 const r=diagnostics(root);assert.match(r.instructions[0].status,/different content/);assert.match(r.nativeUpdates.configured,/unknown/);assert.match(r.nativeUpdates.verified,/not checked/);const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;assert.equal(r.cliVersion,version);assert.equal(r.pluginVersion,version);assert.equal(r.skill.matchesDistribution,true);
});
