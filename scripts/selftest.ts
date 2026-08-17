/**
 * Self-test for the pure logic that would fail SILENTLY in production:
 * little-text escaping, length accounting, and the daily scheduler.
 *
 * These are the functions where a bug does not throw — it just produces a
 * mangled post or a cycle that never fires. Run with:  node scripts/selftest.mjs
 * (Node 22.18+ / 24 strips the TypeScript types on import.)
 */
import { toLittleText, MAX_COMMENTARY } from "../lib/linkedin";
import { assemblePost, checkLength, hookOf } from "../lib/format";
import {
  nextDailyRun,
  localClock,
  parseHhMm,
  normalizeHhMm,
  isValidTimeZone,
  safeTimeZone,
  nextSlotRun,
  isDayEnabled,
  parseDaysMask,
  describeDays,
  MASK_DAILY,
  MASK_WEEKDAYS,
  MASK_WEEKENDS,
} from "../lib/schedule";
import {
  clampLead,
  MAX_LEAD_MINUTES,
  MAX_SLOTS,
  MIN_LEAD_MINUTES,
  MISSED_AFTER_MINUTES,
} from "../lib/slots";
import { MAX_AUTO_CAP } from "../lib/distribute";
import { DEFAULT_STYLE, parseStyle, PRESETS, signatureBudget, styleBlock } from "../lib/style";

let failures = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\nlittle-text escaping");
{
  const reserved = ["\\", "|", "{", "}", "@", "[", "]", "(", ")", "<", ">", "#", "*", "_", "~"];
  for (const ch of reserved) {
    const out = toLittleText(`a${ch}b`);
    check(`escapes ${JSON.stringify(ch)}`, out === `a\\${ch}b`, `got ${JSON.stringify(out)}`);
  }

  // The backslash must be escaped FIRST, or the escapes added for other
  // characters get escaped again and the post fills with stray backslashes.
  check(
    "backslash is not double-escaped",
    toLittleText("a(b") === "a\\(b",
    `got ${JSON.stringify(toLittleText("a(b"))}`,
  );

  const real = "Ableton 12.2 ships MIDI generators (finally) — the tradeoff is CPU.";
  const escaped = toLittleText(real);
  check("realistic sentence escapes parens", escaped.includes("\\(finally\\)"), escaped);
  check("realistic sentence keeps prose intact", escaped.includes("Ableton 12.2 ships"), escaped);
}

console.log("\nhashtag templates");
{
  const out = toLittleText("New synth today #Eurorack and more");
  check("converts to hashtag template", out.includes("{hashtag|\\#|Eurorack}"), out);
  check("does not leave a bare escaped hash", !out.includes("\\#Eurorack"), out);

  // A hash mid-word is not a hashtag and must stay literal text.
  const midword = toLittleText("channel#3 is dead");
  check("mid-word hash stays escaped", midword.includes("channel\\#3"), midword);
}

console.log("\nlength accounting");
{
  // Escaping expands text, so a plaintext-only check would pass a post that
  // LinkedIn then rejects. This is the case that proves the check is needed.
  const parens = "(a)".repeat(700); // 2100 plain chars, 2800 escaped
  const result = checkLength(parens);
  check("counts the escaped length, not the plain one", result.escapedChars > result.plainChars,
    `${result.plainChars} plain vs ${result.escapedChars} escaped`);

  const overflow = "(a)".repeat(1100); // 3300 plain -> 4400 escaped
  check("rejects a post that only overflows after escaping",
    !checkLength(overflow).withinLimit,
    `${checkLength(overflow).escapedChars} escaped vs cap ${MAX_COMMENTARY}`);

  check("accepts ordinary prose", checkLength("A normal post about synthesis.").withinLimit);
}

console.log("\npost assembly");
{
  const out = assemblePost({
    body: "Line one.\n\n\n\n\nLine two.",
    sourceUrl: "https://cdm.link/x",
    hashtags: ["MusicTech", "DSP", "Extra", "no"],
  });
  check("collapses runaway blank lines", !out.includes("\n\n\n"), JSON.stringify(out));
  check("appends the source", out.includes("Source: https://cdm.link/x"));
  check("caps hashtags at two", out.includes("#MusicTech #DSP") && !out.includes("#Extra"), out);
  check("drops too-short tags", !out.includes("#no"), out);

  // The cap is per-agent now; the default above must stay two regardless.
  const four = assemblePost({
    body: "Body text here.",
    hashtags: ["MusicTech", "DSP", "Extra", "Audio"],
    maxHashtags: 4,
  });
  check("honours a raised hashtag cap", four.includes("#Extra") && four.includes("#Audio"), four);

  const none = assemblePost({ body: "Body text here.", hashtags: ["MusicTech"], maxHashtags: 0 });
  check("a zero cap appends no tags", !none.includes("#"), none);

  const hook = hookOf("A".repeat(400));
  check("hook is truncated to the fold", hook.length <= 211, `${hook.length}`);
}

