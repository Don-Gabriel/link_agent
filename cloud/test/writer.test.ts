import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writePost,writerOutputBudget,type WriteArgs} from '../../lib/writer-core';
import {defaultSetup,setupPersona} from '../../lib/setup-config';
import {DEFAULT_STYLE} from '../../lib/style';
import {critique} from '../../lib/critique';

const style={...DEFAULT_STYLE,minWords:400,maxWords:500,hashtagCount:9};
const args:WriteArgs={
  persona:setupPersona(defaultSetup,'Test author'),style,repairAttempts:2,
  winner:{title:'Source-backed engineering',url:'https://example.com/story',summary:'Evidence about software.',source:'test',categoryHint:'dev-tooling',category:'dev-tooling',reason:'Relevant',total:8,scores:{persona_fit:8,category_fit:8,novelty:8,timeliness:8,non_duplication:8}},
  runnersUp:[],memory:{facts:[],source:'none',degraded:false},priorPosts:[],
};
const draft=(words:number)=>({text:'A clear opening. '+Array(words-3).fill('code').join(' '),rationale:'This source supports a concrete engineering discussion without adding unsupported personal claims.',fingerprint:'engineering evidence and practical software evaluation',continuity:null,hashtags:Array.from({length:9},(_,i)=>`Topic${i}`),used_quote:false});

test('the repair gate checks the complete post length including its source and tags',async()=>{
  const overlong={...draft(410),text:'A clear opening. '+Array(407).fill('evidence').join(' ')};
  let calls=0;
  const result=await writePost(async request=>{
    if(calls)assert.match(request.system,/2400 characters/);
    return {ok:true,text:JSON.stringify(calls++?draft(410):overlong),model:'test'};
  },args);
  assert.ok(result.ok);assert.equal(calls,2);
  assert.equal(result.data.text,draft(410).text);
  assert.ok(critique(draft(410).text,style,{hashtags:draft(410).hashtags,sourceUrl:'https://example.com/'+ 'a'.repeat(1100)}).some(v=>v.rule==='linkedin_length'));
});

test('long drafts receive enough output budget and a second bounded repair can finish them',async()=>{
  let calls=0;
  const result=await writePost(async request=>{
    assert.equal(request.maxOutputTokens,writerOutputBudget(style));
    assert.ok(request.maxOutputTokens!>1536);
    return {ok:true,text:JSON.stringify(draft([330,380,420][calls++])),model:'test'};
  },args);
  assert.equal(calls,3);
  assert.ok(result.ok);
  assert.deepEqual(critique(result.data.text,style,{hashtags:result.data.hashtags,usedQuote:result.data.used_quote}),[]);
});

test('unsuccessful repairs stay bounded and preserve the better draft',async()=>{
  let calls=0;
  const result=await writePost(async()=>({ok:true,text:JSON.stringify(draft([380,300,340][calls++])),model:'test'}),args);
  assert.equal(calls,3);
  assert.ok(result.ok);
  assert.equal(result.data.text,draft(380).text);
});
