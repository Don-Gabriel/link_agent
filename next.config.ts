import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Deployed on Vercel (Hobby, serverless functions). No standalone output;
  // the cycle driver is /api/cron/tick with maxDuration 300.
  //
  // The build directory is overridable so a verification build can be run
  // WITHOUT clobbering a dev server that is already running.
  //
  // `next dev` and `next build` both own .next/. Run a build while the dev
  // server is live and the build replaces the chunks the running server still
  // holds references to — after which every request dies with
  // `Cannot find module './331.js'` or a missing vendor-chunk. It looks like a
  // catastrophic code failure and is purely a clobbered cache; the only cure is
  // deleting .next and restarting.
  //
  // `npm run build:check` sets NEXT_DIST_DIR so the two never share a directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
