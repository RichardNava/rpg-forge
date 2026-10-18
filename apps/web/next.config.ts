import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages publish TypeScript source through their exports.
  // Next must compile them before resolving the packages' ESM .js specifiers.
  transpilePackages: [
    "@repo/character-sheet-draft",
    "@repo/character-sheet-generation",
    "@repo/character-sheet-pdf-renderer",
    "@repo/character-sheet-portraits",
  ],
  experimental: {
    // TypeScript ESM-style ".js" specifiers map to ".ts" sources (webpack).
    // Production `pnpm build` pins `--webpack` because Turbopack has no
    // extensionAlias equivalent and cannot resolve the workspace packages'
    // established ".js" ESM convention.
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    },
  },
};

export default nextConfig;

// Enable calling `getCloudflareContext()` in `next dev`.
// See https://opennext.js.org/cloudflare/bindings#local-access-to-bindings.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
