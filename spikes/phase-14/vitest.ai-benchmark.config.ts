import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./ai-benchmark/wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["ai-benchmark/**/*.workerd.test.ts"],
  },
});
