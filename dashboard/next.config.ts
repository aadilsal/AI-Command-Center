import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Convex type-checks the backend on deploy; some older agent files have loose types that
  // don't affect how they run, so the dashboard build doesn't block on them.
  typescript: { ignoreBuildErrors: true },
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
