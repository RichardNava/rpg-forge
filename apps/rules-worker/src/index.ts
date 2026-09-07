import {
  MAX_CLEANUP_BATCH_SIZE,
  runExpiryCleanup,
} from "@repo/rules-analysis-session";
import { createAppDeps } from "./deps.js";
import { type Env } from "./env.js";
import { handleRequest } from "./handler.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, createAppDeps(env));
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const deps = createAppDeps(env);
    const result = await runExpiryCleanup({
      now: deps.clock.now(),
      repository: deps.repository,
      cleaner: deps.cleaner,
      limit: MAX_CLEANUP_BATCH_SIZE,
    });
    if (result.failed.length > 0) {
      console.warn(
        `rules-analysis cleanup: ${result.failed.length}/${result.processed} sessions failed`,
      );
    }
  },
} satisfies ExportedHandler<Env>;
