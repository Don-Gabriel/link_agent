# ByLine AI architecture decision and evidence

Research date: 9 November 2026 (India). Scope: the Flutter app's Cloudflare backend. The original Next.js/PostgreSQL website is a separate deployment.

## Decision

Keep Cloudflare for authentication, scheduling, storage and jobs. Use a replaceable inference service behind the backend, with Workers AI GLM-4.7-Flash for the current review-required pilot and an authenticated compatible endpoint for future self-hosting. Customers do not supply model API keys. Keep newly introduced models behind draft review until their quality is demonstrated.

This is a lasting architectural boundary, not a promise that one model, machine or free plan lasts forever. An open-weight model removes a proprietary inference API dependency; somebody still supplies compute, electricity, connectivity and maintenance. No Raspberry Pi, laptop, Ollama installation or GPU server provides unlimited capacity.

The owner confirmed that the dedicated ByLine account remains on Workers Free, with no paid upgrade. Expected traffic is unknown. There is no justified fixed user-capacity number yet. No paid fallback, paid subscription, hardware purchase or customer publishing is part of this work.

## Research charter and method

Question: how can a commercial writing app remove hard dependence on Gemini while retaining its Cloudflare hosting and avoiding new spending today?

Acceptance criteria: preserve author isolation and source/relevance checks; bound concurrency and retries; make completed work replayable; enforce server-owned limits; permit a different inference host without rewriting product flows; verify model behavior on actual tasks; distinguish shipping functionality from research, billing and capacity assumptions.

Source ranking: official runtime documentation and source code for wire contracts; original model cards and licenses for model terms; Cloudflare documentation for plan limits; repository tests and real inference for observed behavior. Search snippets, third-party benchmark rankings and unsupported hardware sizing claims were not treated as deployment evidence. Evaluation uses synthetic/public evidence, not customer content. Sources below were checked during this investigation; model availability and plan terms must be checked again before a future rollout.

## Options compared

| Option | Useful role | Limits and decision |
|---|---|---|
| Workers AI binding | Hosted inference alongside the current Worker; no separate model key in the app | Shares Cloudflare's daily allowance. Candidate for the current free pilot; remains replaceable. |
| llama.cpp server | Quantized inference on owned CPU/GPU hardware; relatively direct control of memory, context and parallel slots | Good future small-server candidate. Compatible endpoint and schema support are documented; ByLine has not benchmarked this runtime. |
| vLLM | GPU serving with batching and a compatible chat endpoint | Candidate for a paid commercial fleet once demand and hardware justify it. Needs an actual hardware/load benchmark, operations and redundant capacity. |
| Ollama | Convenient local development and model management | Useful evaluation tool, not a scaling strategy by itself. Replacing Ollama without changing the hardware does not create more compute. |
| On-device inference | Customer-owned compute, possible offline drafting | Device variability, model download/storage, thermal limits and background execution complicate the current scheduled mobile product. Not selected as the default. |
| Raspberry Pi | Low-power controller or constrained local experimentation | No measured evidence here that it meets ByLine's drafting latency or concurrent-user needs. Do not buy one as an unlimited production AI server. |

The application uses a shared chat/schema contract rather than directly depending on any one server SDK. A self-hosted service still needs a private server credential; that credential protects owned compute and is different from buying access to a proprietary model. Remote inference uses HTTPS and a server-side bearer secret. A loopback HTTP exception is explicitly opt-in for development only. Cloudflare cannot reach a user's `localhost`; a later self-hosted deployment needs a secured reachable service and an always-on internet connection for cloud jobs.

## Model choice and commercial terms

Qwen3 4B/8B and Qwen3.8-27B model cards identify Apache-2.0 licensing. This is compatible with commercial use subject to its terms; redistribution requires the applicable license/notices and change notices. It is not a trademark grant or a quality warranty. No model weights are bundled with this repository. Capture the exact model revision, quantization, runtime version and notices when distributing a model or producing a self-hosted release. Model licensing, runtime licensing and customer subscription entitlements are three separate concerns.

Gemma and Llama were not rejected as inherently noncommercial. They have their own model terms, which would require separate review rather than assuming every open-weight model has Apache terms.

Cloudflare's `@cf/qwen/qwen3-30b-a3b-fp8` documentation announced retirement on 20 November 2026, so it was excluded as a new default. The native adapter supports the tested chat/schema contracts of `@cf/qwen/qwen3.8-27b` and `@cf/zai-org/glm-4.7-flash`. The latter was selected for the review-required pilot after lower latency and compute consumption in this small evaluation; this does not establish general superiority. Other native models must pass wire-contract tests before being added. Self-hosted model names remain configuration, not hard-coded business logic.

