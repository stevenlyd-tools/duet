import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {runSuo} from './suo-runtime.ts';
const text=(v:unknown):v is string=>typeof v==='string'&&!!v.trim();
const shaPattern=/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
function path(value:unknown):asserts value is string{if(!text(value)||value.startsWith('/')||value.includes('\\')||value.includes('\0')||value.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Record path must stay inside the repository.');}
function exact(value:any,keys:string[],label:string){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys.sort().join(','))throw new Error(`${label}: invalid shape.`);}
/** Repository-only engineering association; no execution/deployment/PR status is stored here. */
export function engineeringRecord(body:string){
 const blocks=[...body.matchAll(/^```duet-engineering\s*\n([\s\S]*?)^```\s*$/gm)];
 if(blocks.length!==1)throw new Error('Owning record needs one duet-engineering JSON block.');
 const record=JSON.parse(blocks[0][1]);exact(record,['version','units'],'engineering record');if(record.version!==1||!Array.isArray(record.units)||!record.units.length)throw new Error('Invalid engineering record version/units.');const ids=new Set<string>();
 for(const unit of record.units){exact(unit,['id','fixes','validation'],'record Unit');if(!text(unit.id)||ids.has(unit.id))throw new Error('Record Unit IDs must be unique.');ids.add(unit.id);if(!Array.isArray(unit.fixes)||!unit.fixes.length||unit.fixes.some((x:unknown)=>!text(x)))throw new Error('Describe concrete fixes.');if(!Array.isArray(unit.validation)||!unit.validation.length)throw new Error('Provide repository validation mappings.');for(const mapping of unit.validation){exact(mapping,['criterionId','path'],'validation mapping');if(!text(mapping.criterionId))throw new Error('Criterion ID required.');path(mapping.path)}}return record;
}
export function verifyCompletionAssociation(input:{sha:string;selected:string[];authority:'suo'|'other';units:any[];projection:any[];read:(path:string)=>string}){
 if(!shaPattern.test(input.sha)||!input.selected.length||new Set(input.selected).size!==input.selected.length)throw new Error('Select unique Unit IDs and an exact code SHA.');
 const gaps:string[]=[],details:any[]=[];
 for(const id of input.selected){const units=input.units.filter(u=>u.id===id),projected=input.projection.filter(u=>u.id===id);if(units.length!==1||projected.length!==1){gaps.push(`${id}: missing/ambiguous current authority`);continue}const unit=units[0],p=projected[0];
  if(!/^[a-f0-9]{64}$/.test(p.coverageDigest??'')||!['unknown','not_started','in_progress','implemented'].includes(p.declaredState)||!['unknown','stale','current'].includes(p.applicability)||typeof p.implemented!=='boolean')throw new Error('Malformed authority projection.');
  if(p.implemented&&(p.declaredState!=='implemented'||p.applicability!=='current'))throw new Error('Contradictory implementation projection.');
  if(!Array.isArray(unit.documents)||!unit.documents.length){gaps.push(`${id}: owning engineering record missing`);continue}
  const matches:any[]=[];
  for(const document of unit.documents){try{path(document);const body=input.read(document);if(!body.includes('```duet-engineering'))continue;const record=engineeringRecord(body);for(const entry of record.units)if(entry.id===id){for(const mapping of entry.validation){input.read(mapping.path);if(!unit.implementation.coverage.some((c:any)=>c.criterionId===mapping.criterionId&&c.path===mapping.path))throw new Error('validation mapping is absent from current Unit coverage')}matches.push({path:document,fixes:entry.fixes,validation:entry.validation})}}catch(error){gaps.push(`${id}: ${document}: ${error instanceof Error?error.message:String(error)}`)}}
  if(matches.length!==1)gaps.push(`${id}: expected exactly one owning engineering record, found ${matches.length}`);
  if(p.applicability!=='current'||p.implemented!==true)gaps.push(`${id}: current complete implementation is not established (${p.applicability})`);
  details.push({id,sha:input.sha,definitionDigest:p.coverageDigest,declaredState:p.declaredState,applicability:p.applicability,record:matches[0]??null});
 }
 return {ok:!gaps.length,authority:input.authority,sha:input.sha,units:details,gaps,notice:'Repository association and declared coverage only. Query exact-commit CI, PRs, live manifests, authorization and acceptance separately; this result grants none of them.'};
}
/** Runs the explicitly selected installed Suo reader; never changes authority or Git. */
export function suoCompletion(root:string,cli:string,sha:string,selected:string[]){
 if(!shaPattern.test(sha))throw new Error('Expected full commit SHA.');const invoke=(...args:string[])=>runSuo(root,cli,[...args,'--root',resolve(root),'--ref',sha],{maxBuffer:32*1024*1024,timeout:120000});
 const exported=JSON.parse(invoke('export')),projection=JSON.parse(invoke('inspect'));
 if(exported.snapshot?.schemaVersion!==5||projection.schemaVersion!==5||exported.context?.target!=='commit'||projection.target!=='commit'||exported.context.identity!==sha||projection.identity!==sha)throw new Error('Suo must return schema 5 for the exact committed snapshot.');
 const read=(file:string)=>{path(file);const spec=`${sha}:${file}`,entry=execFileSync('git',['-C',root,'ls-tree','-z','--full-tree',sha,'--',`:(literal)${file}`],{encoding:'utf8'});const rows=entry.split('\0').filter(Boolean);if(rows.length!==1||rows[0].slice(rows[0].indexOf('\t')+1)!==file||!/^100(?:644|755) blob /.test(rows[0]))throw new Error('Record/reference must be a regular Git file');return execFileSync('git',['-C',root,'show',spec],{encoding:'utf8',maxBuffer:1024*1024})};
 return verifyCompletionAssociation({sha,selected,authority:'suo',units:exported.snapshot.units,projection:projection.units,read});
}
