import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diverseWinner,rotateCategories,sameStory,storyUrl,unseenStories} from '../../lib/editorial-selection';
import {discover,feedsForCategories,balanceFeeds,type Candidate} from '../../lib/discovery-core';
import {relevanceTotal,type ScoredCandidate} from '../../lib/judge-core';

const candidate=(category:string,total=8):ScoredCandidate=>({title:`A distinct ${category} story`,url:`https://example.com/${category}`,
  summary:'A useful development',source:'test',categoryHint:category,category,reason:'relevant',total,
  scores:{persona_fit:8,category_fit:8,novelty:8,timeliness:8,non_duplication:8}});

test('higher music scores cannot monopolise qualifying categories over repeated generations',()=>{
  const active=['music-tech-software','finance','ai-ml'];
  const scored=active.map((c,i)=>candidate(c,9.5-i));
  const recent:string[]=[];
  for(let i=0;i<12;i++){
    const winner=diverseWinner(scored,active,recent)!;
    assert.notEqual(winner.category,recent[0]);
    recent.unshift(winner.category);
  }
  for(const category of active)assert.equal(recent.filter(c=>c===category).length,4);
  assert.deepEqual(rotateCategories(active,['music-tech-software','music-tech-software','finance']),['ai-ml','finance','music-tech-software']);
});

test('rotation never lowers relevance, novelty or quality gates and works with one category',()=>{
  const good=candidate('finance'),bad=candidate('ai-ml',10);
  for(const field of ['category_fit','persona_fit','non_duplication'] as const){
    const weak={...bad,scores:{...bad.scores,[field]:5}};
    assert.equal(diverseWinner([good,weak],['finance','ai-ml'],['finance']),good);
    assert.ok(relevanceTotal(weak.scores,'ai-ml',['ai-ml'])<6.5);
  }
  assert.equal(diverseWinner([{...bad,total:6.49}],['ai-ml'],[]),null);
  assert.equal(diverseWinner([bad],['finance'],[]),null);
  assert.equal(diverseWinner([good],['finance'],['finance']),good);
});

test('tracking links, Bing redirects and syndicated headlines do not create fresh stories',()=>{
  const original='https://publisher.example/story?a=1';
  assert.equal(storyUrl(original+'&utm_source=mail#top'),original);
  assert.equal(storyUrl('https://www.bing.com/news/apiclick.aspx?url='+encodeURIComponent(original)),original);
  for(const invalid of ['javascript:alert(1)','https://user:password@example.com','bad'])assert.equal(storyUrl(invalid),'');
  const title='Researchers improve solar panel recycling recovery efficiency - Publisher A';
  assert.ok(sameStory(title,title.replace('Publisher A','Publisher B')));
  assert.equal(sameStory(title,'Central bank revises interest rate policy amid inflation'),false);
  const a={...candidate('finance'),url:original,title};
  assert.equal(unseenStories([a],[original+'&utm_campaign=x']).length,0);
  assert.equal(unseenStories([a],[],[title.replace('Publisher A','Publisher B')]).length,0);
  assert.equal(unseenStories([a,{...a,url:'https://other.example/report'}],[]).length,1);
});

test('every subject has two search engines and personal topics expand and rotate research',()=>{
  const active=['energy:solar-energy','finance','ai-ml'];
  const feeds=feedsForCategories(active,true,['battery recycling'],0);
  for(const category of active){
    const urls=feeds.filter(f=>f.category===category).map(f=>new URL(f.url));
    assert.ok(urls.some(u=>u.hostname==='news.google.com'));
    assert.ok(urls.some(u=>u.hostname==='www.bing.com'));
  }
  assert.equal(feeds.filter(f=>new URL(f.url).searchParams.get('q')?.includes('battery recycling')).length,2);
  assert.deepEqual(new Set(balanceFeeds(feeds,active,3).map(f=>f.category)),new Set(active));
  assert.notEqual(feedsForCategories(['finance'],true,[],0)[0].url,feedsForCategories(['finance'],true,[],1)[0].url);
  assert.ok(feedsForCategories(['energy:solar-energy'],true,[],1).some(f=>decodeURIComponent(f.url).includes('research OR study')));
});

test('discovery balances publishers, excludes consumed stories before capping, and unwraps sources',async()=>{
  const original=globalThis.fetch;let calls=0,inFlight=0,peak=0;
  globalThis.fetch=async input=>{
    calls++;peak=Math.max(peak,++inFlight);
    await new Promise(resolve=>setTimeout(resolve,5));inFlight--;
    const bing=String(input).includes('bing.com');
    const items=Array.from({length:16},(_,i)=>{
      const url=`https://${bing?'second':'first'}.example/story-${i}`;
      const link=bing?'https://www.bing.com/news/apiclick.aspx?url='+encodeURIComponent(url):url;
      return `<item><title>${bing?'Banking':'Solar'} development ${i}</title><link>${link}</link><description>${'Evidence '.repeat(100)}</description><source>${bing?'Independent publisher':'Large publisher'}</source><pubDate>${new Date().toUTCString()}</pubDate></item>`;
    }).join('');
    return new Response(`<rss><channel>${items}</channel></rss>`);
  };
  try{
    const result=await discover(async()=>{},{categories:['energy:solar-energy'],wide:true,maxFetches:24,maxFeeds:20,excludeUrls:['https://first.example/story-0']});
    assert.equal(calls,2);assert.ok(peak<=6);
    assert.equal(result.length,31);
    assert.notEqual(result[0].publisher,result[1].publisher);
    assert.ok(result.every(c=>!c.url.includes('bing.com')&&!c.url.endsWith('first.example/story-0')));
    assert.ok(result.some(c=>c.summary.length>400));
  }finally{globalThis.fetch=original;}
});

test('wide discovery uses twenty sources with at most six pending requests and tolerates failures',async()=>{
  const original=globalThis.fetch;let calls=0,pending=0,peak=0;
  globalThis.fetch=async()=>{
    const n=++calls;peak=Math.max(peak,++pending);
    await new Promise(resolve=>setTimeout(resolve,5));pending--;
    if(n===1)return new Response('unavailable',{status:503});
    return new Response(`<rss><channel><item><title>Different source result ${n}</title><link>https://publisher${n}.example/story</link></item></channel></rss>`);
  };
  try{
    const result=await discover(async()=>{},{categories:['music-tech-software','finance','ai-ml','dev-tooling'],wide:true,maxFetches:24,maxFeeds:20});
    assert.equal(calls,20);assert.equal(peak,6);assert.equal(result.length,19);
    assert.equal(new Set(result.map(c=>c.categoryHint)).size,4);
  }finally{globalThis.fetch=original;}
});
