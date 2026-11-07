# ByLine

## Download for Android

**[Download ByLine 1.0.4 APK](https://github.com/Don-Gabriel/link_agent/raw/refs/heads/main/releases/android/byline-latest.apk)**

Open this link on your phone, download the APK, then open it to install or update.
Android 7.0 or newer is required. [Installation steps](releases/android/README.md)
· [Release verification](reports/ByLine-navigation-discovery-2026-11-07.md)

**Start here:** [Complete project handbook (PDF)](output/pdf/ByLine-Complete-Project-Handbook.pdf)
| [Download Android APK](https://github.com/Don-Gabriel/link_agent/raw/refs/heads/main/releases/android/byline-latest.apk)
| [Phone installation guide](releases/android/README.md)
| [Documentation and every-file reference](docs/README.md)

The downloadable Android release uses the dedicated [Cloudflare backend](cloud/README.md)
and works without the development computer. The original Next.js/PostgreSQL web
deployment described below remains a separate runtime. See the
[current authentication/setup verification report](reports/ByLine-auth-onboarding-fix-2026-11-07.md)
and [APK metadata/checksum](releases/android/release.json) for this repository snapshot.

A writing workspace for LinkedIn: discover relevant stories, prepare posts in
your voice, and review them before publishing. Choose from **1,112 subjects**
across 55 specialist groups, combine industries, and add your own editorial focus.

The native app includes account setup, optional voice preferences, writing samples,
a timetable, a composer, and a post archive. Setup and regular drafts use the same
writer and voice rules. See [local development](BYLINE-LOCAL.md) and
[live operation](BYLINE-LIVE.md) for the native app; the operator setup below
documents the original web deployment.

Forked from the autonomous-creator pipeline (discover → judge → write, behind a
Postgres advisory lock) and retargeted at a real professional profile. The
important change is that a cycle produces a **draft**, and publishing is a
separate, guarded decision.

## What it does

- **At your chosen posting times**, it pulls fresh candidates across
  your categories, scores every one in a single batched LLM call on five
  criteria, and writes a post about the winner — **only if it clears 6.5/10**.
  A story must also score at least 7/10 for subject fit and non-duplication,
  and 6/10 for author fit. Qualifying stories rotate across selected categories,
  favouring subjects covered least recently instead of repeatedly picking one beat.
  If no relevant source qualifies, it waits rather than forcing an unrelated post.
- **Approval queue by default.** Drafts wait for you with their scores, the
  editorial reasoning, and a marker showing exactly where LinkedIn will cut the
  text off. Flip auto-publish on once the voice sounds like you.
- **Your own posts**, with images, an optional pass to tighten the hook, and
  publish-now or save-as-draft.
- **Optional voice setup**: 10 tones, free-form instructions, writing samples,
  audience, structure, word range, openings, closings, emoji, hashtags and phrases
  to avoid. Skip customization to start with a professional voice, then edit it later.
- **Searchable subjects**: select up to 12 at once, including specialist areas
  across industries. Specialist sources use targeted news searches and must pass
  editorial relevance checks. Source availability varies by subject and date.
- **Broader research**: Google News, Bing News and curated publisher/research feeds
  cover every selected category and free-text topic. The cloud checks up to 20 feeds
  per generation, balances publishers, and excludes recently consumed links and
  near-identical headlines. Even one subject gets multiple search sources; fresh,
  relevant evidence is still required. Research uses feed/search excerpts, not
  unrestricted full-page crawling.
- **Optional signatures**, disabled for new native accounts. Existing accounts
  retain their saved preferences.

## Verification

```sh
npm test
npm run test:catalogue
npm run build:check
cd mobile
flutter analyze
flutter test
```

With the isolated local database and backend running, `npm run test:catalogue:api`
checks setup and persistence without model calls or LinkedIn publishing.

## Setup

### 1. Create the LinkedIn app

At [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps):

1. **Create app.** It must be associated with a LinkedIn Page — a throwaway
   page is fine, it is only for app ownership and is not what you post to.
2. **Products tab** → request both:
   - *Sign In with LinkedIn using OpenID Connect* — identity, gives the person URN
   - *Share on LinkedIn* — gives `w_member_social`, the permission to post

   Both are self-serve and approve in minutes. You do **not** need the
   Community Management API; that one is a real review process and is only
   required for posting to company Pages.
3. **Auth tab** → add redirect URLs. Add both:
   - `http://localhost:3000/api/linkedin/callback`
   - `https://<your-app>.vercel.app/api/linkedin/callback`

   These must match `LINKEDIN_REDIRECT_URI` byte for byte. A trailing slash
   mismatch is the single most common cause of a failed connection.
4. Copy the Client ID and Client Secret.

### 2. Configure

```bash
cp .env.example .env
npm run keygen    # prints TOKEN_ENCRYPTION_KEY, APP_SECRET and CRON_SECRET
```

Fill in `DATABASE_URL` (Neon), `GEMINI_API_KEY`, the two LinkedIn values, and
the generated secrets. Set `APP_PASSWORD` to something only you know — that
password is the only thing between the internet and your profile.

Leave `LINKEDIN_LIVE=false` for now.

### 3. Run

```bash
npm install
npm run dev
```

Open <http://localhost:3000>, sign in with `APP_PASSWORD`, and complete setup:
your name, what you write about, categories, timezone and daily post time. The
schema applies itself on first database access.

Then **Connect LinkedIn** in the sidebar and approve the consent screen.

### 4. Watch it before you trust it

Leave `LINKEDIN_LIVE=false` for the first few days. The agent drafts on
schedule and the queue fills up, but nothing can reach LinkedIn — the publish
path refuses at the first check. Read the drafts. When they sound like you,
set `LINKEDIN_LIVE=true` and publish one by hand. Only after that is
auto-publish worth turning on.

### 5. Schedule the cron

The agent only acts when something pings its tick endpoint. Every 15 minutes:

```bash
curl -H "X-Cron-Secret: $CRON_SECRET" https://<your-app>.vercel.app/api/cron/tick
```

Use [cron-job.org](https://cron-job.org) or a GitHub Actions schedule. Two
overlapping triggers are harmless — every cycle passes through the same
advisory lock, and every publish through its own idempotency key.

**Do not add a keep-alive ping.** An earlier version of this file suggested
hitting `/api/health` every few minutes to stop Neon's free tier autosuspending
after ~5 idle minutes. Do not: that endpoint runs a query, so pinging it holds
the compute open around the clock. At Neon's smallest compute that is
0.25 CU × 730 h = **182 CU-hours a month against a 100 CU-hour allowance** —
the database is suspended for the last third of every month, and the agent
stops posting. It buys about a second of cold start and costs the whole budget.

Let it suspend. The tick wakes it, and `connectionTimeoutMillis` in
[lib/db.ts](lib/db.ts) is already set to 20s precisely so the first request
after a quiet spell waits for the wake-up instead of failing.

## Commands

```bash
npm run dev          # local development
npm run build        # type-check and production build
npm test             # self-test: text escaping, length accounting, scheduler
npm run check:feeds  # which RSS sources are actually reachable from your network
npm run keygen       # generate the three secrets
```

## Things that will bite you

1. **Tokens last 60 days and cannot renew themselves.** LinkedIn issues
   programmatic refresh tokens only to approved Marketing Developer Platform
   partners; a standard self-serve app gets 60 days and nothing else. The
   dashboard warns from day 50 and pauses cleanly at expiry. Reconnecting is
   one click and loses nothing. This is the one unavoidable manual step, and
   anyone promising otherwise is either an approved partner or scraping.

2. **Never automate linkedin.com with a browser.** Playwright against the real
   site violates the terms and gets accounts restricted. Everything here goes
   through the official API.

3. **Ambiguous sends are not retried.** If LinkedIn never answers, we cannot
   tell whether the post went out — reading your own posts back needs
   `r_member_social`, a restricted scope this app does not have. So the send is
   frozen, flagged in the dashboard, and you are asked to check your profile
   and say what happened. Retrying automatically is how you end up posting
   twice to a real audience.

4. **Fifteen characters must be escaped in post text.** LinkedIn's "little"
   format reserves `\ | { } @ [ ] ( ) < > # * _ ~`, and an unescaped
   parenthesis in ordinary prose is enough to corrupt a post. This is handled
   in one place (`lib/linkedin.ts`) and covered by `npm test` — do not build a
   second path to the Posts API that skips it.

5. **The 3000-character limit applies to the escaped text.** Prose full of
   parentheses can gain a hundred-plus characters when escaped, so a post that
   looks fine can be rejected. `checkLength` measures the escaped form.

6. **Some feed URLs are unverified.** Several music-tech hosts were unreachable
   from the network this was built on, which may mean the feed is dead or may
   mean that network blocked them. They are marked `verified: false` in
   `lib/discovery.ts`. Run `npm run check:feeds` from your own machine to find
   out; a dead feed costs one logged warning per cycle and nothing else.

## File map

```
lib/linkedin.ts     LinkedIn API client — little-text escaping, posts, images, OAuth
lib/distribute.ts   the publish path: idempotency claim, definite vs ambiguous failure
lib/accounts.ts     token storage, the 60-day expiry policy
lib/crypto.ts       AES-256-GCM for tokens at rest
lib/auth.ts         dashboard session, enforced by middleware.ts
lib/cycle.ts        the daily orchestrator, behind the advisory lock
lib/discovery.ts    category-grouped feeds, interleaved so one feed can't dominate
lib/judge.ts        batched scoring, 5 criteria, category assignment
lib/writer.ts       LinkedIn voice, the rationed Marvel line, custom-post polish
lib/format.ts       deterministic assembly: source line, hashtags, length checks
lib/schedule.ts     daily cadence in your timezone
lib/categories.ts   the three categories and their hashtag vocabulary
app/page.tsx        gate, setup, dashboard
```

## Deploying

Push to a repo, import it in Vercel, and set every variable from `.env` in the
project settings — including `LINKEDIN_REDIRECT_URI` pointing at the deployed
domain, and that same URL registered on the LinkedIn app. Then point the cron
at the deployed `/api/cron/tick`.
