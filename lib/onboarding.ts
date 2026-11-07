import { query } from './db';
import { getAccountStatus } from './accounts';
import { CATEGORIES, ALL_CATEGORY_IDS, isCategoryId, MAX_SELECTED_CATEGORIES, describeCategories, type CategoryId } from './categories';
import { SUBJECT_GROUPS, subjectId } from './category-catalogue';
import { discover } from './discovery';
import { judgeCandidates, PUBLISH_THRESHOLD } from './judge';
import { writePost } from './writer';
import { critique } from './critique';
import type { PersonaRecord } from './persona';
import { localTestMode } from './native-auth';
import { isValidTimeZone, normalizeHhMm, nextDailyRun, localClock } from './schedule';
import { parseStyle, type StyleConfig } from './style';

export * from './setup-config';
import { INDUSTRIES, VOICES, defaultSetup, setupCategories, setupPersona, setupStyle, type SetupConfig } from './setup-config';
export interface Sample {text:string;sources:string[];title:string;testMode:boolean}
export async function generateSetupSample(c:SetupConfig, name = 'The author'):Promise<Sample> {
  if(localTestMode()) return {text:`${c.voice==='punchy'?'Start small. Measure what changes.':`A useful question about ${c.topics[0]}: what would make this better for the people using it?`}\n\nAcross ${c.topics.slice(1).join(' and ')}, a clear goal matters more than adding another tool. Define one outcome, try a small change, and ask the people affected what improved.\n\nKeep the evidence. Change what did not work. That makes the next decision easier.`,sources:['https://www.oecd.org/en/topics/digital-transformation.html'],title:'Local demonstration — not a live article-based Gemini draft',testMode:true};
  const categories=setupCategories(c);
  const candidates=(await discover({categories})).filter(s=>s.summary.length>80&&/^https?:\/\//.test(s.url));
  const persona=setupPersona(c,name);
  const memory={facts:[],source:'none' as const,degraded:false};
  const judged=await judgeCandidates(persona,categories,candidates,memory,[]);
  if (!judged.ok) throw new Error('We could not prepare a relevant sample right now. Your preferences are saved; please try again.');
  const source=judged.data.scored.find(s=>s.total>=PUBLISH_THRESHOLD);
  if (!source) throw new Error('No source closely matches your subjects yet. Your preferences are saved; try again later or adjust your subjects.');
  const style=setupStyle(c);
  const r=await writePost({persona,style,winner:source,runnersUp:[],memory,priorPosts:[],samples:c.samples.map(text=>({text,origin:'corpus'}))});
  if(!r.ok) throw new Error('The writer is temporarily unavailable. Your settings are saved; please try again.');
  const text=r.data.text.trim();
  if(critique(text,style,{hashtags:r.data.hashtags,usedQuote:r.data.used_quote}).length) throw new Error('The sample needs another pass to match your writing preferences. Please try again.');
  return {text: text + (r.data.hashtags.length ? '\n\n' + r.data.hashtags.map(tag=>'#'+tag).join(' ') : ''),sources:[source.url],title:source.title,testMode:false};
}
export async function setupStatus(userId:string) {
  const [row]=await query<{config:Partial<SetupConfig>;revision:number;preview:Sample|null;preview_revision:number|null;accepted_revision:number|null;completed_at:Date|null;next_delivery_at:Date|null}>(`SELECT * FROM onboarding WHERE user_id=$1`,[userId]);
  if(!row) throw new Error('Setup is unavailable. Sign in again.');
  const [agent]=await query<{id:string}>('SELECT id FROM agents WHERE owner_id=$1',[userId]);
  if(row.completed_at) {
    const [next]=await query<{at:Date|null}>('SELECT min(next_run_at) AS at FROM post_slots WHERE agent_id=$1 AND enabled',[agent.id]);
    row.next_delivery_at=next?.at??null;
  }
  const config={...defaultSetup,...row.config};
  return {...row,config,nextDeliveryLabel:row.next_delivery_at?`${localClock(config.timezone,row.next_delivery_at).date} at ${config.time} (${config.timezone})`:null,account:await getAccountStatus(agent.id),industries:INDUSTRIES,voices:VOICES,categories:ALL_CATEGORY_IDS.map(id=>CATEGORIES[id]),testMode:localTestMode()};
}
