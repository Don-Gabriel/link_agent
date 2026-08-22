/**
 * Typed LinkedIn API client. Modeled on the Breeth client in this codebase:
 * every function returns { ok: true, data } | { ok: false, reason } and NEVER
 * throws, so a LinkedIn outage degrades the product instead of crashing a
 * cycle.
 *
 * Scope: personal-profile posting via the versioned APIs.
 *   POST /rest/posts                      create a post as urn:li:person:{id}
 *   POST /rest/images?action=initializeUpload   register an image upload
 *   GET  /v2/userinfo                     OIDC identity -> person URN
 *   POST /oauth/v2/accessToken            authorization-code exchange
 *
 * Both versioned endpoints require Linkedin-Version (YYYYMM) and
 * X-Restli-Protocol-Version: 2.0.0. LinkedIn sunsets versions about a year
 * out, so the version lives in an env var — bumping it must never require a
 * code change.
 *
 * RETRY POLICY, deliberately asymmetric:
 *   - Reads and upload registration retry once on 5xx/network.
 *   - createPost NEVER retries. A timeout does not mean LinkedIn rejected the
 *     post; retrying is how you publish the same thing twice to a real human's
 *     profile. Ambiguity is escalated to a person (see lib/distribute.ts).
 */

export type LinkedInResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string; status?: number; needsReauth?: boolean; retryable?: boolean };

const AUTH_BASE = "https://www.linkedin.com/oauth/v2";
const API_BASE = "https://api.linkedin.com";

const TIMEOUT_MS = 12_000;
const UPLOAD_TIMEOUT_MS = 60_000;

/** Scopes for the two self-serve products: Sign In with LinkedIn (OIDC) + Share on LinkedIn. */
export const SCOPES = ["openid", "profile", "email", "w_member_social"] as const;

/** LinkedIn sunsets versioned APIs ~12 months out; override without a redeploy. */
export function apiVersion(): string {
  return process.env.LINKEDIN_API_VERSION ?? "202607";
}

/** Warn once the pinned version is this old. Sunset is ~12 months. */
const VERSION_WARN_MONTHS = 10;

/**
 * How old the pinned API version is, in months, and whether that is a problem.
 *
 * This is the one guaranteed breakage with no natural warning. The version is a
 * YYYYMM string frozen in an environment variable, LinkedIn retires versions
 * about a year after release, and the day it happens every publish starts
 * failing with a version error — an alert that arrives strictly AFTER a post
 * did not go out.
 *
 * Ten months gives two months to bump one variable, which is the entire fix.
 * Returns null if the pin is unparseable, which is not worth an alarm: a
 * malformed version fails loudly on the very next request anyway.
 */
export function apiVersionAge(): { version: string; months: number; stale: boolean } | null {
  const version = apiVersion();
  const match = /^(\d{4})(\d{2})$/.exec(version);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  const now = new Date();
  const months =
    (now.getUTCFullYear() - year) * 12 + (now.getUTCMonth() + 1 - month);
  return { version, months, stale: months >= VERSION_WARN_MONTHS };
}

function versionedHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": apiVersion(),
    "X-Restli-Protocol-Version": "2.0.0",
    "Content-Type": "application/json",
  };
}

async function withTimeout<T>(
  ms: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Map a failed response to a structured reason. 401 is the re-auth signal. */
async function toFailure(res: Response): Promise<Extract<LinkedInResult<never>, { ok: false }>> {
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 400);
  } catch {
    /* body already consumed or unreadable — status alone is enough */
  }
  return {
    ok: false,
    status: res.status,
    reason: `http_${res.status}${detail ? `: ${detail}` : ""}`,
    // 401 means the 60-day token expired or was revoked: a human must reconnect.
    needsReauth: res.status === 401,
    retryable: res.status >= 500 || res.status === 429,
  };
}

function toNetworkFailure(err: unknown): Extract<LinkedInResult<never>, { ok: false }> {
  const message = String((err as Error)?.message ?? err);
  return {
    ok: false,
    reason: message === "The operation was aborted." ? "timeout" : `network: ${message}`,
    retryable: true,
  };
}

// ------------------------------------------------------------------ little text

/**
 * Reserved characters in LinkedIn's "little" text format. EVERY one of these
 * must be backslash-escaped in commentary even when it is not being used as
 * markup — an unescaped parenthesis in ordinary prose is enough to corrupt or
 * reject a post, which is why no caller is trusted to remember this.
 */
