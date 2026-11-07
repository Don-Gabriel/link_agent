export interface DraftInput {
  agentId: string;
  requestId: string;
  text: string;
  rationale: string;
  fingerprint: string;
  sources: unknown[];
  slotId?: string;
  slotDate?: string;
  category?:string;
  hashtags?:string[];
  media?:string[];
  scores?:unknown;
  continuity?:string|null;
  usedQuote?:boolean;
  scheduledFor?:string|null;
  cleared?:boolean;
  agentRevision?:number;
  slotRevision?:number;
  /** Generated stories cannot reuse a source saved by a concurrent job. */
  avoidUsedSources?:boolean;
}

/** Allocation and insert commit together; retries return the original draft. */
export async function saveDraft(db: D1Database, draft: DraftInput) {
  if (!draft.requestId || !draft.text.trim()) throw new Error('Draft identity and text are required');
  if (!!draft.slotId !== !!draft.slotDate) throw new Error('Slot identity needs a date');
  const prior = `SELECT seq FROM posts WHERE agent_id=? AND (client_request_id=?
    OR (? IS NOT NULL AND slot_id=? AND slot_date=?))`;
  const priorArgs = [draft.agentId, draft.requestId, draft.slotId ?? null, draft.slotId ?? null, draft.slotDate ?? null];
  const guard=`(? IS NULL OR EXISTS(SELECT 1 FROM agents WHERE id=? AND revision=? AND active=1 AND paused=0))
    AND (? IS NULL OR EXISTS(SELECT 1 FROM post_slots WHERE id=? AND agent_id=? AND revision=? AND enabled=1))
    AND (?=0 OR NOT EXISTS(SELECT 1 FROM posts p,json_each(p.sources_json) old,json_each(?) fresh WHERE p.agent_id=? AND old.value=fresh.value))`;
  const guardArgs=[draft.agentRevision??null,draft.agentId,draft.agentRevision??null,draft.slotRevision??null,draft.slotId??null,draft.agentId,draft.slotRevision??null,
    draft.avoidUsedSources?1:0,JSON.stringify(draft.sources),draft.agentId];
  const result = await db.batch([
    db.prepare(`INSERT INTO post_counters(agent_id,value)
      SELECT ?,COALESCE(MAX(seq),0)+1 FROM posts WHERE agent_id=? HAVING NOT EXISTS(${prior}) AND ${guard}
      ON CONFLICT(agent_id) DO UPDATE SET value=MAX(post_counters.value+1,excluded.value)`)
      .bind(draft.agentId, draft.agentId, ...priorArgs,...guardArgs),
    db.prepare(`INSERT INTO posts(agent_id,seq,text,rationale,sources_json,fingerprint,status,kind,client_request_id,slot_id,slot_date,
      category,hashtags_json,media_json,scores_json,continuity,used_quote,scheduled_for,cleared_at)
      SELECT ?,value,?,?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,?,? FROM post_counters WHERE agent_id=? AND NOT EXISTS(${prior}) AND ${guard}`)
      .bind(draft.agentId, draft.text, draft.rationale, JSON.stringify(draft.sources), draft.fingerprint,
        draft.slotId ? 'auto' : 'custom', draft.requestId, draft.slotId ?? null, draft.slotDate ?? null,
        draft.category??null,JSON.stringify(draft.hashtags??[]),JSON.stringify(draft.media??[]),draft.scores?JSON.stringify(draft.scores):null,
        draft.continuity??null,draft.usedQuote?1:0,draft.scheduledFor??null,draft.cleared?new Date().toISOString():null,draft.agentId, ...priorArgs,...guardArgs),
    db.prepare(prior).bind(...priorArgs),
  ]);
  const row = result[2].results[0] as { seq: number } | undefined;
  if (!row) throw new Error('Draft was not saved');
  return row.seq;
}
