import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standard Node hosting. Render's pilot uses start:hosted; the cycle driver
  // is /api/cron/tick, triggered through /api/cron/wake.
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

  /**
   * Response headers. This dashboard can publish to a real LinkedIn profile
   * from a URL that is guessable and crawlable, so the cheap browser-side
   * protections are worth having even with one user.
   *
   * Deliberately NOT a full Content-Security-Policy: Next injects inline
   * scripts for hydration, a script-src that forbids them breaks the app, and
   * the nonce plumbing that fixes it properly is a real project. frame-ancestors
   * is the one directive that cannot be set any other way and costs nothing.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Two years, and only meaningful over HTTPS — which on Vercel is all
          // there is. Stops a first request over http:// being downgradeable.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          // An uploaded GIF must never be sniffed into something executable.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Clickjacking: nothing here should ever be framed. X-Frame-Options
          // for older browsers, frame-ancestors for the ones that matter.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          // Do not leak the path of an authenticated page to third parties.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Nothing here needs hardware. Saying so removes the prompt entirely.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
