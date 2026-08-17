import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./pdf-extraction/wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["pdf-extraction/**/*.workerd.test.ts"],
  },
});
