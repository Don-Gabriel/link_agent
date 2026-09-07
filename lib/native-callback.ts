import { nativeReturnUri } from './native-return';

/** No credentials travel in the app link. Completion remains verifier-protected. */
export function nativeCallbackPage(ok = true, returnUri?: string | null) {
  const desktop = nativeReturnUri(returnUri);
  const target = desktop ?? 'intent://auth-complete#Intent;scheme=byline;package=com.linkdin.byline;end';
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${desktop ? `<meta http-equiv="refresh" content="1;url=${desktop}">` : ''}<title>Return to ByLine</title><style>body{background:#f3f2ef;color:#191919;font:16px/1.6 system-ui;margin:0;padding:32px}main{background:#fff;border:1px solid #d8d8d8;border-radius:12px;max-width:480px;margin:12vh auto;padding:32px}h1{font-size:24px}a{display:inline-block;background:#0a66c2;color:#fff;padding:12px 24px;border-radius:24px;text-decoration:none;font-weight:600}a:focus-visible{outline:3px solid #191919;outline-offset:4px}</style></head><body><main><h1>${ok ? 'Ready to return to ByLine' : 'Sign-in could not be completed'}</h1><p>${ok ? 'Your sign-in has been processed. Continue in the app.' : 'This attempt was cancelled, expired or could not be verified. Return to the app and try again.'}</p><a href="${target}">Return to ByLine</a><p>${desktop ? 'Opening your desktop app. If your browser asks, allow this page to reach the app on this computer.' : 'On Android, tap above. On desktop, switch back to the ByLine application.'}</p></main></body></html>`, {
    status: ok ? 200 : 400,
    headers: {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"},
  });
}
