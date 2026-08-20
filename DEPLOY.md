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
