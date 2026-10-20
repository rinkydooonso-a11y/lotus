import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, "../server");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@lotus/server"],
  experimental: { externalDir: true },
  webpack: (c) => {
    c.resolve.alias = { ...c.resolve.alias, "@lotus/server": path.join(serverDir, "src/index.ts"), "@lotus/anticheat": path.join(serverDir, "anticheat/index.ts") };
    // the .js-suffixed relative imports in server source resolve to .ts
    c.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return c;
  },
};
export default nextConfig;
