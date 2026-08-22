# Deploying

Everything here only runs while `npm run dev` is up on a laptop. Deploying is
what removes that — no dev server, no adb, no PowerShell tick loop.

Do these in order. Steps 1–4 are required for anything to work at all.

---

## 1. Import the repo into Vercel

New Project → import `link_agent` → framework auto-detects as Next.js.

**Do not deploy yet.** Set the environment variables first (step 2), or the
first build comes up with no database and no keys.

## 2. Environment variables

Copy every variable from your local `.env` into Project Settings →
Environment Variables, for **Production** and **Preview**.

Two must CHANGE rather than be copied:

| Variable | Local | Deployed |
|---|---|---|
| `LINKEDIN_REDIRECT_URI` | `http://localhost:3000/api/linkedin/callback` | `https://<your-app>.vercel.app/api/linkedin/callback` |
| `LINKEDIN_LIVE` | whatever you have | `true` when you want it posting for real |

Everything else — `DATABASE_URL`, `GEMINI_API_KEY`, the model cascade,
`TOKEN_ENCRYPTION_KEY`, `APP_SECRET`, `APP_PASSWORD`, `CRON_SECRET` — copies
across unchanged.

`TOKEN_ENCRYPTION_KEY` in particular must be **byte-identical** to the local
one, or every stored LinkedIn token becomes undecryptable and you will have to
reconnect.

## 3. Enable Fluid compute

Project Settings → Functions → **Fluid compute: on**.

Not optional. Without it a Hobby function is capped at **60 seconds**; with it,
300. A generation cycle takes 30–90 seconds per slot and they run serialized,
so on a 60-second cap the tick gets killed part-way and slots fail with no
clear reason. `vercel.json` asks for `maxDuration: 300`, which Vercel silently
lowers if Fluid compute is off.

## 4. Tell LinkedIn about the new redirect

LinkedIn Developer Portal → your app → Auth → **Authorized redirect URLs**, add:

```
https://<your-app>.vercel.app/api/linkedin/callback
```

Then open the deployed app, sign in, and **Reconnect** on the Status tab. The
existing token was issued against `localhost` and will not work.

## 5. Point a cron at the tick

Nothing generates or sends without this. `/api/cron/tick` is the only driver.

