/** Assesses supplied observations only. Never authenticates authorization or writes to GitHub. */
function exact(value:any, keys:string[], label:string) {
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).sort().join()!==[...keys].sort().join()) throw new Error(`${label}: invalid fields`);
}
function text(value:any) { if(typeof value!=='string'||!value.trim()) throw new Error('Expected nonempty text'); }
function one(value:any, choices:string[]) { if(!choices.includes(value)) throw new Error(`Expected ${choices.join('/')}`); }
function time(value:any) { text(value); if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)||!Number.isFinite(Date.parse(value))) throw new Error('Expected UTC timestamp'); const parsed=Date.parse(value); if(new Date(parsed).toISOString().slice(0,19)!==value.slice(0,19)) throw new Error('Invalid calendar timestamp'); return parsed; }
export function issueCompletion(input:any, now=Date.now()) {
  exact(input,['version','issue','scopeReviewed','requirements','authorization','optOut','attempt'],'issue completion');
  if(input.version!==1) throw new Error('Unsupported issue completion version');
  exact(input.issue,['url','state','reason','observedAt'],'issue');
  if(typeof input.issue.url!=='string'||!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]*$/.test(input.issue.url)) throw new Error('Expected GitHub Issue URL');
  one(input.issue.state,['open','closed','unknown']); one(input.issue.reason,['completed','not_planned','unknown']);
  const observed=time(input.issue.observedAt);
  if(typeof input.scopeReviewed!=='boolean'||typeof input.optOut!=='boolean') throw new Error('Expected boolean');
  one(input.authorization,['allowed','required','denied','unknown']);
  one(input.attempt,['none','pending','uncertain','failed','succeeded']);
  if(!Array.isArray(input.requirements)||!input.requirements.length) throw new Error('Acceptance requirements required');
  const gaps:string[]=[], ids=new Set<string>();
  for(const r of input.requirements) {
    exact(r,['id','scope','criterion','state','evidence'],'requirement');text(r.id);text(r.criterion);
    if(ids.has(r.id)) throw new Error('Duplicate requirement'); ids.add(r.id);
    one(r.scope,['measurement','definition','implementation','promotion','deployment','acceptance']);
    one(r.state,['met','unmet','unknown']);
    if(!Array.isArray(r.evidence)) throw new Error('Expected evidence array'); r.evidence.forEach(text);
    if(r.state!=='met'||!r.evidence.length) gaps.push(`${r.id}: ${r.state==='met'?'missing evidence':r.state}`);
  }
  if(!input.scopeReviewed) gaps.push('Entire Issue scope has not been reviewed');
  const complete=gaps.length===0;
  const fresh=Number.isFinite(now)&&observed<=now&&now-observed<=24*60*60*1000;
  // Pending/uncertain writes always need a new provider read, even with a pre-write snapshot.
  let nextAction:string;
  if(!fresh||input.issue.state==='unknown'||['pending','uncertain'].includes(input.attempt)) nextAction='read-remote';
  else if(input.issue.state==='closed') nextAction='none-already-closed';
  else if(!complete) nextAction='keep-open';
  else if(input.optOut) nextAction='keep-open-opt-out';
  else if(input.authorization!=='allowed') nextAction='blocked-authorization';
  else if(input.attempt!=='none') nextAction='reconcile-attempt';
  else nextAction='close-with-existing-authorization';
  return {issue:input.issue.url,complete,gaps,nextAction,
    closure:nextAction==='none-already-closed'?`observed-closed-${input.issue.reason}`:'unverified',
    notice:'Supplied observations only; no provider verification or permission grant. Re-read scope/state and respect host gates before any write. Closed does not mean acceptance met.'};
}
