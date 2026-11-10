/** Read-only projection of linked source observations, never a second tracker. */
export type Fact = { state: string; summary: string; source: string; observedAt: string; sha?: string; featureId?: string; definitionDigest?: string };
const stages = ['product','checks','main','integration','acceptance','cleanup'] as const;
const states = new Set(['pending','passed','failed','merged','synced','accepted','retained','completed','blocked','not-authorized','omitted','experimental','approved']);
export function deliveryReceipt(input: any, now = Date.now()) {
  if (input?.version !== 2 || !Array.isArray(input.features) || !input.features.length) throw new Error('Expected version 2 and nonempty features.');
  const ids = new Set<string>();
  const features = input.features.map((feature: any) => {
    if (typeof feature.id !== 'string' || !feature.id.trim() || ids.has(feature.id) || typeof feature.title !== 'string' || !feature.title.trim()) throw new Error('Features require unique authority IDs and readable titles.');
    ids.add(feature.id);
    if (!/^[a-f0-9]{40}$/.test(feature.sha ?? '')) throw new Error('Each feature requires its expected full code SHA.');
    if (!/^[a-f0-9]{64}$/.test(feature.definitionDigest ?? '')) throw new Error('Each feature requires its current definition digest.');
    const project = (value: Fact | undefined, code: boolean, definition = false) => {
      if (value === undefined) return {state:'omitted',summary:'No source observation supplied.'};
      if (!value || !states.has(value.state) || ![value.summary,value.source,value.observedAt].every(x=>typeof x==='string'&&x.trim()) || !Number.isFinite(Date.parse(value.observedAt))) throw new Error('Facts require a known state, readable summary, source and observation time.');
      const age = now - Date.parse(value.observedAt);
      const identityRequired = !['omitted','not-authorized','blocked','pending'].includes(value.state);
      const stale = (definition && identityRequired && (value.featureId !== feature.id || value.definitionDigest !== feature.definitionDigest)) || age < 0 || age > 24*60*60*1000 || (code && !['omitted','not-authorized','blocked','pending'].includes(value.state) && value.sha !== feature.sha);
      return {...value,...(stale ? {state:'stale',reportedState:value.state,summary:`Recheck source: ${value.summary}`} : {}),verification:'supplied source observation; not independently queried'};
    };
    const facts: Record<string, unknown> = Object.fromEntries(stages.map(stage=>[stage,project(feature[stage],['checks','main','integration','acceptance'].includes(stage), ['product','acceptance'].includes(stage))]));
    const environments: Record<string,unknown> = {};
    for (const [name,value] of Object.entries(feature.environments ?? {})) {
      if (!name.trim()) throw new Error('Environment name is required.');
      environments[name] = project(value as Fact,true);
    }
    if (!Object.keys(environments).length) environments.unspecified = {state:'omitted',summary:'No deployed environment evidence supplied.'};
    // A feature can share a branch, and merge evidence never proves that all
    // other experiments in that branch have been promoted or are disposable.
    const remaining = feature.remainingFeatures ?? [];
    if (!Array.isArray(remaining) || remaining.some((id:unknown)=>typeof id!=='string'||!id.trim())) throw new Error('remainingFeatures must be feature IDs.');
    if (remaining.length) facts.cleanup = {state:'retained',summary:`Preserve source branches: remaining experiments ${remaining.join(', ')}.`,reported: facts.cleanup};
    return {id:feature.id,title:feature.title,definitionDigest:feature.definitionDigest,sha:feature.sha,intendedOwner:feature.intendedOwner ?? null,assignment:'not inferred; consult assignment evidence',facts,environments,remainingFeatures:remaining};
  });
  return {version:2,generatedAt:new Date(now).toISOString(),features,notice:'Read-only receipt. Product approval, assignment, user acceptance, deployment authorization and cleanup remain independent. Recheck linked sources before acting.'};
}
