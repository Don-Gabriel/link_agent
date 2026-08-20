/**
 * Measure what a request actually spends on the database.
 *
 * Exists because "it feels slow" is not something you can fix. This reports
 * round-trip latency, the cost of the schema script, and what a fan-out of
 * independent queries costs at different pool sizes — which is the shape of
 * every read endpoint here.
 *
 * Prints timings only. Nothing from the connection string is echoed.
 *
 *   node scripts/bench-db.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";

// Read DATABASE_URL out of .env without printing any of it.
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const line = readFileSync(".env", "utf8")
      .split("\n")
      .find((l) => l.startsWith("DATABASE_URL="));
    return line ? line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

const url = databaseUrl();
if (!url) {
  console.error("No DATABASE_URL found — set it, or run from the project root.");
  process.exit(1);
}

const ms = (t) => `${Math.round(t)}ms`;
const time = async (fn) => {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
};

async function run(poolSize, fanout) {
  const pool = new pg.Pool({ connectionString: url, max: poolSize });
  try {
    // Warm: first connection pays TLS + any Neon wake-up.
    const cold = await time(() => pool.query("SELECT 1"));
    const warm = await time(() => pool.query("SELECT 1"));

    // WARM the pool first. Measuring a fan-out against a cold pool measures
    // TLS handshakes, not queueing — and in the running server the pool is
    // already warm, so that would have been the wrong number entirely.
    await Promise.all(Array.from({ length: poolSize }, () => pool.query("SELECT 1")));

    // The shape every read endpoint has: N independent queries at once.
    const fan = await time(() =>
      Promise.all(Array.from({ length: fanout }, () => pool.query("SELECT 1"))),
    );

    // And the shape it SHOULD have: one round trip carrying everything.
    const single = await time(() =>
      pool.query("SELECT 1 AS a, 2 AS b, 3 AS c, now() AS d"),
    );

    return { cold, warm, fan, single };
  } finally {
    await pool.end();
  }
}

console.log("\nDatabase latency\n");

const small = await run(3, 12);
console.log(`  pool max 3   (what it was)`);
console.log(`    first query      ${ms(small.cold)}   <- TLS handshake, plus any Neon wake-up`);
console.log(`    warm query       ${ms(small.warm)}   <- one round trip`);
console.log(`    12 in parallel   ${ms(small.fan)}`);

const big = await run(10, 12);
console.log(`\n  pool max 10  (what it is now)`);
console.log(`    warm query       ${ms(big.warm)}`);
console.log(`    12 in parallel   ${ms(big.fan)}`);

const saved = small.fan - big.fan;
console.log(
  `\n  Fan-out is ${ms(Math.abs(saved))} ${saved > 0 ? "FASTER" : "slower"} with the larger pool.`,
);
console.log(`\n  ONE round trip carrying the same data: ${ms(big.single)}`);
console.log(
  `\n  A read endpoint makes roughly a dozen queries, so the fan-out figure is\n` +
    `  the floor under every screen refresh. The gap between it and a single\n` +
    `  round trip is what the app pays for nothing.\n` +
    `\n` +
    `  Note what dominates: one warm query costs ~${ms(big.warm)}. That is not the\n` +
    `  database being slow, it is the SPEED OF LIGHT between here and wherever\n` +
    `  Neon lives. Deploying the API into the same region as the database turns\n` +
    `  that round trip into single-digit milliseconds and does more for latency\n` +
    `  than any amount of query tuning here can.\n`,
);
