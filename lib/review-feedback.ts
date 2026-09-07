/** Client-safe preparation feedback: never expose raw provider/SQL errors. */
export interface ReviewAttempt {
  attempts: number;
  lease_until: Date | null;
  retry_at: Date;
  last_error: string | null;
}

export function reviewFeedback(attempt: ReviewAttempt | undefined, now = Date.now()) {
  if (attempt?.lease_until && attempt.lease_until.getTime() > now) {
    return {status: 409, body: {error: 'Your post is still being prepared. Refresh shortly to see it.', code: 'preparing'}};
  }
  const reason = attempt?.last_error ?? '';
  const code = reason === 'below_threshold' ? 'no_suitable_story'
    : reason === 'No suitable draft yet. The worker will retry.' ? 'previous_attempt'
    : reason === 'no_candidates' ? 'no_new_sources'
    : reason.includes('free_tier_verification_required') ? 'service_verification_required'
    : reason.includes('daily_ai_allowance_reached') ? 'daily_ai_limit'
    : reason.includes('all_models_failed_or_exhausted') ? 'writer_unavailable'
    : reason.startsWith('writer:') ? 'writing_failed'
    : reason.startsWith('judge:') ? 'source_review_failed'
    : reason === 'locked' ? 'preparation_busy' : 'preparation_unavailable';
  const descriptions: Record<string, string> = {
    previous_attempt: 'The previous attempt did not produce a draft. A new attempt has not started yet.',
    no_suitable_story: 'The available articles did not meet the quality bar for your topics.',
    no_new_sources: 'There are no new usable articles for your topics yet.',
    service_verification_required: 'ByLine’s free-tier service verification needs to be renewed by the operator.',
    daily_ai_limit: 'Your daily AI allowance has been reached. It resets with the provider’s next day.',
    writer_unavailable: 'The AI service is unavailable or its free allowance is temporarily exhausted.',
    writing_failed: 'The writer could not finish a usable draft.',
    source_review_failed: 'The AI service could not finish reviewing the source articles.',
    preparation_busy: 'Another preparation is already running.',
    preparation_unavailable: 'Preparation has not produced a draft yet.',
  };
  const waiting = !!attempt && attempt.retry_at.getTime() > now;
  const retry = attempt && attempt.attempts < 3
    ? waiting ? 'ByLine will retry in about ' + Math.max(1, Math.ceil((attempt.retry_at.getTime() - now) / 60000)) + ' minutes while the server is running.'
      : 'ByLine is due to retry while the server is running.'
    : waiting ? 'Automatic retries for today have ended. You can try again in about ' + Math.max(1, Math.ceil((attempt!.retry_at.getTime() - now) / 60000)) + ' minutes, or use Start a post.'
      : 'You can try again, or use Start a post to write your own.';
  return {status: waiting ? 429 : 503, body: {
    error: `${descriptions[code]} ${retry} Your settings are saved.`, code,
    retryAt: waiting ? attempt!.retry_at.toISOString() : null,
  }};
}