console.log("\nstyle config");
{
  // Every install that predates style_json has '{}' in that column. If this
  // does not resolve to the house style, every existing agent's voice changes
  // silently on deploy — the one failure mode that matters most here.
  const empty = parseStyle({});
  check(
    "an empty config is exactly the house style",
    JSON.stringify(empty) === JSON.stringify(DEFAULT_STYLE),
    JSON.stringify(empty),
  );
  check("null resolves to the house style", parseStyle(null).structure === "prose");
  check("garbage resolves to the house style", parseStyle("nonsense").emoji === "none");
  check("an array is rejected as a config", parseStyle([1, 2]).hashtagCount === 2);

  // Out-of-range values must clamp rather than reach the prompt verbatim.
  check("unknown enum falls back", parseStyle({ structure: "haiku" }).structure === "prose");
  check("hashtag count clamps to 5", parseStyle({ hashtagCount: 99 }).hashtagCount === 5);
  check("negative hashtag count clamps to 0", parseStyle({ hashtagCount: -3 }).hashtagCount === 0);

  // An inverted word window would produce "write 200-80 words", which the model
  // resolves at random — the parser has to repair it.
  const inverted = parseStyle({ minWords: 200, maxWords: 80 });
  check(
    "an inverted word range is repaired",
    inverted.maxWords > inverted.minWords,
    `${inverted.minWords}-${inverted.maxWords}`,
  );

  check("a signature without a source is dropped", parseStyle({ signature: { maxWords: 8 } }).signature === null);
  check("a zero budget disables the signature",
    parseStyle({ signature: { source: "F1", budgetPerFive: 0 } }).signature === null);
  const sig = parseStyle({ signature: { source: "F1 radio", budgetPerFive: 2 } }).signature;
  check("a valid signature survives", sig?.source === "F1 radio" && sig.budgetPerFive === 2);

  check("non-string custom rules are dropped", parseStyle({ customRules: [1, null, "keep me"] }).customRules.length === 1);
}

console.log("\nstyle prompt rendering");
{
  // The prompt block is what actually reaches the model — if a setting does not
  // change it, the control in the UI is decorative.
  const houseBlock = styleBlock(DEFAULT_STYLE);
  check("house style forbids emoji", houseBlock.includes("EMOJI: none at all"), "");
  check("house style forbids a call to action", houseBlock.includes("No call to engage"), "");
  check("house style bans the influencer phrases", houseBlock.includes("Let that sink in"), "");
  check("house style keeps the signature rule", houseBlock.includes("SIGNATURE LINE"), "");

  const loud = styleBlock(PRESETS.operator.style);
  check("operator preset asks for emoji", loud.includes("use them naturally"), "");
  check("operator preset asks for a direct close", loud.includes("one clear, specific ask"), "");
  check("operator preset drops the signature", loud.includes("NO catchphrase"), "");

  // Bullets must be the literal unicode mark, never markdown — LinkedIn renders
  // no markdown, so "- " would publish as a stray hyphen.
  const bullets = styleBlock(PRESETS.explainer.style);
  check("bullet styles specify a unicode mark", bullets.includes("→ "), "");
  check("bullet styles forbid markdown lists", bullets.includes('never "-", "*" or "1."'), "");
  check("markdown stays banned in every style", bullets.includes("NO markdown"), "");

  const custom = styleBlock({ ...DEFAULT_STYLE, customRules: ["Never name my employer"] });
  check("custom rules reach the prompt", custom.includes("Never name my employer"), "");

  // Rationing: at or over budget must read as a refusal, not an invitation.
  check("signature budget warns when over", signatureBudget(DEFAULT_STYLE, 3).includes("Do NOT"), "");
  check("signature budget invites when unused", signatureBudget(DEFAULT_STYLE, 0).includes("good moment"), "");
  check("no signature means no budget line", signatureBudget(PRESETS.operator.style, 2) === "");
}

