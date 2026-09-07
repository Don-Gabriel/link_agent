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

export const INDUSTRIES = [
  {id:'tech',label:'Technology',categories:['emerging-tech','ai-ml','dev-tooling'],topics:['AI','Software development','Emerging technology','Product building','Open source']},
  {id:'marketing',label:'Marketing',categories:['marketing'],topics:['Content strategy','Brand building','Customer experience','Growth','Research']},
  {id:'hr',label:'People & HR',categories:['hr'],topics:['Hiring','Leadership','Workplace culture','Learning','Employee experience']},
  {id:'finance',label:'Finance',categories:['finance'],topics:['Economic trends','Financial technology','Banking','Business finance','Financial literacy']},
  {id:'healthcare',label:'Healthcare',categories:['healthcare'],topics:['Public health','Health technology','Care delivery','Research','Prevention']},
  {id:'business',label:'Business',categories:['business'],topics:['Entrepreneurship','Strategy','Leadership','Customers','Operations']},
  ...SUBJECT_GROUPS.map(([id, label, subjects]) => ({id, label,
    categories: subjects.split('|').slice(0, 3).map(subject => subjectId(id, subject)),
    topics: subjects.split('|')})),
] as const;
export const VOICES = ['professional','conversational','storyteller','punchy','analytical','educational','reflective','warm','witty','inspirational'] as const;
export interface SetupConfig {industry:string;topics:string[];categories?:CategoryId[];voice:string;voiceNotes?:string;style?:Partial<StyleConfig>;samples:string[];timezone:string;time:string;notifications:string}
export const defaultSetup:SetupConfig={industry:'tech',topics:['AI','Software development','Emerging technology'],voice:'professional',samples:[],timezone:'UTC',time:'09:00',notifications:'not_requested'};
export function parseSetup(v:unknown):SetupConfig {
  const b=v as Partial<SetupConfig>;
  if (!b || typeof b!=='object' || !INDUSTRIES.some(i=>i.id===b.industry)) throw new Error('Choose an industry.');
  if (!Array.isArray(b.topics)||b.topics.length<1||b.topics.length>12||b.topics.some(t=>typeof t!=='string'||t.trim().length<2||t.length>80)) throw new Error('Choose 1–12 topics.');
  if (new Set(b.topics.map(t=>t.trim().toLowerCase())).size!==b.topics.length) throw new Error('Choose distinct topics.');
  if (b.voice !== undefined && !VOICES.some(v=>v===b.voice)) throw new Error('Choose a voice.');
  if (b.categories !== undefined && (!Array.isArray(b.categories) || b.categories.length < 1 || b.categories.length > MAX_SELECTED_CATEGORIES || b.categories.some(id => !isCategoryId(id)) || new Set(b.categories).size !== b.categories.length)) throw new Error('Choose 1–12 distinct subjects from the catalogue.');
  if (b.style !== undefined && (!b.style || typeof b.style !== 'object' || Array.isArray(b.style))) throw new Error('Check your writing preferences.');
  if (b.style) {
    const normalized=parseStyle(b.style);
    for (const key of ['structure','emoji','hook','cta','register','minWords','maxWords','hashtagCount'] as const) {
      if (b.style[key] !== undefined && b.style[key] !== normalized[key]) throw new Error('Check your writing preferences and word range.');
    }
    if (b.style.bannedPhrases !== undefined && (!Array.isArray(b.style.bannedPhrases) || b.style.bannedPhrases.length>40 || b.style.bannedPhrases.some(v=>typeof v!=='string'||v.trim().length>80))) throw new Error('Use up to 40 phrases to avoid, each up to 80 characters.');
  }
  if (b.voiceNotes !== undefined && (typeof b.voiceNotes !== 'string' || b.voiceNotes.length > 1200)) throw new Error('Describe your voice in up to 1200 characters.');
  if (!Array.isArray(b.samples)||b.samples.length>3||b.samples.some(s=>typeof s!=='string'||s.trim().length<80||s.length>2400)) throw new Error('Use up to three post samples, each 80–2400 characters.');
  if (typeof b.timezone!=='string'||!isValidTimeZone(b.timezone)) throw new Error('Choose a valid timezone.');
  const time=typeof b.time==='string'?normalizeHhMm(b.time):null;
  if (!time) throw new Error('Choose a delivery time.');
  return {...defaultSetup,...b,voice:b.voice??defaultSetup.voice,topics:b.topics.map(t=>t.trim()),samples:b.samples.map(s=>s.trim()),time,
    notifications:['enabled','denied','unavailable','later'].includes(b.notifications??'')?b.notifications!:'not_requested'} as SetupConfig;
}
export function setupStyle(c:SetupConfig) {
  return parseStyle({signature:null,register:c.voice==='professional'?'practitioner':'peer',
    structure:c.voice==='punchy'?'short-lines':'prose',minWords:c.voice==='punchy'?60:100,maxWords:c.voice==='punchy'?140:200,
    ...c.style,
    customRules:[`Use a ${c.voice} tone.`, 'Never invent personal experiences, credentials, results or opinions.',
      ...(c.voiceNotes?.match(/[\s\S]{1,240}/g) ?? [])]});
}
export function setupCategories(c: SetupConfig): CategoryId[] {
  return c.categories?.length ? c.categories : [...INDUSTRIES.find(i=>i.id===c.industry)!.categories];
}
export function setupPersona(c:SetupConfig,name:string): PersonaRecord & {managed:true} {
  return {input:{name,domain:describeCategories(setupCategories(c))},managed:true,builtFor:setupCategories(c),identity:{voice:`${c.voice}. ${c.voiceNotes ?? ''} Never invent the author's experiences or opinions.`,interests:c.topics,opinions:[],skeptical_of:['Unsubstantiated claims']},generator:'fallback'};
}
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
export function firstDelivery(c:SetupConfig, now=new Date()) {
  // Tomorrow in the author's calendar, even if today's time has not passed.
  const today=localClock(c.timezone,now).date;
  let next=nextDailyRun(c.timezone,c.time,now);
  if(localClock(c.timezone,next).date===today) next=nextDailyRun(c.timezone,c.time,next);
  return next;
}
