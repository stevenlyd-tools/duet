import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deliveryReceipt} from '../src/delivery.ts';
const sha='a'.repeat(40), now=Date.parse('2026-10-21T12:00:00Z');
const fact=(state:string, extra={})=>({state,summary:'Source observation',source:'suo/decisions/replies.suo.ts',observedAt:new Date(now).toISOString(),sha,...extra});
for (const intendedOwner of ['Alex','Sam']) test(`independent outcomes and intended ${intendedOwner} handoff never imply acceptance`,()=>{
 const r=deliveryReceipt({version:2,features:[{id:'replies',title:'Keep replies',definitionDigest:'d'.repeat(64),sha,intendedOwner,product:fact('approved',{featureId:'replies',definitionDigest:'d'.repeat(64)}),main:fact('merged'),remainingFeatures:['profile']},{id:'profile',title:'Think more about Profile',definitionDigest:'d'.repeat(64),sha,product:fact('experimental',{featureId:'profile',definitionDigest:'d'.repeat(64)})}]},now);
 assert.equal(r.features[0].facts.acceptance.state,'omitted');
 assert.equal(r.features[0].facts.cleanup.state,'retained');
 assert.equal(r.features[1].facts.product.state,'experimental');
 assert.equal(r.features[0].environments.unspecified.state,'omitted');
});
test('exact SHA and fresh observations required; deployment authorization remains explicit',()=>{
 const r=deliveryReceipt({version:2,features:[{id:'avatars',title:'Avatars',definitionDigest:'d'.repeat(64),sha,checks:fact('passed',{sha:'b'.repeat(40)}),main:fact('merged',{observedAt:'2026-01-01'}),environments:{alpha:fact('not-authorized')}}]},now);
 assert.equal(r.features[0].facts.checks.state,'stale');assert.equal(r.features[0].facts.main.state,'stale');assert.equal(r.features[0].environments.alpha.state,'not-authorized');
});
test('rejects duplicate feature identities and unsupported observations',()=>{
 const f={id:'a',title:'A',definitionDigest:'d'.repeat(64),sha};assert.throws(()=>deliveryReceipt({version:2,features:[f,f]},now));
 assert.throws(()=>deliveryReceipt({version:2,features:[{...f,checks:{state:'passed'}}]},now));
});

test('acceptance binds feature, definition and exact code independently of observation age',()=>{
 const digest='d'.repeat(64);
 const feature={id:'a',title:'A',sha,definitionDigest:digest};
 const accepted=fact('accepted',{featureId:'a',definitionDigest:digest,sha});
 for(const patch of [{featureId:'other'},{definitionDigest:'e'.repeat(64)},{sha:'b'.repeat(40)},{definitionDigest:undefined}]){
  const receipt=deliveryReceipt({version:2,features:[{...feature,acceptance:{...accepted,...patch}}]},now);
  assert.equal(receipt.features[0].facts.acceptance.state,'stale');
 }
 const receipt=deliveryReceipt({version:2,features:[{...feature,acceptance:accepted}]},now);
 assert.equal(receipt.features[0].facts.acceptance.state,'accepted');
 assert.match(receipt.features[0].facts.acceptance.verification,/not independently queried/);
});
