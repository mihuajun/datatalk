import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.STUDIO_DIST_DIR || ".next",
  typescript: { tsconfigPath: process.env.STUDIO_TSCONFIG_PATH || "tsconfig.json" },
  outputFileTracingExcludes: {
    "/*": [".workbuddy-local/**/*", ".runtime/**/*"],
  },
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  reactStrictMode: true,
  async headers() {
    return ["/oauth/:path*", "/preview/:path*"].map(source => ({ source, headers: [
      { key: "Cache-Control", value: "private, no-store" },
      // OAuth consent is a same-origin form POST; no-referrer makes its Origin null.
      { key: "Referrer-Policy", value: source.startsWith("/oauth/") ? "same-origin" : "no-referrer" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
    ] }));
  },
  experimental: {
    // Allow multipart report prompts to carry the configured 100 MB attachment budget.
    proxyClientMaxBodySize: "160mb",
  },
  serverExternalPackages: [
    "@databricks/sql",
    "@duckdb/node-api",
    "@duckdb/node-bindings",
    "@duckdb/node-bindings-darwin-x64",
    "@duckdb/node-bindings-darwin-arm64",
    "@duckdb/node-bindings-linux-x64",
    "@duckdb/node-bindings-linux-x64-musl",
    "@duckdb/node-bindings-linux-arm64",
    "@duckdb/node-bindings-linux-arm64-musl",
    "lz4-napi",
    "oracledb",
    "snowflake-sdk",
  ],
};

export default nextConfig;
