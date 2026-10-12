import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Lets a second `next dev` run alongside the first (Playwright starts one server with Clerk keys and one without).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  poweredByHeader: false,
  allowedDevOrigins: ["**.ts.net"],
  // The app is self-contained; do not trace files from the parent repository.
  outputFileTracingRoot: fileURLToPath(new URL("./", import.meta.url)),
  experimental: {
    // lib/arc-core is copied verbatim from the repository, whose ESM sources import "./x.js" for "./x.ts".
    extensionAlias: { ".js": [".js", ".ts", ".tsx"] },
  },
};

export default nextConfig;
