# AI service operations

Read [the architecture research](../docs/ai-service-research.md) and [validation results](../docs/ai-validation.md) before changing the live provider. The supported hosted candidates and compatible transport are implemented; a model's presence in the adapter is not a quality endorsement.

Current rollout: GLM-4.7-Flash on Workers AI, with review required. The real preview/background smoke and cleanup passed; see the validation record for the exact release and limitations.

## Provider configuration

The provider is a backend setting, never a client parameter. Absence of `AI_PROVIDER` preserves legacy Gemini for existing deployments. An explicitly invalid setting fails closed.

| Variable | Meaning / initial value |
|---|---|
| `AI_PROVIDER` | `workers-ai`, `compatible`, or explicit legacy `gemini` |
| `AI_MODEL` | Exact tested model name; native allowlist is in `src/ai-workers.ts` |
| `AI_DISABLE_THINKING` | `true` for the bounded non-reasoning evaluation configuration |
| `AI_TIMEOUT_MS` | Per inference attempt, default `90000`, maximum `120000` |
| `AI_MAX_INPUT_BYTES` | Serialized request ceiling, default `64000`, maximum `128000` |
| `AI_MAX_OUTPUT_TOKENS` | Request ceiling, default `8192`, maximum `16384` |
| `AI_MAX_CONCURRENCY` | Active inference leases per route, default `1` |
| `AI_ACTIVE_JOBS` | Active generation jobs for the new provider, default `2` |
| `AI_DAILY_ATTEMPT_LIMIT` | Fallback per-author attempt budget, default `40`, UTC reset |
| `AI_REQUIRE_REVIEW` | Defaults to required for new providers; keep `true` during the pilot |

Workers AI uses the `AI` binding already declared in `wrangler.jsonc`; no standalone model API key is needed. It does not run model weights inside the ordinary Worker CPU runtime. Keep the account on Free for the no-spend pilot. An application concurrency limit is not a dollar spending cap if someone later upgrades the account.

For a future self-hosted service, set `AI_PROVIDER=compatible`, `AI_BASE_URL=https://your-owned-inference-host/v1`, and the exact served model alias. Set `AI_SERVICE_TOKEN` using `wrangler secret put AI_SERVICE_TOKEN`; use a randomly generated secret of at least 32 characters. Do not put it in Git, the APK, a URL, or a public frontend variable. Require the credential at the inference proxy and restrict its network exposure. The adapter appends `/chat/completions`, sends standard schema/chat fields, disables redirects and never follows a service response to another host.

Local-only Ollama evaluation can use `AI_BASE_URL=http://127.0.0.1:11434/v1` with `AI_ALLOW_LOCAL_HTTP=true`. That exception does not make a laptop reachable from a deployed Worker. Provision the model/context explicitly before evaluation. No automatic download, paid provider selection or silent fallback happens in the app.

## Verification commands

From the repository root:

```powershell
npm test
npm run build:check
```

From `cloud/`:

```powershell
npm run types
npm run typecheck
npm test
```

The cloud test command performs a Wrangler dry run and runs against isolated Miniflare databases. It does not migrate production, send LinkedIn posts or use hosted inference.

Opt-in real hosted evaluation, from `cloud/`, after confirming that the named ByLine account is still Free:

```powershell
$env:AI_MODEL='@cf/zai-org/glm-4.7-flash'
npx tsx scripts/evaluate-ai.ts --run-free
```

The runner uses `eval.wrangler.jsonc`, an isolated remote AI binding without a D1 binding, route, customer credentials or publishing capability. `--run-free` is an operator confirmation, not an API-enforced billing check. It consumes the shared free AI allocation. Never run it unchanged on a paid account under a zero-spending requirement. `--references-only` reruns three public-reference writing probes. Inspect the saved JSON and review the actual prose: `passed` covers automated checks, not factual correctness.

For an explicitly configured compatible service, run `npx tsx scripts/ai-evaluate.ts --run` from the repository root. No cloud credential is required for local loopback evaluation. Results go to ignored `.byline-local/`; only selected non-customer evidence is copied into the research record.

## Rollout

1. Confirm the dedicated ByLine account and D1 IDs in `wrangler.jsonc`. Do not use other accounts. Record the current deployed version/configuration, verify current free allocation, back up D1 and preserve encryption/signing secrets.
2. Run the checks above. Keep `AI_REQUIRE_REVIEW=true`. Establish that the intended model is accessible on this account, complete the public/synthetic evaluation, then review an end-to-end draft before broad rollout. No passing JSON test authorizes unattended publishing.
3. Apply additive migration `0004_ai_service.sql` using `npx wrangler d1 migrations apply byline --remote` from `cloud/`. Then deploy the code, preserving existing non-AI settings/secrets with `--keep-vars` and explicitly selecting the new AI variables. Do not overwrite LinkedIn/Firebase settings or toggle publishing as an incidental part of an AI release.
4. Verify `/api/health`, protected-route rejection without authentication, owner-bound `/api/ai/usage`, and a naturally occurring scheduler tick. Exercise preview, queued generation, repairs, retry/replay and the factual-review guard on a disposable author without LinkedIn grants/devices. Inspect output and remove only that test author afterward.
5. Observe queue age, failures, provider usage, D1 rows and Workflow steps over representative traffic before assigning customer plan allowances. Retain the verified model/route/settings with the release record.

Rollback can select `AI_PROVIDER=gemini` with the existing secret, if that provider is still available and its quotas permit. It is an explicit operator decision, not automatic fallback. Alternatively roll back the Worker version. Leave the additive tables/column intact; do not undo the migration by dropping usage or customer data. Existing Workflows retain their captured deployment, so changing a route is not a cancellation of work already running. Do not rotate the token-encryption key casually; it also protects existing author credentials.

## Behavior under pressure

Excess generation jobs wait in D1. Active calls require atomic leases; another instance cannot independently overbook the same route. Request retries and durable step retries are bounded separately. Stored successful responses are encrypted and can be replayed within retention, while an expired attempt cannot overwrite a newer lease. Failures can consume attempt allowance even when they produce no customer draft. These operational limits must not be sold as successful-draft credits.

Daily Workers AI exhaustion stops new calls through a persisted circuit until midnight UTC. Provider overload uses a shorter cooldown. Auth/configuration errors do not cause a model switch. Ambiguous timeouts may still have consumed provider compute, and local cancellation cannot guarantee a refund. The Cloudflare dashboard is the authoritative total meter.

Hourly cleanup removes old replay records and counters. This controls storage; it is not a backup strategy. Production customer launch still needs external uptime alerting, tested backups, a reviewed privacy notice, representative quality/load acceptance and the separate trusted billing/entitlement implementation.
