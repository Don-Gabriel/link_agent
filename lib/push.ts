/**
 * Push notifications to the phone, via Firebase Cloud Messaging.
 *
 * FCM is free at any volume this app will ever reach, and it is the only way to
 * reach an Android app that is not currently running. The alternative — the app
 * polling — cannot work, because the whole point is to hear about a failure on
 * a day you never opened it.
 *
 * No SDK. The HTTP v1 API wants a Google OAuth2 access token, and that is a
 * signed JWT exchanged for a bearer token: about forty lines with Web Crypto,
 * against a dependency tree that has to keep building for years. The private
 * key is a service-account key from the Firebase console, held in env vars.
 *
 * Everything here fails SOFT. A notification that cannot be sent is logged and
 * forgotten — it must never fail a cycle, block a publish, or throw into a
 * route. The post going out matters; being told about it does not.
 */
import { query } from "./db";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

export function pushConfigured(): boolean {
  return !!(process.env.FCM_PROJECT_ID && process.env.FCM_CLIENT_EMAIL && process.env.FCM_PRIVATE_KEY);
}

// ------------------------------------------------------------ access tokens

interface CachedToken {
  value: string;
  expiresAt: number;
}

/**
 * Cached on globalThis for the same reason the pg Pool is: `next dev`
 * re-evaluates modules constantly, and a lambda that re-mints a token on every
 * message pays an extra round trip to Google for nothing. Tokens last an hour.
 */
const g = globalThis as unknown as { __linkdinPushToken?: CachedToken | null };

/**
 * PEM (PKCS#8) to the raw DER bytes crypto.subtle wants.
 *
 * Exported for the selftest. The service-account key is pasted by hand into an
 * environment variable, and every way of getting that wrong fails with the same
 * unhelpful "invalid key" from crypto.subtle — so which formats are tolerated
 * is worth pinning down in a test rather than discovering in production.
 */
export function pemToBytes(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function base64url(input: string | Uint8Array): string {
  const binary =
    typeof input === "string" ? input : String.fromCharCode(...Array.from(input));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function mintAccessToken(): Promise<string | null> {
  const clientEmail = process.env.FCM_CLIENT_EMAIL;
  // Env vars cannot carry real newlines, so the key is stored with them escaped
  // and restored here. Getting this wrong produces an opaque "invalid key"
  // from crypto.subtle, which is why it is a single obvious line.
  const privateKey = process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(`${header}.${claims}`),
    ),
  );

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${base64url(signature)}`,
    }),
  });
  if (!res.ok) {
    console.warn(`[push] token exchange failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;

  g.__linkdinPushToken = {
    value: data.access_token,
    // Sixty seconds of headroom, so a token cannot expire mid-flight.
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
  };
  return data.access_token;
}

/**
 * Do the stored credentials actually work?
 *
 * Distinct from pushConfigured(), which only says the three variables exist. A
 * private key pasted with the JSON's quotes still round-trips through env vars
 * perfectly and fails at crypto.subtle — and because notify() is deliberately
 * silent, the first sign would be a notification that never arrived on a day
 * something was wrong. This exchanges a real token and sends nothing.
 */
export async function checkCredentials(): Promise<{ ok: boolean; detail: string }> {
  if (!pushConfigured()) {
    return { ok: false, detail: "FCM_PROJECT_ID, FCM_CLIENT_EMAIL or FCM_PRIVATE_KEY is not set" };
  }
  try {
    // Deliberately bypasses the cache: the point is to prove the KEY works now,
    // not that a token minted an hour ago is still valid.
    const token = await mintAccessToken();
    return token
      ? { ok: true, detail: "credentials accepted by Google" }
      : { ok: false, detail: "Google refused the credentials — see the logs for the exchange error" };
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    // The signature of a mis-pasted key, called out by name because it is the
    // one mistake the setup notes warn about.
    const hint = /invalid character|asn|decode/i.test(message)
      ? " — FCM_PRIVATE_KEY looks malformed; the likeliest cause is copying it with the JSON's surrounding double quotes"
      : "";
    return { ok: false, detail: message.slice(0, 160) + hint };
  }
}

async function accessToken(): Promise<string | null> {
  const cached = g.__linkdinPushToken;
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  return mintAccessToken();
}

