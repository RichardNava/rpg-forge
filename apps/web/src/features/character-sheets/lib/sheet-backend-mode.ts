/**
 * Single shared resolver for the Character Sheets backend mode.
 *
 * - `"local"` is explicit isolated development/test only: the workshop runs
 *   `createLocalSheetBackendV2` in the browser tab and no Turnstile, Worker,
 *   D1, or R2 is involved.
 * - Everything else — including missing, empty, or unknown values — resolves
 *   to `"remote"`, the protected Worker path. Unknown values fail closed to
 *   remote so a typo can never silently enable the local bypass.
 *
 * NOTE: this module reads `process.env.NEXT_PUBLIC_*` / `process.env.NODE_ENV`
 * per key, never bare `process.env`. Next.js statically inlines per-key
 * accesses in the client bundle; a bare `process.env` reference does not
 * survive bundling and would resolve differently on server and client,
 * breaking hydration.
 */
export type SheetBackendMode = "local" | "remote";

export interface SheetBackendModeEnv {
  NEXT_PUBLIC_CHARACTER_SHEET_BACKEND?: string;
  NODE_ENV?: string;
}

export function resolveSheetBackendMode(
  overrides?: SheetBackendModeEnv,
): SheetBackendMode {
  const backend =
    overrides?.NEXT_PUBLIC_CHARACTER_SHEET_BACKEND ??
    process.env.NEXT_PUBLIC_CHARACTER_SHEET_BACKEND;
  const nodeEnv = overrides?.NODE_ENV ?? process.env.NODE_ENV;
  const raw = (backend ?? (nodeEnv === "test" ? "local" : "remote"))
    .trim()
    .toLowerCase();
  return raw === "local" ? "local" : "remote";
}
