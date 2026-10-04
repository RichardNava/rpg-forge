import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E for the Character Sheets workshop (4F stabilization lane A).
 *
 * - Chromium only.
 * - The Web app is served by `next dev` in EXPLICIT LOCAL Character Sheets
 *   backend mode, so the run is deterministic and provider-free: no
 *   Cloudflare Turnstile, no Workers AI, no remote D1/R2, no deployed
 *   Worker, no external inference quota.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    acceptDownloads: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Production build + start: deterministic, no Turbopack dev quirks, and
    // NEXT_PUBLIC_CHARACTER_SHEET_BACKEND is baked in at build time.
    command: "pnpm build && pnpm exec next start --port 3100",
    url: "http://127.0.0.1:3100/character-sheets",
    reuseExistingServer: !process.env.CI,
    timeout: 600 * 1000,
    env: {
      NEXT_PUBLIC_CHARACTER_SHEET_BACKEND: "local",
    },
  },
});
