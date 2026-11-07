import assert from 'node:assert/strict';
import {ALL_CATEGORY_IDS,CATEGORIES,LEGACY_CATEGORY_IDS,categoryBlock,describeCategories,isCategoryId} from '../lib/categories';
import {SUBJECT_GROUPS} from '../lib/category-catalogue';
import {discover,feedsForCategories} from '../lib/discovery';
import {defaultSetup,parseSetup,setupStyle,setupCategories,setupPersona,INDUSTRIES} from '../lib/onboarding';
import {relevanceTotal,PUBLISH_THRESHOLD} from '../lib/judge';
import {styleBlock} from '../lib/style';

async function main() {
  const labels=Object.values(CATEGORIES).map(c=>c.label.toLowerCase());
  assert.ok(ALL_CATEGORY_IDS.length>=1000);
  assert.equal(new Set(labels).size,labels.length,'subjects have distinct labels');
  assert.equal(ALL_CATEGORY_IDS.length,12+SUBJECT_GROUPS.reduce((n,g)=>n+g[2].split('|').length,0),'no colliding IDs');
  assert.ok(ALL_CATEGORY_IDS.every(id=>isCategoryId(id)&&feedsForCategories([id]).length>0));
  for(const id of ['__proto__','constructor','toString','unknown']) assert.equal(isCategoryId(id),false);
  assert.equal(categoryBlock([]),categoryBlock(LEGACY_CATEGORY_IDS));
  assert.equal(describeCategories([]),describeCategories(LEGACY_CATEGORY_IDS));
  const subjects=['energy:solar-energy','music:spatial-audio','health:patient-safety'];
  const config=parseSetup({...defaultSetup,categories:subjects,topics:subjects.map(id=>CATEGORIES[id].label),voice:'analytical',voiceNotes:'Explain the practical implications.',style:{structure:'bullets',minWords:80,maxWords:160,register:'accessible',emoji:'sparing',hook:'plain',cta:'soft',hashtagCount:0,bannedPhrases:['game changer']}});
  assert.deepEqual(setupCategories(config),subjects);
  const persona=setupPersona(config,'Author');
  assert.equal(persona.input.domain,describeCategories(subjects));
  assert.deepEqual(persona.builtFor,subjects);
  const style=setupStyle(config);
  assert.equal(style.structure,'bullets');assert.equal(style.minWords,80);assert.equal(style.maxWords,160);assert.equal(style.hashtagCount,0);
  assert.ok(styleBlock(style).includes('Explain the practical implications.'));
  assert.equal(setupStyle(defaultSetup).signature,null);
  assert.equal(parseSetup({...defaultSetup,voice:undefined}).voice,'professional');
  for(const categories of [[],['__proto__'],[subjects[0],subjects[0]],ALL_CATEGORY_IDS.slice(0,13)]) assert.throws(()=>parseSetup({...defaultSetup,categories}));
  for(const style of [{minWords:200,maxWords:100},{emoji:'always'},{bannedPhrases:['x'.repeat(81)]},{minWords:'80'}]) assert.throws(()=>parseSetup({...defaultSetup,style}));
  for(const industry of INDUSTRIES) assert.ok(industry.categories.every(isCategoryId));
  const great={persona_fit:10,category_fit:10,novelty:10,timeliness:10,non_duplication:10};
  assert.equal(relevanceTotal(great,subjects[0],subjects),10);
  for(const scores of [{...great,category_fit:6},{...great,persona_fit:5}]) assert.ok(relevanceTotal(scores,subjects[0],subjects)<PUBLISH_THRESHOLD,'novelty cannot override poor relevance');
  assert.ok(relevanceTotal(great,'finance',subjects)<PUBLISH_THRESHOLD);
  assert.ok(relevanceTotal(great,'invented',subjects)<PUBLISH_THRESHOLD);
  const realFetch=globalThis.fetch;
  const calls:string[]=[];
  globalThis.fetch=async input=>{
    const url=String(input);calls.push(url);
    return new Response(`<rss><channel><item><title>Solar energy research improves panel recycling</title><link>https://example.org/solar-research</link><description>Researchers tested a new process for recovering materials from retired solar panels in a controlled laboratory study.</description><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`);
  };
  try {
    const discovered=await discover({categories:[subjects[0]]});
    assert.equal(calls.length,2,'both search engines research the selected subject');
    assert.equal(new URL(calls[0]).searchParams.get('q'),'"Solar energy" when:7d');
    assert.equal(discovered[0].categoryHint,subjects[0]);
    assert.ok(discovered[0].summary.includes('solar panels'));
  } finally {globalThis.fetch=realFetch;}
  console.log(`Catalogue verified: ${ALL_CATEGORY_IDS.length} unique subjects, ${SUBJECT_GROUPS.length} specialist groups; discovery, relevance and voice persistence checks passed.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
