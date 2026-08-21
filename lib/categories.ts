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

/**
 * Adding a category is deliberately ADDITIVE. Existing ids never change meaning
 * enough to alter what an agent already watching them receives, and no feed is
 * ever moved from an old category to a new one — moving `arxiv-cs.SD` out of
 * music-tech-software to a new audio-dsp category would silently stop an agent
 * that never touched its settings from seeing DSP papers at all.
 *
 * That rule is why there is no separate "audio DSP" category despite the
 * overlap being real: it cannot be carved out of music-tech-software without
 * either changing what an existing agent receives, or fetching the same arXiv
 * feed twice per cycle.
 */
export type CategoryId =
  | "music-tech-software"
  | "music-tech-hardware"
  | "emerging-tech"
  | "ai-ml"
  | "dev-tooling"
  | "hardware-embedded"
  | "compute-silicon";

export interface Category {
  id: CategoryId;
  label: string;
  /** Fed to the judge and writer: what genuinely belongs under this heading. */
  blurb: string;
  /** Lower-case prose fragment, joined into the agent's scope line. See describeCategories. */
  scope: string;
  /** Candidate hashtags. The writer picks at most two; more reads as reach-farming. */
  hashtags: string[];
}

export const CATEGORIES: Record<CategoryId, Category> = {
  "music-tech-software": {
    id: "music-tech-software",
    label: "Music tech — software",
    scope: "music software and audio DSP",
    blurb:
      "DAWs, plugins and plugin formats, synthesis and DSP technique, audio machine learning (separation, transcription, generation), sequencing and live-coding tools, audio programming languages and libraries, and the engineering behind them. Research papers count when the result is something a producer or audio developer would actually care about.",
    hashtags: ["MusicTech", "AudioDev", "DSP", "MusicProduction"],
  },
  "music-tech-hardware": {
    id: "music-tech-hardware",
    label: "Music tech — hardware",
    scope: "synths and studio hardware",
    blurb:
      "Synthesizers, drum machines, samplers, eurorack and modular, MIDI controllers and alternate controllers, audio interfaces and converters, DIY and circuit-level builds, and the manufacturing and repairability stories around them. New instrument announcements count when there is something genuinely new in the design, not just a colourway.",
    hashtags: ["Synthesizers", "MusicGear", "Eurorack", "SoundDesign"],
  },
  "emerging-tech": {
    id: "emerging-tech",
    label: "Emerging tech",
    scope: "emerging tech",
    blurb:
      "New and genuinely interesting technology outside music: protocols and infrastructure, devices, platform shifts, and the occasional research result that changes what is buildable. The general-interest catch-all — when a more specific active category fits better, prefer it. Curiosity-driven: the test is whether a technical person would want to go read more, not whether it is trending.",
    hashtags: ["EmergingTech", "Engineering", "BuildingInPublic"],
  },
  "ai-ml": {
    id: "ai-ml",
    label: "AI & ML engineering",
    scope: "AI and ML engineering",
    blurb:
      "How AI systems are actually built and made to work: model architectures and training, inference and serving, evaluation and benchmarks, retrieval, agents and tool use, fine-tuning, quantisation, and the engineering tradeoffs behind all of it. Papers count when the result changes what a practitioner would do. Funding rounds, model-launch marketing and capability hype do not.",
    hashtags: ["MachineLearning", "AI", "LLM", "MLOps"],
  },
  "dev-tooling": {
    id: "dev-tooling",
    label: "Developer tooling",
    scope: "developer tooling",
    blurb:
      "The craft and the tools of the job: languages and their releases, editors, build systems and compilers, testing, version control, debugging and profiling, package ecosystems, and developer experience. The test is whether it would change how someone works on Monday.",
    hashtags: ["DevTools", "SoftwareEngineering", "OpenSource", "DeveloperExperience"],
  },
  "hardware-embedded": {
    id: "hardware-embedded",
    label: "Hardware & embedded",
    scope: "embedded hardware and electronics",
    blurb:
      "Non-musical hardware: microcontrollers and single-board computers, sensors, PCB design, firmware, electronics test gear, robotics, and the repair and teardown culture around them. Distinct from music-tech-hardware, which covers instruments and studio equipment specifically.",
    hashtags: ["Embedded", "Electronics", "Hardware", "IoT"],
  },
  "compute-silicon": {
    id: "compute-silicon",
    label: "Compute & silicon",
    scope: "compute and silicon",
    blurb:
      "The physical substrate under everything else: CPU and GPU microarchitecture, accelerators and their memory systems, interconnects, fabrication and packaging, performance analysis at the hardware level, and the economics of building compute. Deeply underserved on LinkedIn, which is part of why it is worth writing about.",
    hashtags: ["Semiconductors", "ComputerArchitecture", "GPU", "Performance"],
  },
};

export const ALL_CATEGORY_IDS = Object.keys(CATEGORIES) as CategoryId[];

export function isCategoryId(v: unknown): v is CategoryId {
  return typeof v === "string" && v in CATEGORIES;
}

export function parseCategories(v: unknown): CategoryId[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<CategoryId>();
  const dropped: unknown[] = [];
  for (const item of v) {
    if (isCategoryId(item)) seen.add(item);
    else dropped.push(item);
  }
  // Say so rather than swallowing it. A category removed from this file
  // disappears from every agent that had it selected, and silently narrowing
  // what someone watches looks exactly like discovery quietly getting worse.
  if (dropped.length > 0) {
    console.warn(`[categories] ignoring ${dropped.length} unknown id(s): ${JSON.stringify(dropped)}`);
  }
  return [...seen];
}

/**
 * The agent's editorial scope, in prose, derived from the categories it is
 * actually watching.
 *
 * This is the ONE description of what the agent covers. It is stored on
 * agents.domain, rendered in the app header, and fed to the persona expander —
 * so the header, the chips and the prompts cannot disagree with each other.
 *
 * It used to be a free-text sentence typed once at setup and never touched
 * again, which is how an agent whose music categories had been switched off
 * kept describing itself as writing about music technology, and kept being
 * judged as though it did.
 */
export function describeCategories(ids: CategoryId[]): string {
  const active = ids.length > 0 ? ids : ALL_CATEGORY_IDS;
  // Comma-joined rather than "a, b and c": several scopes already contain an
  // "and" of their own, and a second one reads as a single run-on interest.
  return active.map((id) => CATEGORIES[id].scope).join(", ");
}

/** Order-insensitive comparison — the persona only cares WHICH categories, not their order. */
export function sameCategorySet(a: CategoryId[], b: CategoryId[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/** Prompt block describing the active categories, shared by judge and writer. */
export function categoryBlock(ids: CategoryId[]): string {
  const active = ids.length > 0 ? ids : ALL_CATEGORY_IDS;
  return [
    "ACTIVE CATEGORIES (a post must belong to exactly one):",
    ...active.map((id) => `- ${id} — ${CATEGORIES[id].label}: ${CATEGORIES[id].blurb}`),
    // Without this the broad catch-all absorbs everything: an LLM handed both
    // "emerging-tech" and "ai-ml" will file a paper on inference batching under
    // the general heading roughly half the time, which makes the specific
    // category look broken and its hashtags never appear.
    "Assign the MOST SPECIFIC active category that genuinely fits. Only fall back to a broad one when no narrower category applies.",
  ].join("\n");
}

export function hashtagsFor(id: CategoryId | null | undefined): string[] {
  return id && id in CATEGORIES ? CATEGORIES[id].hashtags : [];
}
