/** Expose actionable failures without leaking database queries or provider responses. */
export function generationStatus(error:unknown):number {
  const message=error instanceof Error?error.message:'';
  if(['ai_allowance_or_pacing_limit','provider_quota_reached','ai_invocation_budget','daily_ai_allowance_reached','ai_busy','ai_retry_later','ai_circuit_open'].includes(message))return 429;
  if(message==='ai_access_disabled')return 403;
  if(['no_candidates','No source closely matches your subjects yet. Try again later or adjust your subjects.',
    'No suitable story cleared the relevance checks.','The sample needs another pass to match your writing preferences.',
    'The draft needs another pass to match your writing preferences.'].includes(message))return 422;
  return 503;
}

export function generationError(error:unknown) {
  const message=error instanceof Error?error.message:'';
  const safe=new Set([
    'Preparation stopped because settings changed or ByLine was paused.',
    'The posting time changed.',
    'No source closely matches your subjects yet. Try again later or adjust your subjects.',
    'No suitable story cleared the relevance checks.',
    'The sample needs another pass to match your writing preferences.',
    'The draft needs another pass to match your writing preferences.',
  ]);
  if(safe.has(message))return message;
  if(message==='daily_ai_allowance_reached')return 'Your AI usage allowance has been reached. Please try again after the daily reset.';
  if(message==='ai_access_disabled')return 'AI generation is not enabled for this account. Please check your plan.';
  if(['ai_busy','ai_retry_later','ai_circuit_open','provider_overloaded'].includes(message))return 'The writing service is busy. Your saved content is unchanged; please try again shortly.';
  if(['ai_allowance_or_pacing_limit','provider_quota_reached','ai_invocation_budget'].includes(message))return 'The AI allowance is temporarily exhausted. Please try again later.';
  if(message==='no_candidates')return 'No recent sources are available for these subjects. Please try again later.';
  if(message==='ai_deadline_exceeded'||message==='provider_timeout')return 'Preparation took too long. Please try again shortly.';
  if(message==='provider_unavailable'||/^provider_http_5\d\d$/.test(message))return 'The AI service is temporarily unavailable. Your content is saved; please try again later.';
  return 'Preparation could not finish. Your saved content is unchanged; please try again later.';
}