console.log("\npost time normalisation");
{
  // The whole point: a browser's time input does not always hand back "HH:MM",
  // and the old code silently ignored anything that did not, while still
  // reporting a successful save.
  check("accepts HH:MM", normalizeHhMm("18:00") === "18:00");
  check("pads a single-digit hour", normalizeHhMm("9:30") === "09:30", `${normalizeHhMm("9:30")}`);
  check("strips seconds", normalizeHhMm("18:00:00") === "18:00", `${normalizeHhMm("18:00:00")}`);
  check("trims surrounding space", normalizeHhMm("  7:05  ") === "07:05");
  check("midnight is valid", normalizeHhMm("00:00") === "00:00");
  check("last minute of the day is valid", normalizeHhMm("23:59") === "23:59");

  check("rejects an empty half-entered value", normalizeHhMm("") === null);
  check("rejects a 12-hour string", normalizeHhMm("6:30 PM") === null);
  check("rejects an impossible hour", normalizeHhMm("24:00") === null);
  check("rejects an impossible minute", normalizeHhMm("12:60") === null);
  check("rejects prose", normalizeHhMm("evening") === null);
}

console.log("\ndaily scheduler");
{
  const next = nextDailyRun("Asia/Kolkata", "09:30");
  check("next run is in the future", next.getTime() > Date.now());
  check("next run is within 24h", next.getTime() - Date.now() <= 24 * 3600_000 + 1000);

  const clock = localClock("Asia/Kolkata", next);
  check("lands on the requested local time", clock.hour === 9 && clock.minute === 30,
    `got ${clock.hour}:${String(clock.minute).padStart(2, "0")}`);

  // Asking at exactly the post time must give tomorrow, not right now —
  // otherwise a just-finished cycle immediately looks due again and loops.
  const atTime = nextDailyRun("UTC", "00:00", new Date(Date.UTC(2026, 0, 1, 0, 0, 0)));
  check("same-time request rolls to tomorrow",
    atTime.getTime() === Date.UTC(2026, 0, 2, 0, 0, 0),
    atTime.toISOString());

  const midnight = localClock("UTC", new Date(Date.UTC(2026, 0, 1, 0, 30, 0)));
  check("midnight hour normalises to 0", midnight.hour === 0, `got ${midnight.hour}`);

  check("bad timezone falls back instead of throwing",
    typeof localClock("Not/AZone").hour === "number");
  check("bad time string falls back to a default", parseHhMm("nonsense").hour === 9);
}

console.log("\nweekday masks");
{
  check("daily includes every day", [0, 1, 2, 3, 4, 5, 6].every((d) => isDayEnabled(MASK_DAILY, d)));
  check("weekdays excludes Sunday", !isDayEnabled(MASK_WEEKDAYS, 0));
  check("weekdays excludes Saturday", !isDayEnabled(MASK_WEEKDAYS, 6));
  check("weekdays includes Mon-Fri", [1, 2, 3, 4, 5].every((d) => isDayEnabled(MASK_WEEKDAYS, d)));
  check("weekends is Sat and Sun only",
    isDayEnabled(MASK_WEEKENDS, 0) && isDayEnabled(MASK_WEEKENDS, 6) &&
    ![1, 2, 3, 4, 5].some((d) => isDayEnabled(MASK_WEEKENDS, d)));

  // An empty mask would mean a slot that can never fire — a schedule that
  // silently never runs is the worst possible failure here, so it becomes daily.
  check("empty mask becomes daily", parseDaysMask(0) === MASK_DAILY);
  check("out-of-range bits are stripped", parseDaysMask(0b11111111111) === MASK_DAILY);
  check("nonsense falls back to weekdays", parseDaysMask("banana") === MASK_WEEKDAYS);
  check("a real mask survives", parseDaysMask(MASK_WEEKDAYS) === MASK_WEEKDAYS);

  check("describes weekdays", describeDays(MASK_WEEKDAYS) === "Mon-Fri", describeDays(MASK_WEEKDAYS));
  check("describes daily", describeDays(MASK_DAILY) === "Every day");
  check("describes a custom set",
    describeDays(0b0101010) === "Mon, Wed, Fri", describeDays(0b0101010));
}

