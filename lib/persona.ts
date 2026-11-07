/**
 * Persona construction. One LLM call expands { name, domain } plus the chosen
 * categories into a full editorial identity, persisted to agents.persona_json.
 * Every later prompt reads that stored record so the voice cannot drift across
 * months of daily posting.
 *
 * Stable is not the same as frozen. The identity is derived FROM the agent's
 * categories, so it has to be rebuilt when those change — `builtFor` records
 * which set it was grown from, and lib/agents.ts rebuilds it when that no
 * longer matches. Without this the interests and opinions stayed pinned to
 * whatever was selected at setup, and the judge went on scoring persona_fit
 * against categories the author had since switched off.
 *
 * Nothing here is hardcoded to a particular persona — name, domain and
 * categories all arrive from the agent's own settings.
 */
import type { CategoryId } from "./categories";
import { CATEGORIES } from "./categories";
import { complete, parseJson } from "./llm";

import type { PersonaIdentity, PersonaRecord } from "./persona-prompt";
export type { PersonaIdentity, PersonaRecord } from "./persona-prompt";
function isIdentity(v: unknown): v is PersonaIdentity {
  const o = v as PersonaIdentity;
  return (
    !!o &&
    typeof o.voice === "string" &&
    o.voice.length > 10 &&
    Array.isArray(o.interests) &&
    o.interests.length >= 3 &&
    Array.isArray(o.opinions) &&
    o.opinions.length >= 3 &&
    Array.isArray(o.skeptical_of) &&
    o.skeptical_of.length >= 2 &&
    [...o.interests, ...o.opinions, ...o.skeptical_of].every((s) => typeof s === "string")
  );
}

const SYSTEM = `You construct stable editorial identities for people who publish regularly under their own name. Respond with JSON matching exactly:
{"voice": string, "interests": string[], "opinions": string[], "skeptical_of": string[]}
- voice: 2-3 sentences describing how this person writes — register, sentence rhythm, what they refuse to do stylistically. A practitioner with an opinion, never a growth account. This is a real professional profile, not a brand channel.
- interests: 4-6 stable, specific technical interests, spread across their stated categories — at least one per category, and none of them naming a field the categories do not cover.
- opinions: 4-6 concrete, defensible opinions they actually hold (specific claims someone could argue with, not platitudes).
- skeptical_of: 2-5 things in their fields they distrust, briefly and specifically.`;

/**
 * Expand a raw persona into a full identity. If the LLM is unavailable at
 * init (quota, outage), fall back to a mechanical identity so init NEVER
 * fails — the record is marked generator:"fallback" and surfaced honestly.
 */
export async function expandPersona(
  name: string,
  domain: string,
  categories: CategoryId[] = [],
): Promise<PersonaRecord> {
  const categoryLines = categories
    .map((id) => `- ${CATEGORIES[id].label}: ${CATEGORIES[id].blurb}`)
    .join("\n");
  const user = [
    `Construct the editorial identity for a person named "${name}" whose stated domain is "${domain}".`,
    categories.length > 0 ? `They publish across these categories:\n${categoryLines}` : "",
    "The category list above is the complete and authoritative account of what this person writes about.",
    "Their interests and opinions must span these categories, not collapse into whichever one is easiest to write about.",
    // Named explicitly because it is the failure this whole record exists to
    // prevent: an identity that keeps one retired speciality alive skews every
    // persona_fit score afterwards towards it.
    "Do NOT introduce a speciality that is absent from the list, however natural it seems for someone with this name or domain.",
  ]
    .filter(Boolean)
    .join("\n");

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await complete({
      system: SYSTEM,
      user:
        attempt === 0
          ? user
          : `${user}\nYour previous reply was not valid JSON of the required shape. Reply with ONLY the JSON object.`,
      jsonMode: true,
      maxOutputTokens: 1024,
    });
    if (!res.ok) break;
    const identity = parseJson(res.text, isIdentity);
    if (identity) {
      return { input: { name, domain }, identity, generator: "llm", builtFor: categories };
    }
  }

  console.warn(`[persona] LLM expansion unavailable — using mechanical fallback for "${name}"`);
  return {
    input: { name, domain },
    identity: {
      voice: `${name} writes plainly and concretely about ${domain}: short declarative sentences, evidence before opinion, no hype vocabulary and no engagement-bait formatting.`,
      interests: [
        `practical, deployed ${domain}`,
        `measurement and evaluation in ${domain}`,
        `failure modes and incidents in ${domain}`,
      ],
      opinions: [
        `most headline claims in ${domain} understate their tradeoffs`,
        `reproducible evidence beats vendor benchmarks in ${domain}`,
        `boring, well-understood tools are underrated in ${domain}`,
      ],
      skeptical_of: [
        `press releases framed as research in ${domain}`,
        `benchmarks without published methodology`,
      ],
    },
    generator: "fallback",
    builtFor: categories,
  };
}

export { personaBlock } from "./persona-prompt";
