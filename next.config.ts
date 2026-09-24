import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The user intentionally removed AGENTS.md/CLAUDE.md from this repo;
  // don't let Next.js silently regenerate them on every dev/build.
  agentRules: false,
};

export default nextConfig;
