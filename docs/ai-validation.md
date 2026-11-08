# AI validation and release record

9 November 2026, India. This record distinguishes service reliability from generated-content quality. It is an internal review by the implementing assistant, not an independent audit.

## Automated checks

- Cloudflare type generation and TypeScript check passed.
- Wrangler dry-run bundle and all **68 cloud tests** passed.
- Root logic/health tests and the Next.js production verification build passed.
- `git diff --check` passed; Git reports the repository's usual LF/CRLF conversion notices.

The new tests exercise authentication/author isolation, revoked/expired access, atomic daily allowance under concurrent calls, route concurrency, encrypted replay, expired-lease fencing, persistent retry ceilings, daily-quota cooldown, error redaction, schema/size/timeout behavior, native model selection, interrupted dispatch recovery, queued bursts, idle cron behavior, generated-draft review and polished scheduled-draft review. A generation integration test replays judge/write after a simulated lost acknowledgement and verifies that only two actual inference reservations are consumed.

These are controlled tests. They are not a production load benchmark, proof of provider uptime or a guarantee of exactly-once inference compute.

## Actual model experiments

Metrics are preserved in [the compact evaluation record](ai-evaluation-results.json). Raw results remain in ignored local evaluation files; no customer material was used. Automated `passed` checks cover shape/style and a narrow injection/continuity probe. They do not prove factual accuracy, useful prose or correct legal claims.

| Runtime/model | What was observed | Decision |
|---|---|---|
| Local Ollama, Qwen3 4B, 16K context | Three synthetic fixtures. One judge rejection; one draft invented prior-author continuity and stayed too short after repairs. | Not suitable as an unattended production default. |
| Workers AI, Qwen3.8-27B, thinking disabled | Three initial synthetic stories rejected appropriately. Public-reference writing probes had false recency/absence claims, one repair HTTP 500, and inconsistent word counts. | Adapter verified; not selected for the pilot. |
| Same Qwen after stronger evidence-boundary instructions | Two of three reference probes passed automated style checks, but human review still found unsupported absence/recency claims; one output became repetitive and too long. | Prompt changes alone did not establish factual reliability. |
| Workers AI, GLM-4.7-Flash, thinking disabled | Initial six-fixture suite took about 10.5–17 seconds per fixture including judging and repairs. Five passed the then-current automated checks; human review found missing fictional context, repeated text and unsupported assertions about absent benchmark data. Reported compute was about 39–50 neurons per small fixture. | Selected only for a review-required pilot because of measured latency/compute in this small sample, not because all quality checks passed. |
| GLM with explicit fictional-source rejection instructions | Injection fixture rejected; other fictional cases still reached writing. | Do not rely on an LLM judge alone to establish truth. Human review remains required. |
| Qwen3.8-27B with low reasoning, existing output budgets | Reference writing attempts failed completion/availability checks within the bounded budgets. | Do not enable reasoning by simply flipping a flag and assuming existing budgets suffice. |

The repeated-text failure prompted a deterministic check for duplicated substantial sentences. The native preview and generation paths retain factual-review notes even when every style rule passes. The first attempted Node proxy run could not serialize AbortSignal; it was a harness issue, not a model-quality result. Later binding calls and the deployed runtime were checked separately.

The Qwen3 8B download was stopped after transfer/retry delays; it was **not benchmarked**. Existing local models were not removed. llama.cpp, vLLM, a Raspberry Pi and mobile on-device runtimes were researched, not benchmarked or installed as production servers.

The fixture suite intentionally includes weak/fictitious material. A correct judge rejection is not a transport failure. Reference-page writer probes isolate writing even when those pages are unsuitable as fresh news; production selection never bypasses its relevance threshold. Results from one-candidate probes must not be multiplied into a claimed user count or compared directly with a full discovery/judge/repair job.

## Live rollout

The owner confirmed the dedicated ByLine account is Workers Free, without a paid upgrade. The CLI could not independently read billing; no upgrade or payment action was performed.

- Account: dedicated ByLine; API: `https://byline-api.byline-b79.workers.dev`.
- An export of the existing D1 database was saved privately before migration.
- Additive migration `0004_ai_service.sql` applied successfully.
- Worker version `4394b8f4-f619-47fa-8dcb-ad7cca2954eb` deployed with native Workers AI, `@cf/zai-org/glm-4.7-flash`, thinking disabled, one active inference per route, two active generation jobs, fallback forty attempts per author/day, and mandatory new-model review.
- Previous Worker version for an explicit rollback: `3db6f681-3b58-4ec6-87ca-deb1ef7fe845`. Keep the additive schema when rolling code back.
- Health returned 200; unauthenticated AI usage returned 401.

The isolated remote smoke created a disposable author with no LinkedIn grant, notification devices, timetable slots or automatic publishing. It verified the author remained isolated before generation, exercised the real preview and background workflow, checked review notes and AI usage, then deleted only that account. It did not change the owner's phone, notify a device or publish a post.

**Live smoke passed.** The preview had 118 words and factual-review notes. The background job completed with a saved 172-word draft, factual-review notes and a visible 80–160 word preference warning. Across both paths, seven successful inference calls used only `@cf/zai-org/glm-4.7-flash`, reporting 283.9506 neurons. Usage showed seven of forty attempts, and test-account cleanup succeeded. The naturally advancing scheduler heartbeat was healthy, with `/api/health?check=scheduler` returning 200 after rollout. These are two real jobs, not enough observations to estimate customer capacity or a latency percentile.

## Release boundary

This is a working, bounded AI service architecture with a review-required model rollout. It is **not certification for unattended publishing, unlimited free users or a finished commercial subscription product**. There is no customer traffic target yet, and no representative burst/load or long-duration reliability study has been performed. Before selling unattended generation/publishing or a stated throughput SLA, expand the evaluation across actual subjects/voices, define factual/error tolerances, validate full-job capacity, and finish billing, monitoring and recovery work.

Research review result: architectural/interface/plan-limit claims are supported by primary documentation and controlled tests; model quality and capacity claims need the qualifications above. No provider benchmark was substituted for ByLine task evidence.