const RESERVED = ["\\", "|", "{", "}", "@", "[", "]", "(", ")", "<", ">", "#", "*", "_", "~"];

function escapeLittle(text: string): string {
  let out = text;
  // Backslash FIRST — escaping it after the others would double-escape them.
  for (const ch of RESERVED) {
    out = out.split(ch).join(`\\${ch}`);
  }
  return out;
}

/**
 * Convert plain post text into little format, preserving intended hashtags.
 *
 * A literal "#tag" escaped to "\#tag" renders as inert text — to get a real
 * clickable hashtag LinkedIn requires the {hashtag|\#|tag} template. So
 * hashtag tokens are lifted out before escaping and re-inserted as templates.
 * Only [A-Za-z0-9] tags qualify; anything else stays plain text.
 */
export function toLittleText(text: string): string {
  const parts: string[] = [];
  const pattern = /(^|\s)#([A-Za-z0-9]+)\b/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    parts.push(escapeLittle(text.slice(last, match.index + match[1].length)));
    parts.push(`{hashtag|\\#|${match[2]}}`);
    last = match.index + match[0].length;
  }
  parts.push(escapeLittle(text.slice(last)));
  return parts.join("");
}

// ------------------------------------------------------------------------ oauth

export function authorizeUrl(state: string, redirectUri: string): string | null {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) return null;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: SCOPES.join(" "),
  });
  return `${AUTH_BASE}/authorization?${params.toString()}`;
}

export interface TokenGrant {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken?: string;
  scope?: string;
}

async function tokenRequest(body: URLSearchParams): Promise<LinkedInResult<TokenGrant>> {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { ok: false, reason: "missing_linkedin_client_credentials" };
  }
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);

  try {
    const res = await withTimeout(TIMEOUT_MS, (signal) =>
      fetch(`${AUTH_BASE}/accessToken`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal,
      }),
    );
    if (!res.ok) return await toFailure(res);
    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      scope?: string;
    };
    if (!json.access_token || typeof json.expires_in !== "number") {
      return { ok: false, reason: "token_response_malformed" };
    }
    return {
      ok: true,
      data: {
        accessToken: json.access_token,
        expiresInSeconds: json.expires_in,
        refreshToken: json.refresh_token,
        scope: json.scope,
      },
    };
  } catch (err) {
    return toNetworkFailure(err);
  }
}

export function exchangeCode(code: string, redirectUri: string): Promise<LinkedInResult<TokenGrant>> {
  return tokenRequest(
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  );
}

/**
 * Only usable by apps approved for programmatic refresh tokens (Marketing
 * Developer Platform partners). A standard self-serve app never receives a
 * refresh_token, so this exists for the day the app is approved — callers must
 * treat "no refresh token stored" as the normal case, not an error.
 */
export function refreshAccessToken(refreshToken: string): Promise<LinkedInResult<TokenGrant>> {
  return tokenRequest(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  );
}

// --------------------------------------------------------------------- identity

export interface MemberIdentity {
  personUrn: string;
  name?: string;
  picture?: string;
  email?: string;
}

/** OIDC userinfo. `sub` is the member id; the Posts author URN is urn:li:person:{sub}. */
export async function getMemberIdentity(token: string): Promise<LinkedInResult<MemberIdentity>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await withTimeout(TIMEOUT_MS, (signal) =>
        fetch(`${API_BASE}/v2/userinfo`, {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        }),
      );
      if (!res.ok) {
        const failure = await toFailure(res);
        if (failure.retryable && attempt === 0) continue;
        return failure;
      }
      const json = (await res.json()) as {
        sub?: string;
        name?: string;
        picture?: string;
        email?: string;
      };
      if (!json.sub) return { ok: false, reason: "userinfo_missing_sub" };
      return {
        ok: true,
        data: {
          personUrn: `urn:li:person:${json.sub}`,
          name: json.name,
          picture: json.picture,
          email: json.email,
        },
      };
    } catch (err) {
      if (attempt === 0) continue;
      return toNetworkFailure(err);
    }
  }
  return { ok: false, reason: "userinfo_failed" };
}

// ------------------------------------------------------------------------ media

export interface RegisteredImage {
  imageUrn: string;
  uploadUrl: string;
}