console.log("\nslot scheduling");
{
  // A Thursday, 08:00 UTC.
  const thu = new Date(Date.UTC(2026, 7, 13, 8, 0, 0));
  check("reference day is a Thursday", thu.getUTCDay() === 4);

  const sameDay = nextSlotRun("UTC", "18:00", MASK_DAILY, thu)!;
  check("later today is today", sameDay.getTime() === Date.UTC(2026, 7, 13, 18, 0, 0),
    sameDay.toISOString());

  const tomorrow = nextSlotRun("UTC", "06:00", MASK_DAILY, thu)!;
  check("earlier than now rolls to tomorrow",
    tomorrow.getTime() === Date.UTC(2026, 7, 14, 6, 0, 0), tomorrow.toISOString());

  // Friday 18:00 exists, so a Mon-Fri slot asked on Thursday evening lands Friday.
  const friday = nextSlotRun("UTC", "06:00", MASK_WEEKDAYS, thu)!;
  check("weekday mask lands on Friday", friday.getUTCDay() === 5, friday.toISOString());

  // Asked on Friday after the time, a Mon-Fri slot must skip the weekend.
  const friEvening = new Date(Date.UTC(2026, 7, 14, 20, 0, 0));
  const monday = nextSlotRun("UTC", "09:00", MASK_WEEKDAYS, friEvening)!;
  check("weekday mask skips the weekend", monday.getUTCDay() === 1, monday.toISOString());
  check("and lands on the right instant",
    monday.getTime() === Date.UTC(2026, 7, 17, 9, 0, 0), monday.toISOString());

  // Weekend-only, asked on a Thursday, must reach Saturday.
  const saturday = nextSlotRun("UTC", "10:00", MASK_WEEKENDS, thu)!;
  check("weekend mask reaches Saturday", saturday.getUTCDay() === 6, saturday.toISOString());

  // Strictly future: asking AT the slot time gives the next occurrence, which is
  // what stops a just-completed run immediately re-qualifying as due and looping.
  const atExactly = nextSlotRun("UTC", "08:00", MASK_DAILY, thu)!;
  check("asking at the slot time rolls forward",
    atExactly.getTime() === Date.UTC(2026, 7, 14, 8, 0, 0), atExactly.toISOString());

  check("every result is in the future", nextSlotRun("Asia/Kolkata", "09:30", MASK_DAILY)!.getTime() > Date.now());
  check("a bad timezone still returns a date",
    nextSlotRun("Not/AZone", "09:30", MASK_DAILY) instanceof Date);
}

console.log("\nlead time (the review window)");
{
  // The window is a MINIMUM, never a target: a late tick must give MORE warning
  // than promised, never less. Anything under 10 minutes is a notification
  // rather than a chance to read the post, so it is clamped rather than obeyed.
  check("clamps below the floor", clampLead(1) === MIN_LEAD_MINUTES);
  check("clamps a zero lead", clampLead(0) === MIN_LEAD_MINUTES);
  check("clamps a negative lead", clampLead(-30) === MIN_LEAD_MINUTES);
  check("clamps above the ceiling", clampLead(99999) === MAX_LEAD_MINUTES);
  check("keeps a sensible value", clampLead(15) === 15);
  check("rounds a fractional value", clampLead(15.4) === 15);
  check("nonsense falls back to the default", clampLead("soon") === 15);

  // The floor must leave room for a 5-minute cron to fire at least once inside
  // the window. If this ever fails, slots would be noticed after their moment.
  check("the floor exceeds a 5-minute tick", MIN_LEAD_MINUTES > 5);
  // And a missed slot must be declared late enough that a couple of ticks can
  // retry a definite publish failure before it expires.
  check("missed window leaves room to retry", MISSED_AFTER_MINUTES >= 3 * 5);
}

console.log("\nslot and cap ceilings agree");
{
  // The auto-publish cap is derived from the slot count. If MAX_AUTO_CAP were
  // lower than MAX_SLOTS, a legal final slot would be created happily and then
  // fail at send time with auto_cap_reached — a limit you only discover by
  // having a post silently not go out.
  check("MAX_AUTO_CAP is not below MAX_SLOTS", MAX_AUTO_CAP >= MAX_SLOTS,
    `cap ${MAX_AUTO_CAP} vs slots ${MAX_SLOTS}`);
}

console.log("\ntimezone guard (feeds Postgres AT TIME ZONE)");
{
  // Postgres THROWS on an unknown zone rather than falling back, so anything
  // reaching SQL must be filtered here first. A bad value in agents.timezone
  // would otherwise turn the daily cap check into a 500 and block publishing.
  check("accepts a real zone", isValidTimeZone("Asia/Kolkata"));
  check("accepts UTC", isValidTimeZone("UTC"));
  check("rejects nonsense", !isValidTimeZone("Not/AZone"));
  check("rejects empty", !isValidTimeZone(""));

  check("safeTimeZone passes a real zone through", safeTimeZone("Europe/Berlin") === "Europe/Berlin");
  check("safeTimeZone falls back to UTC on nonsense", safeTimeZone("Not/AZone") === "UTC");
  check("safeTimeZone falls back to UTC on null", safeTimeZone(null) === "UTC");
  check("safeTimeZone falls back to UTC on undefined", safeTimeZone(undefined) === "UTC");
  check("safeTimeZone falls back to UTC on empty", safeTimeZone("") === "UTC");
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
