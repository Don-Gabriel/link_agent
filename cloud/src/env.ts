/** Secret names are intentionally absent from wrangler vars and source values. */
export interface Secrets {
  APP_SECRET:string;
  TOKEN_ENCRYPTION_KEY:string;
  LINKEDIN_CLIENT_ID:string;
  LINKEDIN_CLIENT_SECRET:string;
  GOOGLE_CLIENT_ID?:string;
  GOOGLE_CLIENT_SECRET?:string;
  GEMINI_API_KEY:string;
  FCM_SERVICE_ACCOUNT_JSON?:string;
  LINKEDIN_LIVE?:string;
}
export type AppEnv=Env & Secrets;
