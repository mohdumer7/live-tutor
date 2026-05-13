import path from "node:path";
import dotenv from "dotenv";
import type { NextConfig } from "next";

// Load env from the monorepo root so we don't have to duplicate `.env` into
// every app. Next reads process.env when exposing NEXT_PUBLIC_* to the client,
// so populating it here also covers the browser bundle.
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const nextConfig: NextConfig = {
  transpilePackages: ["@live-tutor/schema"],
  reactStrictMode: true,
  // Pin tracing root to the live-tutor monorepo so Next ignores the user's
  // global lockfile and only walks our own dependency graph.
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
