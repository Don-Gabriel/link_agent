import { hookOf } from "./format";
export interface PostRow {
  id: string;
  seq: number;
  text: string;
  rationale: string;
  status: string;
  kind: string;
  category: string | null;
  scores_json: Record<string, number> | null;
  sources_json: string[];
  media_json: string[];
  hashtags_json: string[];
  continuity: string | null;
  used_quote: boolean;
  created_at: Date;
  published_at: Date | null;
  scheduled_for: Date | null;
  slot_id: string | null;
  cleared_at: Date | null;
  hold_until: Date | null;
}

export function serializePost(r: PostRow) {
  return {
    id: r.id,
    seq: r.seq,
    text: r.text,
    hook: hookOf(r.text),
    rationale: r.rationale,
    status: r.status,
    kind: r.kind,
    category: r.category,
    scores: r.scores_json,
    sources: r.sources_json ?? [],
    media: r.media_json ?? [],
    hashtags: r.hashtags_json ?? [],
    continuity: r.continuity,
    usedQuote: r.used_quote,
    createdAt: r.created_at.toISOString(),
    publishedAt: r.published_at?.toISOString() ?? null,
    // Scheduling. `scheduledFor` null means the post is not on the timetable
    // and will only ever go out if a human sends it by hand.
    scheduledFor: r.scheduled_for?.toISOString() ?? null,
    slotId: r.slot_id,
    clearedAt: r.cleared_at?.toISOString() ?? null,
    // Only reported while genuinely in effect, so the client never has to work
    // out whether an expired hold still counts.
    heldUntil:
      r.hold_until && r.hold_until.getTime() > Date.now() ? r.hold_until.toISOString() : null,
  };
}

export const POST_COLUMNS = `id, seq, text, rationale, status, kind, category, scores_json,
                      sources_json, media_json, hashtags_json, continuity, used_quote,
                      created_at, published_at, scheduled_for, slot_id, cleared_at, hold_until`;

