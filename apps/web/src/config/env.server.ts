/**
 * Server-only configuration for the character-sheet same-origin proxy.
 *
 * Never import this module from client components or `"use client"` code: it
 * reads `process.env` (via `ServerEnvironment`), which is only populated on
 * the server. `RULES_WORKER_URL` must never leak through `NEXT_PUBLIC_*`.
 */

export type ServerEnvironment = {
  RULES_WORKER_URL?: string;
};

export type RulesWorkerConfiguration = {
  rulesWorkerUrl: string;
};

export function readRulesWorkerConfiguration(
  env: ServerEnvironment = process.env as ServerEnvironment,
): RulesWorkerConfiguration {
  const raw = env.RULES_WORKER_URL;
  if (raw === undefined || raw.trim() === "") {
    throw new Error(
      "RULES_WORKER_URL is not configured. Set it in server-side environment variables.",
    );
  }
  return { rulesWorkerUrl: raw };
}