Use [cron-job.org](https://cron-job.org) — free, and every minute if you want:

- **URL** `https://<your-app>.vercel.app/api/cron/tick`
- **Every** 5 minutes
- **Header** `X-Cron-Secret: <your CRON_SECRET>`

Do **not** use Vercel's own cron on Hobby — it permits once per day. Do not use
GitHub Actions — it floors at 5 minutes and routinely runs 15+ minutes late,
which breaks the review-window promise.

The Schedule tab shows a red **SCHEDULER STOPPED** panel if nothing checks in
for 16 minutes, so a misconfigured cron announces itself rather than looking
like a quiet day.

## 6. Point the phone at the deployment

On the app's sign-in screen, change the server address from
`http://10.0.2.2:3000` to `https://<your-app>.vercel.app`, then sign in.

Then build a real APK so it stops depending on a USB cable:

```bash
cd mobile
flutter build apk --release
```

The file lands in `mobile/build/app/outputs/flutter-apk/app-release.apk`.
Install it and the laptop is out of the loop entirely.

---

## Why the region is pinned

`vercel.json` sets `"regions": ["cle1"]` — Cleveland, which is AWS
**us-east-2**, the same region as the Neon database.

This is the single biggest performance decision in the project. Measured from
a laptop in India against that database:

```
one warm query      ~296ms      <- almost entirely network distance
12 in parallel      ~600ms
```

A screen refresh makes roughly a dozen queries. In the same region those round
trips drop to single-digit milliseconds, so the same work costs ~30ms instead
of ~600ms. Deploying far from the database would throw that away and no amount
of query tuning would win it back.

If you ever move the Neon project to a different region, change this to match.
`node scripts/bench-db.mjs` prints the current latency picture.

## After deploying

- Watch the first tick land: the red scheduler panel should clear within 5 minutes.
- **"SCHEDULER NEVER STARTED" appears once on a fresh deployment** — the heartbeat
  row does not exist yet. The first tick clears it. Not a fault.
- `LINKEDIN_LIVE=true` means real posts on a real profile. Leave it `false` for
  a day if you want to watch the cadence before it goes live.

---

# Backups and restore

A GitHub Action (`.github/workflows/backup.yml`) dumps the database nightly at
19:40 UTC, encrypts it with AES-256, and keeps it as a build artifact for 90
days. It needs two repository secrets — `DATABASE_URL` and `BACKUP_PASSPHRASE`.

The parts worth protecting are the published archive, the writing samples and
the edit notes: the agent's learned voice. Everything else can be rebuilt from
this repository.

## Restoring

1. Open the repo on GitHub → **Actions** → **Backup** → pick a run → download
   the `db-backup-YYYY-MM-DD` artifact and unzip it.
2. Decrypt it with the passphrase you stored as `BACKUP_PASSPHRASE`:

   ```
   gpg --decrypt --output restored.dump backup-YYYY-MM-DD.dump.gpg
   ```

3. Inspect before you touch anything real:

   ```
   pg_restore --list restored.dump
   ```

4. Restore into a NEW empty database first, never over the live one:

   ```
   pg_restore --no-owner --no-privileges --dbname "$NEW_DATABASE_URL" restored.dump
   ```

Point `DATABASE_URL` at the restored database only once you have looked at it.

---

# Running the tests

```
npm test          # pure logic, no database, ~1s
npm run test:db   # every query against a real Postgres
npm run build:check
cd mobile && flutter analyze lib test && flutter test
```

`npm run test:db` needs a **throwaway** database — it creates and deletes
agents. Never point it at the live one. Locally:

```
createdb linkdin_dbtest
DATABASE_URL=postgres://postgres:postgres@localhost:5432/linkdin_dbtest npm run test:db
```

CI runs all of these on every push to `main` (`.github/workflows/ci.yml`),
using a disposable Postgres container for the database job.

**Why this suite exists separately from `npm test`:** `scripts/selftest.ts` is
pure logic and never opens a connection, so invalid SQL that is valid
TypeScript passes it. That is exactly how `listDueSlots` shipped with an
ambiguous column and the scheduler never ran once, with every test green.

---

# Keeping it alive

Five things can stop this app months from now. Four are handled; the fifth needs
you to know about it.

## 1. The LinkedIn token expires every 60 days — HANDLED

It cannot renew itself. The watchdog pushes a notification at 7 days remaining
and again once it has expired. Reconnect from the Status tab.

## 2. The cron stops — HANDLED

`schedulerHealth()` marks the scheduler stale after 16 minutes without a tick,
the Schedule tab shouts, and the watchdog pushes.

## 3. The database fills up — HANDLED

`lib/retention.ts` sweeps the tables that grow without bound, once a day, from
the cron tick. `rejections` is the one that mattered: twenty to forty rows per
cycle, several cycles a day, forever.

Kept deliberately: `posts` (the archive IS the product, and the writer reads it
for voice) and `distributions` (publish idempotency — deleting a row could let a
post send twice).

## 4. Backups — HANDLED

Nightly, encrypted, 90 days. See the restore steps above.

## 5. GitHub disables the scheduled workflows — YOU NEED TO KNOW THIS

**GitHub turns off scheduled workflows in any repository with no commits for 60
days.** Backup and Watchdog both run on a schedule. So two quiet months and the
safety net switches itself off — silently, with only an email from GitHub.

There is no way to fix this from inside the repo; any workaround is a scheduled
job, and scheduled jobs are exactly what gets disabled.

**How you would notice:** the Status tab has a `Health check` readout showing
how long since the watchdog last ran. Under 90 minutes is normal. If it says
hours or days, the workflows are off — go to the Actions tab and re-enable them,
which takes one click.

**How to prevent it:** push any commit within any 60-day window. Even a typo fix
in a comment resets the clock.

---

# Security

## What is protected

| | |
|---|---|
| Every `/api` route | fail-closed session gate in `middleware.ts`; a new route is protected by default |
| Login | HMAC session cookie, httpOnly + secure + sameSite; 8 failures per 15 min per client, counted in Postgres so concurrent instances cannot dodge it |
| LinkedIn token | AES-256-GCM at rest, key never in the database |
| Cron and watchdog | `X-Cron-Secret`, timing-safe compare, 404 on mismatch so they do not advertise that they exist |
| SQL | every statement parameterised; the only interpolated identifiers are literals in `lib/retention.ts` |
| Uploads | type allowlist (JPG/PNG/GIF) and a 4MB cap |
| Browser | HSTS, nosniff, frame-ancestors none, referrer policy, permissions policy |

## If you lose the phone, or think the password leaked

**Change `APP_SECRET` in Vercel and redeploy.** Every session everywhere dies
instantly, because the cookie is a signature over that secret and nothing else.
Change `APP_PASSWORD` too if the password itself is the worry.

This is the revocation mechanism. There is no "sign out everywhere" button:
sessions are verified in Edge middleware, which cannot reach Postgres, so
there is nowhere to keep a revocation list. Rotating the secret does the same
job in about thirty seconds.

## Known and accepted

- **One password, no second factor.** Proportionate for one user behind a URL
  nobody has. If this ever gets a second user, it needs real accounts.
- **Sessions last 30 days.** A stolen unlocked phone is a real session until you
  rotate `APP_SECRET`.
- **`google-services.json` is committed.** Not a credential — Firebase documents
  it as public, it ships inside every APK, and the key is scoped to the package.
  The service-account key is NOT in the repository.
