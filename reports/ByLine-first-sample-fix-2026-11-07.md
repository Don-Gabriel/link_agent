# First-time sample generation: validation and latency fix

Date: 7 November 2026. This is a backend update; Android 1.0.4 remains compatible.

## Reproduced failure

Two first-run attempts completed their AI calls but did not save a sample. An
isolated production reproduction with the same five selected subjects,
inspirational tone, 200–300 words and 15 hashtags confirmed `too_short` after
both repair passes. The backend returned HTTP 503 for that writing-validation
failure. The Android client deliberately hides raw server errors at that status,
so it displayed “ByLine is temporarily unavailable” instead of the real reason.

The original prose prompt requested only two or three paragraphs. Repairs had
the undersized draft but not the original research excerpt, and instructed the
model to edit without adding material. A separate prompt also contradicted the
exact hashtag setting by allowing fewer tags or none. Slow optional news feeds
added to the delay before writing began.

## Changes

- Long prose requests now receive a paragraph/word plan scaled to the requested
  range. The body word count explicitly excludes rationale and hashtags.
- The initial writer gets up to 1,200 characters of source evidence instead of
  400. Repair requests retain that original evidence and may expand explanations,
  implications and limitations without inventing facts.
- Repair feedback names the actual body word count and shortfall. The prompt
  consistently requires the selected exact hashtag count.
- Interactive sample discovery uses a four-second deadline per optional source,
  while retaining the 20-feed research selection and 24-fetch budget. Background
  generation retains the normal eight-second deadline.
- Unusable source/quality results return HTTP 422 with the safe, actionable
  message. AI allowance exhaustion returns HTTP 429. Actual service failures
  remain HTTP 503, with internal details redacted. This works in the existing APK.
- Final sample validation logs rule names and counts, without logging sample
  text, credentials or personal profile data.

## Verified

A real production test with the previously failing settings returned **204 body
words and 15 hashtags in 26 seconds**. This is one observed run, not a fixed
latency guarantee. The isolated author was removed afterward; no LinkedIn post,
notification or timetable change was made. The user's existing setup was not
edited, and no phone installation was performed.

Cloud typecheck and all **41 cloud tests** passed. Regression checks cover the
200–300-word/15-tag repair, retained evidence, error classification, and aborting
a slow feed while keeping another publisher's result. Root logic/health,
catalogue and ByLine checks passed, as did the Next.js production build.

Production deployment: `63d44dbf-9952-42b3-88a8-0fe4b54c0b92` at
`https://byline-api.byline-b79.workers.dev`, dedicated ByLine account only.
Existing secrets and variables were preserved. No schema, APK or PDF change was
needed. Retry **Generate sample** in the existing app.
