import type { CharacterSheetDraftV2 } from "./draft-schema-v2";
import type { CharacterSheetDraftIdentity } from "./draft-store";

/**
 * 4E1 — canonical V2 draft persistence port.
 *
 * This is a PARALLEL port. It deliberately coexists with the V1-typed
 * `CharacterSheetDraftStore` rather than replacing or widening it, because the
 * live V1 Worker still consumes that port. Widening V1 to
 * `CharacterSheetDraft | CharacterSheetDraftV2`, or introducing a
 * generic `<T>` store, would force a partial runtime cutover and would let a
 * canonical V2 consumer receive V1. Neither is acceptable, so this contract is
 * separate and V2-only at the type level.
 *
 * The identity type is REUSED, not duplicated: both ports address the same
 * opaque session/draft identity against the same immutable key layout.
 *
 * ## Semantics
 *
 * - **WRITE is V2 ONLY.** `putDraft` takes a canonical `CharacterSheetDraftV2`
 *   and rejects anything else, including a V1 snapshot. Canonical V1 on write is
 *   never performed; the caller is responsible for the V2 snapshot.
 * - **READ accepts persisted V1 OR V2 and ALWAYS returns canonical V2.**
 *   `parseCanonicalCharacterSheetDraft` is the single compatibility boundary,
 *   and read migration happens in memory only.
 * - **Historical V1 bytes are NEVER rewritten on read.** Reading a stored V1
 *   snapshot performs zero writes; the next state-changing snapshot is what
 *   first stores V2. This keeps version history continuous and immutable.
 * - **`listDraftVersions` and `deleteDraft` are schema-neutral** key operations.
 *   They read the numeric version segment of each immutable object key, which is
 *   a draft version, never a draft schema version.
 *
 * ## Scope: no head knowledge, no transport knowledge
 *
 * The store knows only the requested identity and the requested immutable
 * version. It does NOT know the D1 draft head: `currentVersion`, `pendingVersion`
 * and `expectedVersion` are Worker orchestration concerns. The store verifies
 * only that the requested KEY identity/version agrees with the canonical payload
 * identity/version; a disagreement is stored corruption, never a concurrency
 * outcome.
 *
 * It is also transport-neutral: no HTTP status, error code, request or response
 * type appears here.
 */
export interface CharacterSheetDraftStoreV2 {
  /**
   * Atomically creates an initial draft snapshot only when the key is absent.
   *
   * This is a create-only primitive for the first version of a draft. It uses
   * an atomic R2 conditional put (If-None-Match: *) so that concurrent creates
   * for the same sessionId/draftId/version cannot overwrite each other.
   *
   * Returns `{ kind: "created" }` when the object was written.
   * Returns `{ kind: "already_exists" }` when the key already existed.
   *
   * The draft must be a valid canonical V2 snapshot. Version and baseVersion
   * are NOT enforced here; those are Worker create-policy concerns.
   */
  putInitialDraftIfAbsent(
    draft: CharacterSheetDraftV2,
  ): Promise<{ kind: "created" } | { kind: "already_exists" }>;

  /** Persists one immutable canonical V2 snapshot under its derived key. */
  putDraft(draft: CharacterSheetDraftV2): Promise<void>;

  /**
   * Reads one exact immutable snapshot version. Accepts stored V1 or V2 and
   * always resolves to canonical V2. A missing snapshot is `null`, never a
   * corruption error.
   */
  getDraftVersion(
    identity: CharacterSheetDraftIdentity,
    version: number,
  ): Promise<CharacterSheetDraftV2 | null>;

  /** Highest stored version, canonicalized to V2, or `null` when none exist. */
  getLatestDraft(
    identity: CharacterSheetDraftIdentity,
  ): Promise<CharacterSheetDraftV2 | null>;

  /** Ascending, deduplicated draft versions found under the exact prefix. */
  listDraftVersions(identity: CharacterSheetDraftIdentity): Promise<number[]>;

  /** Removes every object under the exact draft prefix. Idempotent. */
  deleteDraft(identity: CharacterSheetDraftIdentity): Promise<void>;
}
