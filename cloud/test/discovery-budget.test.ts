import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boundedFeedFetch,balanceFeeds,feedsForCategories} from '../../lib/discovery-core';
import {withProviderRetry,durableCompletion} from '../src/ai';

test('redirect loops and concurrent sources cannot spend the writing request budget',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(_url,init)=>{assert.equal(init?.redirect,'manual');calls++;return new Response(null,{status:302,headers:{location:'/loop'}});};
  try {
    const request=boundedFeedFetch(24);
    await Promise.allSettled(Array.from({length:12},()=>request('https://example.com/feed',{})));
    assert.equal(calls,24);
    await assert.rejects(request('https://example.com/extra',{}),/budget/);
    assert.equal(calls,24);
  }finally{globalThis.fetch=original;}
});

test('source selection covers every selected category before adding more feeds',()=>{
  const categories=['ai-ml','dev-tooling','emerging-tech','business'] as const;
  const available=feedsForCategories([...categories]);
  const selected=balanceFeeds(available,[...categories],4);
  assert.equal(selected.length,4);
  assert.deepEqual(new Set(selected.map(f=>f.category)),new Set(categories));
});

test('temporary AI failures retry once; quota and runtime budgets do not retry',async()=>{
  let calls=0,waits=0;
  const retry=withProviderRetry(async()=>++calls===1?{ok:false,reason:'provider_http_503'}:{ok:true,text:'ready',model:'test'},async()=>{waits++;});
  assert.equal((await retry({system:'test',user:'test'})).ok,true);
  assert.equal(calls,2);assert.equal(waits,1);
  for(const reason of ['provider_quota_reached','request_budget_exceeded','provider_http_401']) {
    calls=0;
    const run=withProviderRetry(async()=>{calls++;return {ok:false,reason};},async()=>assert.fail('must not retry'));
    assert.equal((await run({system:'test',user:'test'})).ok,false);assert.equal(calls,1);
  }
});

test('durable steps retry outages but do not retry exhausted quota',async()=>{
  const args={system:'test',user:'test'};
  await assert.rejects(durableCompletion(async()=>({ok:false,reason:'provider_http_503'}))(args),/provider_http_503/);
  assert.deepEqual(await durableCompletion(async()=>({ok:false,reason:'provider_quota_reached'}))(args),{ok:false,reason:'provider_quota_reached'});
});

test('an unavailable primary uses the selected free fallback, while quota failures do not',async()=>{
  let fallbackCalls=0;
  const fallback=async()=>{fallbackCalls++;return {ok:true as const,text:'real alternative output',model:'secondary'};};
  const run=withProviderRetry(async()=>({ok:false,reason:'provider_http_503'}),async()=>{},fallback);
  assert.deepEqual(await run({system:'s',user:'u'}),{ok:true,text:'real alternative output',model:'secondary'});
  assert.equal(fallbackCalls,1);
  const limited=withProviderRetry(async()=>({ok:false,reason:'provider_quota_reached'}),async()=>{},fallback);
  await limited({system:'s',user:'u'});assert.equal(fallbackCalls,1);
});
