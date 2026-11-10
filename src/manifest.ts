import {randomUUID} from 'node:crypto';
export type BuildManifest={version:1;component:string;revision:string;buildId:string};
export function validateManifest(value:unknown):asserts value is BuildManifest {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='buildId,component,revision,version')throw new Error('Build manifest requires exactly version, component, revision and buildId.');
 const m=value as BuildManifest;
 if(m.version!==1||typeof m.component!=='string'||!m.component.trim()||typeof m.buildId!=='string'||!m.buildId.trim()||m.buildId.length>256||typeof m.revision!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(m.revision))throw new Error('Invalid build-bound manifest identity.');
}
/** Supplied JSON shape/identity comparison is not a network observation. */
export function compareManifest(value:unknown,expected:{component:string;revision:string}){
 validateManifest(value);
 return {state:value.component===expected.component&&value.revision===expected.revision?'matched':'mismatch',manifest:value,expected,verification:'supplied manifest; not independently queried'};
}
/** Read-only live observation. No provider credentials, deployment, cache purge or writes. */
export async function observeManifest(endpoint:string,expected:{component:string;revision:string},fetcher:typeof fetch=fetch){
 const url=new URL(endpoint);
 if(url.username||url.password||url.protocol!=='https:'&&!(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.protocol==='http:'))throw new Error('Manifest endpoint must be credential-free HTTPS (loopback HTTP is allowed for tests).');
 if(!expected.component.trim()||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(expected.revision))throw new Error('Expected component and full revision required.');
 url.searchParams.set('duet_observation',randomUUID());
 const observedAt=new Date().toISOString();
 try{
  const response=await fetcher(url,{cache:'no-store',redirect:'error',headers:{'Cache-Control':'no-cache, no-store','Pragma':'no-cache','Accept':'application/json'},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('Manifest must be JSON.');
  const reader=response.body?.getReader();if(!reader)throw new Error('Empty manifest body.');const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>16384)throw new Error('Manifest exceeds 16 KiB.');chunks.push(value)}}finally{await reader.cancel()}
  const result=compareManifest(JSON.parse(Buffer.concat(chunks).toString('utf8')),expected),cacheControl=response.headers.get('cache-control')??'',age=response.headers.get('age');
  if(!/(?:^|,)\s*no-store\s*(?:,|$)/i.test(cacheControl)||age!==null&&(!/^\d+$/.test(age)||Number(age)>0))return {...result,state:'unknown',source:endpoint,observedAt,reason:'Response does not establish an uncached observation.',verification:'live request; cache assurance unavailable'};
  return {...result,source:endpoint,observedAt,verification:'queried live manifest; identity of the serving response only',limits:'Does not prove all instances, browser/service-worker state, health or product acceptance.'};
 }catch(error){return {state:'unknown',source:endpoint,observedAt,expected,reason:error instanceof Error?error.message:String(error),verification:'live query failed; no deployment success inferred'}}
}