// ------------------------------------------------------------ device registry

export async function registerDevice(
  agentId: string,
  token: string,
  platform: string,
): Promise<void> {
  await query(
    `INSERT INTO device_tokens (token, agent_id, platform, last_seen_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (token) DO UPDATE
        SET agent_id = $2, platform = $3, last_seen_at = now()`,
    [token, agentId, platform.slice(0, 20)],
  );
}

export async function forgetDevice(token: string): Promise<void> {
  await query("DELETE FROM device_tokens WHERE token = $1", [token]);
}

async function devicesFor(agentId: string): Promise<string[]> {
  const rows = await query<{ token: string }>(
    "SELECT token FROM device_tokens WHERE agent_id = $1",
    [agentId],
  );
  return rows.map((r) => r.token);
}

// ------------------------------------------------------------ events

/**
 * What the app is allowed to tell you about.
 *
 * A closed set rather than free-form strings, so every notification the app can
 * produce is visible in one place and can be read as a list of "things worth
 * interrupting someone for". Anything that does not deserve that is a log line.
 */
export type PushEvent =
  | { kind: "draft_ready"; seq: number; hook: string; at: string | null }
  | { kind: "published"; seq: number }
  | { kind: "publish_failed"; seq: number; detail: string }
  | { kind: "cycle_failed"; detail: string }
  | { kind: "token_expiring"; days: number }
  | { kind: "scheduler_stalled"; minutes: number }
  // Only ever sent on request. Exists because the last link in the chain —
  // server to Google to a specific handset — cannot be proved any other way,
  // and the first real alert is a bad time to discover it was never wired up.
  | { kind: "feed_dead"; names: string[] }
  | { kind: "api_version_stale"; version: string; months: number }
  | { kind: "test" };

interface Rendered {
  title: string;
  body: string;
  /** Which tab to open. The app reads this from the data payload. */
  tab: string;
  /** Quiet events post silently; problems do not. */
  urgent: boolean;
}

function render(event: PushEvent): Rendered {
  switch (event.kind) {
    case "draft_ready":
      return {
        title: "A draft is ready to read",
        body: event.at ? `${event.hook} — goes out at ${event.at}.` : event.hook,
        tab: "queue",
        urgent: false,
      };
    case "published":
      return {
        title: "Posted to LinkedIn",
        body: `Post #${event.seq} went out.`,
        tab: "queue",
        urgent: false,
      };
    case "publish_failed":
      return {
        title: "A post did not go out",
        body: `Post #${event.seq} failed: ${event.detail}`,
        tab: "queue",
        urgent: true,
      };
    case "cycle_failed":
      return {
        title: "The agent could not write today",
        body: event.detail,
        tab: "status",
        urgent: true,
      };
    case "token_expiring":
      return {
        title: "Reconnect LinkedIn",
        body:
          event.days <= 0
            ? "The LinkedIn connection has expired. Nothing can publish until you reconnect."
            : `LinkedIn access expires in ${event.days} day${event.days === 1 ? "" : "s"}. It cannot renew itself.`,
        tab: "status",
        urgent: true,
      };
    case "scheduler_stalled":
      return {
        title: "The scheduler has stopped",
        body: `No tick for ${event.minutes} minutes. Nothing is being written or sent.`,
        tab: "status",
        urgent: true,
      };
    case "feed_dead": {
      const [first, ...rest] = event.names;
      return {
        title: rest.length > 0 ? `${event.names.length} feeds have stopped working` : "A feed has stopped working",
        body:
          rest.length > 0
            ? `${event.names.join(", ")} — discovery is running on fewer sources than you think.`
            : `${first} has returned nothing for days. Discovery is running on fewer sources than you think.`,
        tab: "status",
        // Not urgent: nothing is broken and nothing is waiting on you. It is a
        // slow leak in the quality of what the agent reads, and it deserves to
        // be noticed rather than to interrupt.
        urgent: false,
      };
    }
    case "api_version_stale":
      return {
        title: "LinkedIn's API version needs bumping",
        body: `Version ${event.version} is ${event.months} months old and LinkedIn retires them at about twelve. Set LINKEDIN_API_VERSION before it stops publishing.`,
        tab: "status",
        urgent: false,
      };
    case "test":
      return {
        title: "Notifications are working",
        body: "This is the only message the agent will ever send that means nothing.",
        tab: "status",
        // Sent on the alerts channel deliberately: this is the channel the
        // messages that matter use, so a test that arrives proves the one you
        // actually need will arrive too.
        urgent: true,
      };
  }
}

