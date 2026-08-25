# Ink & Filament — the design system

The source of truth for how this product looks and behaves. Every value in
`mobile/lib/theme.dart` and `app/globals.css` comes from here; nothing is
invented at a call site.

---

## 1. What this product actually is

Not a scheduler. Not a dashboard. **A one-person newsroom where the reporter
never sleeps and you hold the presses.**

An agent reads the wire overnight, judges what it finds against your standards,
and sets one story in your voice. Then it stops and waits for an editor. You
are that editor. The whole product is the moment between *copy exists* and
*copy goes out* — and that moment has a deadline.

That framing decides everything below. The vocabulary is a copy desk's, because
the app already thinks in those terms and did before this redesign: the **fold**
(what LinkedIn cuts at 210 characters), the **slot** (which in a real newsroom
is the copy chief's chair), **passed over**. Where a name was invented, it now
comes from the same world — as long as it stays readable; see §8.

What it is *not*: paper. No cream ground, no serif display, no fake newsprint.
The register is a dark instrument used at 07:00 with one hand. The newsroom
shows up in the information model and the language, never as pastiche.

### The daily loop, which the design must make fast

1. A notification, or you open the app.
2. **Is anything waiting on me, and how long have I got?**
3. Read the draft — properly, above the fold first.
4. Decide: let it go at its time / send it now / fix it / discard it.
5. Close the app.

Steps 2–4 are the product. Everything else is configuration you touch once.

---

## 2. Colour

A warm ink ground, because a blue-black ground is the default every dark app
reaches for and it makes the accents look like status LEDs. Warm ink reads as a
room with a lamp in it.

Colour encodes exactly one question: **which clock is this on?** Three accents,
each with a role. Nothing is coloured for decoration; a colour with no meaning
is a colour that teaches people to stop reading colour.

### Ground — ink

| Token | Hex | Job |
|---|---|---|
| `ink` | `#0E0D0B` | The page. Copy sits directly on it. |
| `ink2` | `#161512` | Raised: sheets, sticky bars, the object you act on. |
| `ink3` | `#1E1C18` | Wells: inputs, pressed states, meter tracks. |
| `rule` | `#2A2721` | Hairline. Separation without a box. |
| `ruleStrong` | `#3B372F` | A real edge — inputs, outlined buttons. |

### Ink on the page — paper

| Token | Hex | Contrast on `ink` | Job |
|---|---|---|---|
| `paper` | `#F2EFE9` | 16.9:1 | Copy. The post itself, headings. |
| `paperDim` | `#B3ADA2` | 8.7:1 | Secondary prose, descriptions. |
| `paperFaint` | `#8A857B` | 5.3:1 | Captions, slugs, disabled. |

`paperFaint` is deliberately lighter than the value it replaces (`#6A7383`,
3.9:1), which failed WCAG AA at the 12px sizes it was used at.

### The three accents

| Token | Hex | Contrast | Means |
|---|---|---|---|
| `filament` | `#E8A76B` | 9.4:1 | **On the desk.** Still yours. Drafts, countdowns, the fold, review windows, anything you can still change your mind about. |
| `daylight` | `#7FB3C4` | 8.5:1 | **Out in the world.** Published, cleared, connected, healthy. Settled and cold. |
| `flare` | `#D9736E` | 6.1:1 | **Broken.** Missed, failed, expired, disconnected. Needs a human. |

These are **desaturated on purpose**, and that was a correction. The first cut
used `#FF8A3D`, `#45C8DC` and `#FF4D5E` — fully saturated, and against a
near-black ground they read as status LEDs rather than as ink. On a screen you
open at 07:00 to read one careful paragraph, that is the wrong temperature: it
makes an ordinary morning look like an incident.

Pulling each hue back toward paper cost nothing in legibility — every value
still clears AA comfortably, because contrast comes from lightness and the
saturation was never doing that work.

A fourth state — a slot that read its candidates and chose silence — gets
**no colour at all**, only `paperFaint`. Correct behaviour must never look like
an alarm; that is how you teach someone to distrust a quiet day.

The previous system carried five accents (`draft`, `live`, `alarm`, `good`,
`attention`). `good` and `live` always meant the same thing to a reader —
*settled, nothing to do* — so they are one colour now. Chanel's rule: take one
thing off.

Washes for fills are precomputed solids rather than alpha, so a fill never
shifts when it lands on a different ground: `filamentWash #2A1B0F`,
`daylightWash #0E2A30`, `flareWash #2C1214`.

`filament` has a second job, and the two never co-occur: in CONTENT it means
"on the desk", and in a CONTROL it means "selected". A chip and a draft are
never the same object, so no ambiguity arises — and a settings screen where
nothing is ever accented is one where the selected state is hard to find.

Colour also marks the **abnormal case only**. `running`, `live` and `waits for
you` are the ordinary state of a healthy agent; lighting all three lit three
colours on an ordinary day, which is three colours saying nothing. `paused`,
`dry run` and `publishes itself` are the three that make someone say "wait,
what?" — those carry the accent, their opposites stay quiet.

**Colour is never the only signal.** Every state carries an icon and a word.

---

## 3. Type

Three faces, three jobs, no overlap.

| Face | Role | Where |
|---|---|---|
| **Barlow Condensed** 500/600/700 | *The slug* | Section rules, screen titles, masthead, status chips, day initials. Uppercase, tracked out. Condensed because a phone column is narrow and a newsroom deck always was. |
| **IBM Plex Sans** (variable) | *The copy* | The post. Descriptions, buttons, anything read as language. |
| **IBM Plex Mono** 400/600/700 | *The clock* | Times, counts, scores, ids, countdowns. Tabular figures always. |

Barlow Condensed ships **static** instances, which matters: a variable axis in a
`TextStyle` silently makes it non-const and breaks const widget trees (logged in
`~/dev/design-references/PATTERNS.md`). Statics keep every style const.

The post is set in Plex Sans and not in something more characteristic on
purpose. This screen's job is to predict what a reader sees in the LinkedIn
feed; setting it in a display face would flatter copy that will not be rendered
that way. The character goes into the furniture around the copy, never into the
copy.

### Scale

| Token | Size / line | Face | Job |
|---|---|---|---|
| `copy` | 17 / 1.62 | Sans 400 | **The post.** The most readable thing on screen, because reading it carefully *is* the job. |
| `body` | 15 / 1.5 | Sans 400 | Prose. |
| `small` | 13.5 / 1.45 | Sans 400 | Secondary prose. |
| `micro` | 12 / 1.4 | Sans 400 | Captions. |
| `slug` | 11.5, +1.4 tracking | Cond 600 | Eyebrows, chips, labels. Uppercase. |
| `rule` | 13, +1.2 tracking | Cond 600 | Section headings. Uppercase. |
| `title` | 22 | Cond 700 | Screen titles. |
| `display` | 34 | Cond 700 | Masthead. |
| `data` | 14 | Mono 600 tab | Any figure in a column. |
| `clock` | 44 | Mono 700 tab | The countdown. One per screen, at most. |

Tabular figures on anything that changes in place. A countdown whose digits
change width reflows while you read it, and a number that jitters reads as
broken.

---

## 4. Space, shape, motion

- **Rhythm** 4 / 8 / 12 / 16 / 24 / 32 / 48. Nothing between.
- **Radius** 7 (chips, inputs) · 12 (objects) · 18 (sheets). Raised from 4/8/14:
  the tighter set read as an instrument, which was the intent, but combined
  with a visible border on every surface it also read as *tight*.
- **A card is a FILL, not an outline.** Separation comes from the raised ground
  and the space around it. Drawing a border on top of a fill states the same
  thing twice, and a page of outlined rectangles is what reads as cramped no
  matter how much padding sits inside them. Only the one object with a deadline
  gets an edge you actually notice.
- **Touch** 48px minimum, 8px minimum between adjacent targets.
- **Motion** one duration — 180ms, ease-out — for every state change. 320ms for
  route transitions. Reduced motion is honoured by not building the timeline,
  not by shortening it.

The single orchestrated moment: when an uncleared draft crosses into its last
two minutes, the clock moves `filament → flare` and the card's edge brightens
once. That is the only animation in the app that is not a state change, and it
earns its place because it marks the last point at which a decision is still
possible.

---

## 5. The signature: the fold

LinkedIn cuts a post at 210 characters and hides the rest behind *see more*.
That cut happens on a phone, which makes a phone the right place to judge
whether the hook survives it. Drawing the boundary is the single most useful
thing this app does that LinkedIn's own composer does not.

So it is drawn properly: a dashed cut in `filament` straight across the copy
column, breaking for a mono counter in the gutter —

```
╌╌╌╌╌╌╌╌╌╌  FOLD · 340 BELOW  ╌╌╌╌╌╌╌╌╌╌
```

— and the rule *is* the control. Copy starts collapsed, because what you see
first must be exactly what a reader scrolling their feed sees first.

Everything else stays quiet. One memorable element, executed precisely.

---

## 6. Layout: the card is not the default

The previous design put every screen inside a stack of identical bordered
panels, so nothing had hierarchy and the post — the one thing on screen worth
reading — was about a third of the box it sat in, competing with badges, five
score meters, a rationale and four unlabelled icon buttons.

The rule now:

> **Copy sits on the page. A box means an object you act on.**

Sections are separated by rhythm and a hairline with a Condensed slug on it.
A bordered surface appears for exactly three things: a draft awaiting a
decision, a posting slot, and a sheet. Anything else — settings, readouts,
history, diagnostics — is a list on the ground.

---

## 7. Information architecture

Five bottom-bar destinations, three of which were "set once and revisit",
became **three**, plus writing as a task rather than a place.

| Destination | Holds | Why |
|---|---|---|
| **Desk** | The deadline, drafts waiting on you, today's rail, anything broken | The daily loop, on one screen. The countdown used to live one tab away from the list of things it applied to. |
| **Archive** | Published · Passed over | Retrospective and read-only. Separated from Desk because nothing here needs a decision. |
| **Settings** | Timetable · Voice · Topics · LinkedIn · Diagnostics | Five configuration surfaces behind one index, each with a live one-line summary so the index answers most questions without being opened. |

**Compose is a full-screen route, not a tab.** Writing has a beginning and an
end; a tab makes it ambient and keeps stale state alive forever. Editing a
draft pushes the same route with the post loaded, which also removes the
cross-tab "bring the composer forward" hack the old shell needed. Leaving with
typed text asks first.

**There is no floating action button.** Every draft on the Desk ends in its own
row of buttons, and a control floating in the bottom-right corner sits
permanently on top of them — it covered "Send now" on the one card with a
deadline. It was also a claim this app cannot support: the recurring job is
DECIDING on what the agent wrote, not writing your own, and a FAB announces
itself as the main action on the screen. Write sits in each screen's header
instead.

### The draft card, top to bottom

```
┌──────────────────────────────────────────┐
│ p-0142 · AGENT · MUSIC-TECH       4h ago │  slug line
├──────────────────────────────────────────┤
│ ⚡ Sends at 09:30, in 2h 14m              │  the clock strip
│                                          │
│  Copy, set at 17/1.62 directly on the    │
│  ground. No inner box.                   │
│ ╌╌╌╌╌  FOLD · 340 BELOW  ╌╌╌╌╌╌╌╌╌╌╌╌╌╌ │  the signature
│                                          │
│  #MusicTech                              │
├──────────────────────────────────────────┤
│ ▸ Why this one                    8.4/10 │  collapsed: rationale + scores
├──────────────────────────────────────────┤
│ [ Clear for 09:30 ]  [ Send now ]    ⋯   │  named actions, never mystery icons
└──────────────────────────────────────────┘
```

Judge scores and editorial reasoning collapse behind one disclosure carrying
the total. They are the answer to *why did it pick this*, which is a question
asked occasionally — not five progress bars competing with the copy every time.

Actions are labelled. The old card offered send-now, edit and discard as three
unlabelled 48px icon squares, which is the least legible way to present three
irreversible-ish choices. Swipe is added as an accelerator — right to clear,
left to discard, both reversible — but never as the only path to an action.

---

## 8. Words

Named by what the editor controls, never by how the system is built. Active
voice. An action keeps its name through the whole flow: the button that says
*Discard* produces *Discarded*.

| Say | Not |
|---|---|
| Clear | Approve |
| Send now | Publish immediately |
| Passed over | Rejected |
| Stayed quiet | No post generated |
| On the desk | Pending review |
| The scheduler stopped | Cron error |

Where the newsroom metaphor and plain language disagreed, plain language won.
An earlier draft of this used **spike** for discarding copy — a real term, and
the right one for a desk — but one the reader has to learn. The framing earns
its place in the *structure* (the Desk, the fold, the day's rail, what a
posting time is), never by making a verb harder to read.

"Clear" lost its time, too. `Clear for 09:30` said the time twice — it is
already in the countdown caption directly above — and at 390pt it wrapped the
most-pressed button in the app onto two lines.

Empty screens are an invitation, not a shrug: *"Nothing on the desk. The agent
reads on its timetable and stays quiet on days when nothing clears the bar —
check the Archive to see what it passed over."*

Errors say what happened and what to do, in the interface's voice. They do not
apologise and they are never vague.

---

## 9. Quality floor

- Touch targets 48px; 8px between them.
- Every colour pairing above 4.5:1 on its own ground; every state also carries
  an icon and a word.
- Reduced motion genuinely honoured.
- No layout shift from a countdown — tabular figures, reserved width.
- Verified by screenshot on a real handset at 1080×2400, not an emulator, and
  not by assuming it compiled.
