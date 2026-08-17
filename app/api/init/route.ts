/**
 * One-time setup: name, domain, categories, timezone and daily post time.
 *
 * Idempotent on a hash of the payload, so re-posting identical input returns
 * the same agent with its history intact. Answers fast (pure DB work) and
 * expands the persona plus runs the first cycle in after().
 */
import { after, NextResponse } from "next/server";
import { ensureAgent, expandStoredPersona, getPrimaryAgent } from "../../../lib/agents";
import { parseCategories } from "../../../lib/categories";
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
    domain?: string;
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
  const domain = (body.domain ?? "").trim();
  if (name.length < 2 || domain.length < 3) {
    return NextResponse.json({ error: "name_and_domain_required" }, { status: 400 });
  }

  const categories = parseCategories(body.categories);
  if (categories.length === 0) {
    return NextResponse.json({ error: "at_least_one_category_required" }, { status: 400 });
  }

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
