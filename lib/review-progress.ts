import { query } from './db';
import { reviewFeedback, type ReviewAttempt } from './review-feedback';

/** Milestones completed, not a prediction of elapsed time or generated tokens. */
export async function reviewProgress(agentId: string, day: string) {
  const [post] = await query<{seq:number}>('SELECT seq FROM posts WHERE agent_id=$1 AND review_date=$2',[agentId,day]);
  if (post) return {state:'ready',stage:'ready',completed:4,total:4,seq:post.seq,
    message:'Your post is ready to review.'};
  const [attempt] = await query<ReviewAttempt & {stage:string|null}>(
    'SELECT attempts,lease_until,retry_at,last_error,stage FROM review_deliveries WHERE agent_id=$1 AND delivery_date=$2',[agentId,day]);
  if (!attempt) return {state:'idle',stage:null,completed:0,total:4};
  const stages = ['discovering','judging','writing','saving'];
  const completed = Math.max(0,stages.indexOf(attempt.stage??''));
  const active = (attempt.lease_until?.getTime()??0)>Date.now();
  if (active) return {state:'working',stage:attempt.stage??'discovering',completed,total:4};
  const retrying = attempt.attempts<3;
  return {state:retrying?'waiting':'paused',stage:attempt.stage,completed,total:4,
    retryAt:retrying?attempt.retry_at.toISOString():null,
    message:reviewFeedback(attempt).body.error};
}
