/** Expose actionable failures without leaking database queries or provider responses. */
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
  if(['ai_allowance_or_pacing_limit','provider_quota_reached','ai_invocation_budget'].includes(message))return 'The AI allowance is temporarily exhausted. Please try again later.';
  if(message==='no_candidates')return 'No recent sources are available for these subjects. Please try again later.';
  if(message==='provider_unavailable'||/^provider_http_5\d\d$/.test(message))return 'The AI service is temporarily unavailable. Your content is saved; please try again later.';
  return 'Preparation could not finish. Your saved content is unchanged; please try again later.';
}