/** Step 1 of an image upload: register it and get a signed upload URL back. */
export async function initializeImageUpload(
  token: string,
  ownerUrn: string,
): Promise<LinkedInResult<RegisteredImage>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await withTimeout(TIMEOUT_MS, (signal) =>
        fetch(`${API_BASE}/rest/images?action=initializeUpload`, {
          method: "POST",
          headers: versionedHeaders(token),
          body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn } }),
          signal,
        }),
      );
      if (!res.ok) {
        const failure = await toFailure(res);
        if (failure.retryable && attempt === 0) continue;
        return failure;
      }
      const json = (await res.json()) as { value?: { uploadUrl?: string; image?: string } };
      if (!json.value?.uploadUrl || !json.value.image) {
        return { ok: false, reason: "initialize_upload_malformed" };
      }
      return { ok: true, data: { imageUrn: json.value.image, uploadUrl: json.value.uploadUrl } };
    } catch (err) {
      if (attempt === 0) continue;
      return toNetworkFailure(err);
    }
  }
  return { ok: false, reason: "initialize_upload_failed" };
}

/**
 * Step 2: PUT the bytes to the signed URL.
 *
 * This runs server-side on purpose. Letting the browser upload directly would
 * mean handing it the access token — that token can post as the member for 60
 * days. Instead the client downsizes images before sending them here, which
 * also keeps requests under the ~4.5MB serverless body cap.
 */
export async function uploadImageBytes(
  token: string,
  uploadUrl: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<LinkedInResult<null>> {
  try {
    const res = await withTimeout(UPLOAD_TIMEOUT_MS, (signal) =>
      fetch(uploadUrl, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
        body: bytes,
        signal,
      }),
    );
    if (!res.ok) return await toFailure(res);
    return { ok: true, data: null };
  } catch (err) {
    return toNetworkFailure(err);
  }
}

// ------------------------------------------------------------------------ posts

export interface PostImage {
  imageUrn: string;
  altText?: string;
}

export interface CreatePostArgs {
  token: string;
  authorUrn: string;
  /** Plain text. Escaped into little format here so no call site can forget. */
  text: string;
  images?: PostImage[];
  visibility?: "PUBLIC" | "CONNECTIONS";
}

/** LinkedIn's own limit on commentary length. */
export const MAX_COMMENTARY = 3000;
const MAX_MULTI_IMAGE = 20;

function buildContent(images: PostImage[]): Record<string, unknown> | undefined {
  if (images.length === 0) return undefined;
  if (images.length === 1) {
    return { media: { id: images[0].imageUrn, altText: images[0].altText ?? "" } };
  }
  return {
    multiImage: {
      images: images.slice(0, MAX_MULTI_IMAGE).map((i) => ({
        id: i.imageUrn,
        altText: i.altText ?? "",
      })),
    },
  };
}

/**
 * Create the post. NO RETRIES — see the file header. A caller that receives a
 * network failure here must treat the outcome as UNKNOWN, not as "failed".
 */
export async function createPost(
  args: CreatePostArgs,
): Promise<LinkedInResult<{ postUrn: string }>> {
  const commentary = toLittleText(args.text);
  if (commentary.length > MAX_COMMENTARY) {
    // Escaping expands the text, so the check has to happen on the escaped
    // form — the caller's 3000-char plaintext can still overflow here.
    return { ok: false, reason: `commentary_too_long_after_escaping:${commentary.length}` };
  }

  const body: Record<string, unknown> = {
    author: args.authorUrn,
    commentary,
    visibility: args.visibility ?? "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  const content = buildContent(args.images ?? []);
  if (content) body.content = content;

  try {
    const res = await withTimeout(TIMEOUT_MS, (signal) =>
      fetch(`${API_BASE}/rest/posts`, {
        method: "POST",
        headers: versionedHeaders(args.token),
        body: JSON.stringify(body),
        signal,
      }),
    );
    if (!res.ok) return await toFailure(res);
    // The post URN comes back in a header, not the body.
    const postUrn = res.headers.get("x-restli-id") ?? res.headers.get("X-RestLi-Id");
    if (!postUrn) return { ok: false, reason: "created_but_no_urn_header" };
    return { ok: true, data: { postUrn } };
  } catch (err) {
    return toNetworkFailure(err);
  }
}

/** Public permalink for a created post URN. */
export function postPermalink(postUrn: string): string {
  return `https://www.linkedin.com/feed/update/${postUrn}/`;
}