/**
 * How long the same KIND of event stays quiet after being sent.
 *
 * Without this the standing problems are the loud ones: a stalled scheduler is
 * re-detected on every tick and an expiring token on every status read, so the
 * two alerts that most need to be believed would arrive dozens of times a day
 * and be muted within a week. Things that happen once per post have no cooldown
 * at all — each one is genuinely new.
 */
const COOLDOWN_MINUTES: Record<PushEvent["kind"], number> = {
  draft_ready: 0,
  published: 0,
  publish_failed: 0,
  cycle_failed: 180,
  token_expiring: 1440, // once a day is plenty for a 60-day clock
  scheduler_stalled: 360,
  // Weekly. A dead feed stays dead until someone edits lib/discovery.ts, and
  // an alert repeating before then is pure nagging about a known problem.
  feed_dead: 10080,
  // Weekly too. The fix is one environment variable and it is not urgent for
  // months, so this is a standing reminder rather than an alarm.
  api_version_stale: 10080,
  // Asked for explicitly, so throttling it would only ever be confusing.
  test: 0,
};

async function withinCooldown(agentId: string, kind: PushEvent["kind"]): Promise<boolean> {
  const minutes = COOLDOWN_MINUTES[kind];
  if (minutes <= 0) return false;
  const rows = await query<{ recent: string }>(
    `SELECT count(*) AS recent FROM push_log
      WHERE agent_id = $1 AND kind = $2 AND sent_at > now() - ($3 || ' minutes')::interval`,
    [agentId, kind, String(minutes)],
  );
  return Number(rows[0]?.recent ?? 0) > 0;
}

/**
 * Send one notification, to every device this agent has registered.
 *
 * Returns how many devices it reached, which is only useful for tests and logs
 * — no caller should branch on it. Never throws.
 */
export async function notify(agentId: string, event: PushEvent): Promise<number> {
  try {
    if (!pushConfigured()) return 0;
    if (await withinCooldown(agentId, event.kind)) {
      console.log(`[push] ${event.kind} suppressed by cooldown`);
      return 0;
    }

    const tokens = await devicesFor(agentId);
    if (tokens.length === 0) return 0;

    const bearer = await accessToken();
    if (!bearer) return 0;

    const { title, body, tab, urgent } = render(event);
    const projectId = process.env.FCM_PROJECT_ID;
    let delivered = 0;

    // Sent one at a time: the v1 API has no batch endpoint, and this app has
    // one or two devices. Sequential also means one dead token cannot stop the
    // others from being tried.
    for (const token of tokens) {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body },
            // Strings only — FCM rejects a data payload with non-string values.
            data: { kind: event.kind, tab },
            android: {
              priority: urgent ? "HIGH" : "NORMAL",
              notification: {
                channel_id: urgent ? "linkdin_alerts" : "linkdin_updates",
                // Grouped by kind, so five failures collapse into one line
                // rather than five identical rows in the shade.
                tag: event.kind,
              },
            },
          },
        }),
      });

      if (res.ok) {
        delivered++;
        continue;
      }
      const detail = (await res.text()).slice(0, 300);
      // 404 UNREGISTERED and 400 INVALID_ARGUMENT on the token mean the app was
      // uninstalled or the token rotated. Keeping it would mean retrying a dead
      // address forever, so it is dropped.
      if (res.status === 404 || detail.includes("UNREGISTERED") || detail.includes("INVALID_ARGUMENT")) {
        console.warn(`[push] dropping dead device token: ${res.status}`);
        await forgetDevice(token);
      } else {
        console.warn(`[push] send failed: ${res.status} ${detail}`);
      }
    }

    if (delivered > 0) {
      await query("INSERT INTO push_log (agent_id, kind) VALUES ($1, $2)", [agentId, event.kind]);
    }
    return delivered;
  } catch (err) {
    // A cycle must never fail because a notification did.
    console.warn("[push] notify failed:", String((err as Error)?.message ?? err));
    return 0;
  }
}
