import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Deployed on Vercel (Hobby, serverless functions). No standalone output;
  // the cycle driver is /api/cron/tick with maxDuration 300.
};

export default nextConfig;
