import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Every page is prerendered. The site ships as static files (see docs/architecture.md#platform).
  output: 'export',
  // AGENTS.md is maintained by hand; stop `next dev` from rewriting it.
  agentRules: false,
};

export default nextConfig;