The [GLM-4.7-Flash model card](https://huggingface.co/zai-org/GLM-4.7-Flash) identifies MIT licensing. Retain applicable copyright/permission notices if distributing its weights, and review the exact pinned release terms. The deployed pilot calls Cloudflare's hosted model rather than distributing weights. Its [Cloudflare model page](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/) documents $0.0605/million input and $0.40/million output tokens as equivalent unit pricing. No paid upgrade was enabled.

## Changes implemented

- Provider selection: legacy Gemini, native Workers AI, or an authenticated compatible service. An invalid explicit provider/configuration fails closed; it never silently spends on another provider.
- D1-backed admission: global route concurrency, per-author concurrency, UTC daily attempt limits and optional expiry/disable rules. Defaults for the new service are one inference at a time, two active generation jobs, forty attempts per author/day. These are conservative controls, not a measured capacity promise.
- Stable request identity includes author, operation, route, model, thinking mode and prompt. Successful outputs are encrypted and replayed without another reservation. Lease fencing prevents an old attempt overwriting a newer result. Transport ambiguity can still duplicate underlying compute; exactly-once GPU execution is not claimed.
- Per-request ceiling of three attempts and twelve attempts across an operation. Temporary failures use persisted cooldowns and bounded Workflow backoff. Daily Workers AI exhaustion blocks the route until the UTC reset; there is no paid fallback.
- Time, input-byte, output-token and response-byte limits; no remote redirects carrying the service credential. Partial/truncated, refused or malformed completions are rejected. JSON schema constrains structure; existing application validation remains authoritative.
- Usage records retain model, tokens, provider-reported neurons where available, and success. Account usage is authenticated and owner-bound. Prompts and raw provider diagnostics are not logged by the new service. Replay outputs expire after roughly 24 hours; usage/attempt counters after roughly 30 days through hourly cleanup. Existing saved drafts have their existing product retention.
- Interactive inference shares a 120-second deadline, before the mobile writer's 135-second timeout and onboarding's 180-second lease. Background jobs use durable steps. Jobs remain queued when admission is full; interrupted dispatches recover by stable Workflow identity.
- New-model generated drafts require factual/personal-experience review by default and cannot automatically publish through the existing review guard. A schema cannot prove truthfulness.
- Minute cron checks remain, but idle ticks no longer create a maintenance Workflow. Hourly cleanup remains. The previous unconditional five steps per minute plus hourly cleanup implied 7,224 steps/day even without customers. The new idle baseline is 144 steps/day, calculated from the code, not a measured busy-day total.

Migration `0004_ai_service.sql` is additive. It introduces operational usage/limit records and a neuron column. This is **not a completed subscription or billing implementation**: there are no purchases, payment webhooks, monthly credits, refunds or signed/offline license keys yet. Future plan assignment must happen through a trusted server-side billing path. Do not expose plan mutation to the mobile client. Customer-facing draft credits should use an idempotent reserve/settle/release ledger separate from low-level inference attempts.

## Evidence and limitations

The local machine has approximately 24 GB RAM, a Ryzen 7 7435HS and a 4 GB RTX 3050 A Laptop GPU. Ollama was already installed. A Qwen3 4B evaluation alias used a 16K context. Three initial synthetic cases exercised judging, writing and repair. One story was rejected; another draft remained below the requested word minimum and invented an earlier author critique despite an empty archive. This model was **not approved for automatic commercial writing**. Short isolated latency observations are not a concurrency benchmark.

Real Workers AI binding calls succeeded in the free account with the documented model. The first three fictional fixtures were correctly judged unsuitable rather than forced into publishable stories. The evaluation then added public-reference writer probes. These deliberately isolate writing even if a documentation page fails newsworthiness; this exception exists only in the evaluation harness, never in production selection. Full results and human review belong in `ai-validation.md`.

The Node platform proxy cannot serialize an AbortSignal. The evaluation harness therefore omits that option at the proxy boundary. Production code calls the binding inside workerd directly and supplies cancellation. A mocked transport test is not proof of remote cancellation or compute refund. No hardware purchases, multi-GPU throughput, fleet failover, provider SLA, Android background inference or unlimited-user claims were validated.

Cloudflare states that standard inference is not used to train its models and generally does not retain prompt/response content, subject to the documented exceptions; operational metadata and separately enabled stateful features have different treatment. The app still sends selected sources, author settings and writing examples to the configured inference service. Changing to self-hosting changes that processor boundary; it does not remove the app's own storage responsibilities.

## Capacity and costs

Workers AI offers 10,000 neurons/day on Free. Beyond the free allocation, Free requests fail; paid use requires an upgrade. The documented Qwen3.8-27B unit prices are $0.45/million input and $3.20/million output tokens, with a separate cached-input rate. These are future planning inputs, not charges enabled by this work. Model mix, prompt length, output length and repairs all change how many drafts fit.

Other ceilings matter independently: Workers requests/CPU, Workflows steps/storage, D1 read/write/storage and notification/provider quotas. At review time Workflows Free included 3,000 steps/day; D1 Free included five million row reads/day, 100,000 row writes/day and 5 GB total storage. Index writes and query plans matter. A durable queue handles bursts within limits; it cannot create more quota or sustain demand permanently above service capacity.

Measure a representative set of complete jobs (including discovery, judge, repairs, failed attempts and preview/rewrite traffic). Track per-job neurons, steps, D1 rows read/written, completion latency, queue age, factual errors and review/edit acceptance. Use Cloudflare's dashboard as the authoritative account-wide meter, including failed/truncated calls whose usage may not reach the app. Do not count registered users as simultaneously generating users.

For planning only:

`daily drafts <= min(available neurons / measured neurons per draft, available workflow steps / measured steps per draft, available D1 writes / measured writes per draft, measured inference throughput)`

Reserve headroom for failures, previews, other account traffic and burstiness. Then divide by observed drafts per active author/day. No substitution of guessed averages yields a defensible customer limit. Before offering paid plans, run a burst/load test at the proposed service level, check queue-delay targets and unit margins, and arrange external monitoring and backup recovery. A future larger GPU service can sit behind the same endpoint; a larger control-plane tier may still be necessary.

## Sources and finding ledger

| Finding | Primary evidence | Confidence / boundary |
|---|---|---|
| Native binding removes a separate model API secret | [Workers AI bindings](https://developers.cloudflare.com/workers-ai/configuration/bindings/) | Documented and real calls verified; still uses the Cloudflare account |
| Free AI is bounded and fails above allowance | [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [error codes](https://developers.cloudflare.com/workers-ai/platform/errors/) | Current documentation; owner confirmed Free, billing API itself returned 403 |
| Native model contract and price | [Qwen3.8-27B on Workers AI](https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/) | Wire verified; quality needs task evaluation |
| Retiring candidate should not be adopted | [Qwen3-30B-A3B-FP8](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/) | Documented retirement date; review future catalog changes |
| Model terms | [Qwen3 4B](https://huggingface.co/Qwen/Qwen3-4B), [Qwen3 8B](https://huggingface.co/Qwen/Qwen3-8B), [Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B), [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0) | Model-specific licenses, not universal advice for all weights |
| Alternative model terms differ | [Gemma 3](https://huggingface.co/google/gemma-3-4b-it), [Llama 3.1](https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct) | Review exact version before selection |
| Quantized owned-hardware server | [llama.cpp](https://github.com/ggml-org/llama.cpp), [server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) | Supported features; no ByLine throughput measurement |
| GPU serving alternative | [vLLM online serving](https://docs.vllm.ai/en/latest/serving/online_serving/), [Docker deployment](https://docs.vllm.ai/en/latest/deployment/docker/) | Candidate architecture, not a deployed fleet |
| Local evaluation compatibility | [Ollama compatible API](https://docs.ollama.com/api/openai-compatibility), [structured outputs](https://docs.ollama.com/capabilities/structured-outputs), [thinking](https://docs.ollama.com/capabilities/thinking) | Tested on local Ollama; do not generalize local features to its cloud service |
| On-device alternative | [LiteRT-LM](https://developers.google.com/edge/litert-lm) | Not integrated or benchmarked in ByLine |
| Durable execution and limits | [Workflow rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/), [retry semantics](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/), [pricing](https://developers.cloudflare.com/workflows/reference/pricing/) | Code and isolated tests; busy-day capacity remains unmeasured |
| Database limits | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) | Shared account constraints, not a fixed user count |
| Processor privacy boundary | [Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/) | Subject to documented exceptions and future terms |
| Local remote-binding evaluation | [Wrangler getPlatformProxy](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy) | Real binding through a Node proxy; signal serialization caveat above |

## Handoff and remaining decisions

Use the rollout guide to select a provider explicitly after quality and integration checks. Preserve Gemini as an explicit rollback option during migration, not an automatic fallback. Revisit paid infrastructure only when observed use and revenue justify it. The next product work is trusted plan assignment and customer credit accounting; prices, allowances and plan names are intentionally not invented here. No design can promise permanent free operation for an unknown number of paying customers.
