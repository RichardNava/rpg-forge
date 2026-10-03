/**
 * V2 create orchestration for the live draft-create route.
 *
 * Composes the D1 head port with the atomic V2 initial-snapshot primitive.
 *
 * Responsibilities:
 * - Validate a client-supplied canonical V2 snapshot as an initial draft.
 * - Enforce Worker create policy: authorized session, version 1, base 1.
 * - Return early when a D1 head already exists (duplicate, no R2 access).
 * - Create the initial R2 snapshot atomically (create-if-absent only).
 * - Recover an equal orphaned R2 snapshot that has no D1 head.
 * - Create the D1 head exactly once for a new or recovered snapshot.
 * - Propagate DraftError unchanged (invalid_draft, storage_unavailable).
 *
 * Layering:
 *
 * HTTP transport parsing          -> draft-v2-transport.ts (create schema)
 * HTTP egress serialization       -> draft-v2-orchestration.ts (201)
 * THIS MODULE                     = V2 create orchestration
 *     +--> DraftHeadRepositoryPort        (duplicate check, head creation)
 *     +--> CharacterSheetDraftStoreV2     (atomic initial snapshot)
 *     v
 * Live HTTP handler               (character-sheet-handler.ts)
 */
import {
  draftError,
  validateDraftV2,
  type CharacterSheetDraftV2,
} from "@repo/character-sheet-draft";
import type {
  DraftHeadIdentity,
  DraftHeadRepositoryPort,
} from "@repo/character-sheet-session";
import type { CharacterSheetDraftStoreV2 } from "@repo/character-sheet-draft";

/**
 * The create kernel's collaborators. Narrow and explicit rather than
 * `AppDeps`, so it can never reach a route helper, an HTTP
 * concern, or time/randomness it does not need. Create has no claim lifecycle
 * and therefore needs neither clock nor crypto.
 */
export interface DraftV2CreateDeps {
  readonly heads: DraftHeadRepositoryPort;
  readonly store: CharacterSheetDraftStoreV2;
}

/**
 * Route-independent create outcome. A duplicate is a value, not an error, so
 * the live handler maps `{ kind: "already_exists" }` to
 * `SHEET_DRAFT_ALREADY_EXISTS` without inventing a 404-only DraftError.
 */
export type DraftV2CreateResult =
  | {
      kind: "created";
      draft: CharacterSheetDraftV2;
    }
  | {
      kind: "already_exists";
    };

/**
 * Orchestrates V2 creation end-to-end: validate policy -> duplicate check ->
 * atomic R2 create -> orphan recovery when applicable -> D1 head create.
 *
 * The snapshot is client-supplied and already versioned: this function
 * validates `version === 1` and `baseVersion === 1` but NEVER produces,
 * bumps, repairs, or normalizes versions. `confirmed` may be true or false.
 *
 * Persistence order is R2 first, then D1. The R2 write is conditional
 * create-if-absent, so a concurrent duplicate can never overwrite the
 * winner's immutable version-1 object. The R2 object is never deleted when
 * the D1 create loses a race.
 *
 * @param deps - D1 head repository and V2 snapshot store only.
 * @param authorizedSessionId - Session from auth/path, never from the body.
 * @param draft - Client-supplied canonical V2 snapshot.
 * @returns The created snapshot, or an already-exists duplicate outcome.
 * @throws DraftError - invalid_draft, storage_unavailable.
 */
export async function createDraftV2(
  deps: DraftV2CreateDeps,
  authorizedSessionId: string,
  draft: CharacterSheetDraftV2,
): Promise<DraftV2CreateResult> {
  const validated = validateDraftV2(draft);
  if (validated.sessionId !== authorizedSessionId) {
    throw draftError(
      "invalid_draft",
      "The draft session does not match the authorized session.",
    );
  }
  if (validated.version !== 1) {
    throw draftError("invalid_draft", "A new draft must start at version 1.");
  }
  if (validated.baseVersion !== 1) {
    throw draftError(
      "invalid_draft",
      "A new draft must start at base version 1.",
    );
  }

  const identity: DraftHeadIdentity = {
    sessionId: authorizedSessionId,
    draftId: validated.draftId,
  };
  const existingHead = await deps.heads.getHead(identity);
  if (existingHead !== null) {
    return { kind: "already_exists" };
  }

  const initial = await deps.store.putInitialDraftIfAbsent(validated);
  if (initial.kind === "already_exists") {
    const stored = await deps.store.getDraftVersion(identity, 1);
    if (stored === null) {
      throw draftError(
        "storage_unavailable",
        "The initial draft snapshot disappeared during creation.",
      );
    }
    if (!draftsAreCanonicallyEqual(stored, validated)) {
      return { kind: "already_exists" };
    }
  }

  const created = await deps.heads.create(identity);
  if (created.kind === "created") {
    return { kind: "created", draft: validated };
  }
  return { kind: "already_exists" };
}

/**
 * Canonical structural equality for two validated V2 snapshots.
 *
 * Compares the ENTIRE canonical draft, including schemaVersion, draftId,
 * sessionId, baseVersion, version, mode, characterName, rulesContextId,
 * fields, sections, structure, values, source, and confirmed.
 *
 * Arrays are ordered and significant: `fields[]`, `sections[]`, and
 * `structure[]` carry canonical order. Object key order is insignificant, so
 * two drafts with equal semantic `values` content but different record
 * insertion order compare equal. Raw JSON bytes are never compared.
 */
function draftsAreCanonicallyEqual(
  a: CharacterSheetDraftV2,
  b: CharacterSheetDraftV2,
): boolean {
  return isCanonicalValueEqual(a as unknown, b as unknown);
}

function isCanonicalValueEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      return false;
    }
    if (a.length !== b.length) {
      return false;
    }
    return a.every((item, index) =>
      isCanonicalValueEqual(item, (b as unknown[])[index]),
    );
  }
  if (typeof a === "object") {
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const aKeys = Object.keys(aRecord);
    const bKeys = Object.keys(bRecord);
    if (aKeys.length !== bKeys.length) {
      return false;
    }
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(bRecord, key)) {
        return false;
      }
      if (!isCanonicalValueEqual(aRecord[key], bRecord[key])) {
        return false;
      }
    }
    return true;
  }
  return false;
}
