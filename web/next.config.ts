import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The app is self-contained; do not trace files from the parent repository.
  outputFileTracingRoot: fileURLToPath(new URL("./", import.meta.url)),
  experimental: {
    // lib/arc-core is copied verbatim from the repository, whose ESM sources import "./x.js" for "./x.ts".
    extensionAlias: { ".js": [".js", ".ts", ".tsx"] },
  },
};

export default nextConfig;
