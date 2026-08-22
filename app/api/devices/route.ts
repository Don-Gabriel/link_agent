/**
 * Register this phone for push notifications, or unregister it.
 *
 * Behind the session gate like everything else, so only a signed-in app can
 * attach a device to the agent — otherwise anyone who guessed the URL could
 * subscribe themselves to a stranger's drafts.
 *
 * The app calls POST on every launch, not only the first. FCM rotates tokens
 * on its own schedule and never tells the server, so "register again each time
 * we start" is the only reliable way to keep the registry current; the insert
 * is an upsert precisely so that is cheap.
 */
import { NextResponse } from "next/server";
import { getPrimaryAgent } from "../../../lib/agents";
import { forgetDevice, pushConfigured, registerDevice } from "../../../lib/push";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const agent = await getPrimaryAgent();
  if (!agent) return NextResponse.json({ error: "not_initialized" }, { status: 400 });

  let body: { token?: string; platform?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const token = (body.token ?? "").trim();
  // FCM tokens are long opaque strings; anything short is a bug or a probe.
  if (token.length < 20 || token.length > 4096) {
    return NextResponse.json({ error: "bad_token" }, { status: 400 });
  }

  await registerDevice(agent.agentId, token, body.platform ?? "android");
  // Reported back so the app can say "notifications are on but the server has
  // no Firebase credentials" rather than silently never receiving anything.
  return NextResponse.json({ ok: true, configured: pushConfigured() });
}

export async function DELETE(request: Request) {
  let body: { token?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const token = (body.token ?? "").trim();
  if (token) await forgetDevice(token);
  return NextResponse.json({ ok: true });
}
