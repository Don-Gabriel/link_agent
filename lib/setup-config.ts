import { isCategoryId, MAX_SELECTED_CATEGORIES, describeCategories, type CategoryId } from './categories';
import { SUBJECT_GROUPS, subjectId } from './category-catalogue';
import type { PersonaRecord } from './persona-prompt';
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
export function firstDelivery(c:SetupConfig, now=new Date()) {
  // Tomorrow in the author's calendar, even if today's time has not passed.
  const today=localClock(c.timezone,now).date;
  let next=nextDailyRun(c.timezone,c.time,now);
  if(localClock(c.timezone,next).date===today) next=nextDailyRun(c.timezone,c.time,next);
  return next;
}
