import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./pdf-renderer/wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["pdf-renderer/**/*.workerd.test.ts"],
  },
});
