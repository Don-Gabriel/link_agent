import type { CategoryId } from "./categories";

export interface PersonaIdentity {
  voice: string; // voice and register, 1-3 sentences
  interests: string[]; // 3-5 stable technical interests
  opinions: string[]; // 3-5 specific opinions the persona holds
  skeptical_of: string[]; // things it is skeptical of
}

export interface PersonaRecord {
  input: { name: string; domain: string };
  identity: PersonaIdentity;
  generator: "llm" | "fallback";
  /**
   * The categories this identity was grown from. Compared against the agent's
   * live categories to decide whether it is stale. Absent on records written
   * before this field existed — treated as stale, which rebuilds them once.
   */
  builtFor?: CategoryId[];
}

/** Stable prompt block rendered from the persisted record — used by judge and writer. */
export function personaBlock(p: PersonaRecord): string {
  const i = p.identity;
  return [
    `PERSONA: ${p.input.name} — domain: ${p.input.domain}`,
    `Voice: ${i.voice}`,
    `Stable interests: ${i.interests.join("; ")}`,
    `Held opinions: ${i.opinions.join("; ")}`,
    `Skeptical of: ${i.skeptical_of.join("; ")}`,
  ].join("\n");
}
