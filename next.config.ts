import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: {
    // Spotify endsong_*.json exports can be dozens of MB each and are uploaded
    // several at a time. Next's proxy buffers request bodies for re-reads and
    // would otherwise truncate anything over the 10MB default.
    proxyClientMaxBodySize: '1gb',
  },
  /* config options here */
};

export default nextConfig;
