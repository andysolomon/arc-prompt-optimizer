import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: ["**.ts.net"],
  // The app is self-contained; do not trace files from the parent repository.
  outputFileTracingRoot: fileURLToPath(new URL("./", import.meta.url)),
  images: {
    // Account avatars from Google and X. Served unoptimized, so this only allowlists the hosts.
    remotePatterns: [
      { protocol: "https", hostname: "*.googleusercontent.com" },
      { protocol: "https", hostname: "pbs.twimg.com" },
      { protocol: "https", hostname: "abs.twimg.com" },
    ],
  },
  experimental: {
    // lib/arc-core is copied verbatim from the repository, whose ESM sources import "./x.js" for "./x.ts".
    extensionAlias: { ".js": [".js", ".ts", ".tsx"] },
  },
};

export default nextConfig;
