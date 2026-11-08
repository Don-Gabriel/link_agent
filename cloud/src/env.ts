/** Secret names are intentionally absent from wrangler vars and source values. */
export interface Secrets {
  APP_SECRET:string;
  TOKEN_ENCRYPTION_KEY:string;
  LINKEDIN_CLIENT_ID:string;
  LINKEDIN_CLIENT_SECRET:string;
  GOOGLE_CLIENT_ID?:string;
  GOOGLE_CLIENT_SECRET?:string;
  GEMINI_API_KEY?:string;
  AI_PROVIDER?:'gemini'|'compatible'|'workers-ai';
  AI_BASE_URL?:string;
  AI_MODEL?:string;
  AI_SERVICE_TOKEN?:string;
  AI_TIMEOUT_MS?:string;
  AI_MAX_INPUT_BYTES?:string;
  AI_MAX_OUTPUT_TOKENS?:string;
  AI_DISABLE_THINKING?:string;
  AI_ALLOW_LOCAL_HTTP?:string;
  AI_MAX_CONCURRENCY?:string;
  AI_DAILY_ATTEMPT_LIMIT?:string;
  AI_ACTIVE_JOBS?:string;
  AI_REQUIRE_REVIEW?:string;
  FCM_SERVICE_ACCOUNT_JSON?:string;
  LINKEDIN_LIVE?:string;
}
// Legacy deployments and isolated tests may not yet have the optional AI binding.
export type AppEnv=Omit<Env,'AI'|keyof Secrets> & {AI?:Env['AI']} & Secrets;
