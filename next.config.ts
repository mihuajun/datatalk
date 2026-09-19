import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  reactStrictMode: true,
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
