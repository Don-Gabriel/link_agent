/**
 * One-time setup: name, categories, timezone and daily post time.
 *
 * Idempotent on a hash of the payload, so re-posting identical input returns
 * the same agent with its history intact. Answers fast (pure DB work) and
 * expands the persona plus runs the first cycle in after().
 */
import { after, NextResponse } from "next/server";
import { ensureAgent, expandStoredPersona, getPrimaryAgent } from "../../../lib/agents";
import { describeCategories, parseCategories } from "../../../lib/categories";
import { runCycleWithLock } from "../../../lib/cycle";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const agent = await getPrimaryAgent();
  return NextResponse.json({ initialized: !!agent, agent });
}

export async function POST(request: Request) {
  let body: {
    name?: string;
    categories?: unknown;
    timezone?: string;
    postTimeLocal?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  if (name.length < 2) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }

  const categories = parseCategories(body.categories);
  if (categories.length === 0) {
    return NextResponse.json({ error: "at_least_one_category_required" }, { status: 400 });
  }

  // Derived, not typed. This used to be a free-text sentence, and because
  // nothing ever revised it, it outlived the categories it was written for: an
  // agent whose music categories had since been switched off still introduced
  // itself as writing about music, and still had a music-shaped persona built
  // from that sentence. Deriving it means setup and every later category edit
  // produce the same answer. The idempotency hash covers it either way.
  const domain = describeCategories(categories);

  try {
    const { agentId, created } = await ensureAgent(
      { name, domain, categories },
      { timezone: body.timezone, postTimeLocal: body.postTimeLocal },
    );

    if (created) {
      // The persona expansion is one LLM call and the first cycle is two more;
      // neither belongs in the response path.
      after(async () => {
        await expandStoredPersona(agentId);
        await runCycleWithLock(agentId, true);
      });
    }

    return NextResponse.json({ agentId, created });
  } catch (err) {
    console.error("[init] failed:", err);
    return NextResponse.json(
      { error: "init_failed", detail: String((err as Error)?.message ?? err).slice(0, 200) },
      { status: 500 },
    );
  }
}
