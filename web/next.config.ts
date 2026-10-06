import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

// Local development keeps its keys in the repo root .env, which Next in web/
// does not read by itself. Parse it here (process env wins); on Vercel the
// file is absent and the platform provides the environment.
const envFile = join(root, ".env");
if (existsSync(envFile)) {
  for (const raw of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

// The engine in ../src is NodeNext ESM with explicit .js specifiers so the
// CLI runs on plain Node. Turbopack takes those literally, so the site builds
// with webpack and maps them back to the .ts sources.
const nextConfig: NextConfig = {
  serverExternalPackages: ["@napi-rs/canvas"],
  outputFileTracingRoot: root,
  outputFileTracingIncludes: {
    "/api/card": ["../assets/fonts/**", "../assets/brand/mark-cells.png"],
  },
  experimental: { externalDir: true },
  poweredByHeader: false,
  webpack: (config) => {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    config.resolve.alias = { ...(config.resolve.alias ?? {}), "@engine": join(root, "src") };
    return config;
  },
};

export default nextConfig;
