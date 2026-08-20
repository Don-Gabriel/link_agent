/**
 * Verify that a production build compiles, WITHOUT touching `.next`.
 *
 * `next dev` and `next build` both own `.next/`. Running a build while the dev
 * server is live replaces the chunks that server still holds references to, and
 * every subsequent request dies with `Cannot find module './331.js'` or a
 * missing vendor-chunk. It reads like a catastrophic code failure and is purely
 * a clobbered cache — the only cure being to delete `.next` and restart.
 *
 * So this builds into `.next-verify` instead, via the NEXT_DIST_DIR hook in
 * next.config.ts. Use it for "does this still compile"; use `npm run build` for
 * an actual deploy.
 *
 * A node wrapper rather than an inline env var because `VAR=x cmd` is not valid
 * in a Windows npm script, and adding cross-env for one line is a dependency
 * this project does not need.
 */
import { spawnSync } from "node:child_process";

const result = spawnSync("next", ["build"], {
  stdio: "inherit",
  // Windows resolves `next` to next.cmd, which needs a shell.
  shell: true,
  env: { ...process.env, NEXT_DIST_DIR: ".next-verify" },
});

process.exit(result.status ?? 1);
