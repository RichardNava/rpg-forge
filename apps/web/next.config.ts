import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The renderer publishes TypeScript source through its workspace export.
  // Next must compile it before resolving the package's ESM .js specifiers.
  transpilePackages: ["@repo/character-sheet-pdf-renderer"],
};

export default nextConfig;

// Enable calling `getCloudflareContext()` in `next dev`.
// See https://opennext.js.org/cloudflare/bindings#local-access-to-bindings.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
