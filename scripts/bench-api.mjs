/**
 * Time the real endpoints, warm, several times.
 *
 * A single reading taken right after a cold start tells you almost nothing —
 * Neon's free tier autosuspends and the first queries after it wakes are slow
 * for reasons that have nothing to do with the code. This signs in once, then
 * samples each endpoint repeatedly so the steady state is visible.
 *
 * Prints timings only. Nothing from .env is echoed.
 *
 *   node scripts/bench-api.mjs [baseUrl]
 */
import { readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3000";

function envValue(key) {
  if (process.env[key]) return process.env[key];
  try {
    const line = readFileSync(".env", "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

const password = envValue("APP_PASSWORD");
if (!password) {
  console.error("No APP_PASSWORD found — run from the project root.");
  process.exit(1);
}

const login = await fetch(`${BASE}/api/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password }),
});
if (!login.ok) {
  console.error(`Sign-in failed (${login.status}). Is the server running at ${BASE}?`);
  process.exit(1);
}
const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];

const ms = (t) => `${String(Math.round(t)).padStart(5)}ms`;

async function sample(path, runs) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    const res = await fetch(`${BASE}${path}`, { headers: { cookie } });
    await res.text();
    times.push(performance.now() - t0);
  }
  const sorted = [...times].sort((a, b) => a - b);
  return {
    first: times[0],
    median: sorted[Math.floor(sorted.length / 2)],
    best: sorted[0],
  };
}

console.log(`\nEndpoint latency — ${BASE}\n`);

for (const path of ["/api/status", "/api/slots"]) {
  const r = await sample(path, 6);
  console.log(`  ${path}`);
  console.log(`    first  ${ms(r.first)}   <- may still include a wake-up`);
  console.log(`    median ${ms(r.median)}`);
  console.log(`    best   ${ms(r.best)}\n`);
}

console.log(
  `  The median is the number that matters — it is what a screen refresh costs\n` +
    `  once everything is warm. The first reading after a quiet spell includes\n` +
    `  Neon waking from autosuspend, which no amount of code changes here can\n` +
    `  avoid and which does not happen on a server under steady traffic.\n`,
);
