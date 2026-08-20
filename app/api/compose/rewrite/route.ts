/**
 * Rewrite arbitrary composer text — no saved post required.
 *
 * The sibling action on /api/posts/[seq] rewrites a draft that already exists
 * in the database. That is useless while someone is still typing something new,
 * which is exactly when a second opinion is most wanted. So this takes the text
 * directly and saves nothing: the composer shows the variant beside what the
 * author wrote and they decide.
 *
 * One LLM call, button-triggered. `variant` cycles the angle the writer is told
 * to take, so pressing it repeatedly gives genuinely different options rather
 * than the same sentence reshuffled.
 */
import { NextResponse } from "next/server";
import { getPersona, getPrimaryAgent } from "../../../../lib/agents";
import { MAX_BODY_CHARS } from "../../../../lib/format";
import { rewriteDraft } from "../../../../lib/writer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const agent = await getPrimaryAgent();
  if (!agent) return NextResponse.json({ error: "not_initialized" }, { status: 400 });

  const persona = await getPersona(agent.agentId);
  if (!persona) return NextResponse.json({ error: "persona_not_ready" }, { status: 409 });

  let body: { text?: string; variant?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  if (text.length < 20) {
    return NextResponse.json({ error: "text_too_short" }, { status: 400 });
  }
  if (text.length > MAX_BODY_CHARS) {
    return NextResponse.json(
      { error: "text_too_long", detail: `${text.length} chars, max ${MAX_BODY_CHARS}` },
      { status: 400 },
    );
  }

  const variant = await rewriteDraft(persona, text, agent.style, Number(body.variant ?? 0));
  if (!variant.ok) {
    return NextResponse.json({ error: "rewrite_failed", detail: variant.reason }, { status: 502 });
  }

  // Hashtags travel with the variant. A rewrite that changes the angle
  // should be free to change the tags with it — the old prompt demanded an
  // empty array, so every alternative silently inherited whatever tags the
  // original happened to carry, even when it was now about something else.
  return NextResponse.json({
    ok: true,
    text: variant.data.text,
    hashtags: (variant.data.hashtags ?? []).slice(0, agent.style.hashtagCount),
    servedBy: variant.data.servedBy,
  });
}
