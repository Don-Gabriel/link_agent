/**
 * The categories chosen at init. They do three jobs:
 *   1. select which discovery feeds are consulted,
 *   2. give the judge a category-fit criterion to score against,
 *   3. supply the hashtag vocabulary the writer draws from.
 *
 * A category is a standing editorial interest, not a keyword filter — the
 * judge decides what actually belongs, the same way it decides everything
 * else in this pipeline.
 */

export type CategoryId = "music-tech-software" | "music-tech-hardware" | "emerging-tech";

export interface Category {
  id: CategoryId;
  label: string;
  /** Fed to the judge and writer: what genuinely belongs under this heading. */
  blurb: string;
  /** Candidate hashtags. The writer picks at most two; more reads as reach-farming. */
  hashtags: string[];
}

export const CATEGORIES: Record<CategoryId, Category> = {
  "music-tech-software": {
    id: "music-tech-software",
    label: "Music tech — software",
    blurb:
      "DAWs, plugins and plugin formats, synthesis and DSP technique, audio machine learning (separation, transcription, generation), sequencing and live-coding tools, audio programming languages and libraries, and the engineering behind them. Research papers count when the result is something a producer or audio developer would actually care about.",
    hashtags: ["MusicTech", "AudioDev", "DSP", "MusicProduction"],
  },
  "music-tech-hardware": {
    id: "music-tech-hardware",
    label: "Music tech — hardware",
    blurb:
      "Synthesizers, drum machines, samplers, eurorack and modular, MIDI controllers and alternate controllers, audio interfaces and converters, DIY and circuit-level builds, and the manufacturing and repairability stories around them. New instrument announcements count when there is something genuinely new in the design, not just a colourway.",
    hashtags: ["Synthesizers", "MusicGear", "Eurorack", "SoundDesign"],
  },
  "emerging-tech": {
    id: "emerging-tech",
    label: "Emerging tech",
    blurb:
      "New and genuinely interesting technology outside music: developer tooling, AI systems and their engineering, hardware and devices, protocols and infrastructure, and the occasional research result that changes what is buildable. Curiosity-driven — the test is whether a technical person would want to go read more, not whether it is trending.",
    hashtags: ["EmergingTech", "AI", "Engineering", "BuildingInPublic"],
  },
};

export const ALL_CATEGORY_IDS = Object.keys(CATEGORIES) as CategoryId[];

export function isCategoryId(v: unknown): v is CategoryId {
  return typeof v === "string" && v in CATEGORIES;
}

export function parseCategories(v: unknown): CategoryId[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<CategoryId>();
  for (const item of v) if (isCategoryId(item)) seen.add(item);
  return [...seen];
}

/** Prompt block describing the active categories, shared by judge and writer. */
export function categoryBlock(ids: CategoryId[]): string {
  const active = ids.length > 0 ? ids : ALL_CATEGORY_IDS;
  return [
    "ACTIVE CATEGORIES (a post must belong to exactly one):",
    ...active.map((id) => `- ${id} — ${CATEGORIES[id].label}: ${CATEGORIES[id].blurb}`),
  ].join("\n");
}

export function hashtagsFor(id: CategoryId | null | undefined): string[] {
  return id && id in CATEGORIES ? CATEGORIES[id].hashtags : [];
}
