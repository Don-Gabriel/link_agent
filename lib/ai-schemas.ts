/** Constrained JSON is followed by the existing semantic/relevance/style checks. */
export const draftSchema: Record<string, unknown> = {
  type: 'object', additionalProperties: false,
  properties: { text: { type: 'string' }, rationale: { type: 'string' }, fingerprint: { type: 'string' },
    continuity: { type: ['string', 'null'] }, hashtags: { type: 'array', items: { type: 'string' } }, used_quote: { type: 'boolean' } },
  required: ['text', 'rationale', 'fingerprint', 'continuity', 'hashtags', 'used_quote'],
};
export const judgeSchema: Record<string, unknown> = {
  type: 'array', items: {
    type: 'object', additionalProperties: false,
    properties: { index: { type: 'integer' }, category: { type: 'string' }, reason: { type: 'string' },
      ...Object.fromEntries(['persona_fit', 'category_fit', 'novelty', 'timeliness', 'non_duplication'].map(k => [k, { type: 'number', minimum: 0, maximum: 10 }])) },
    required: ['index', 'category', 'reason', 'persona_fit', 'category_fit', 'novelty', 'timeliness', 'non_duplication'],
  },
};
