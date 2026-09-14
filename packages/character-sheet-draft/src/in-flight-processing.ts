import type { CharacterSheetDraft } from "./draft-schema";
import { draftError } from "./errors";

export const DRAFT_IN_FLIGHT_STATUSES = ["saving", "saved"] as const;

export type DraftInFlightStatus = (typeof DRAFT_IN_FLIGHT_STATUSES)[number];

/** Transport-side envelope: a snapshot being written and its current state. */
export interface InFlightDraft {
  snapshot: CharacterSheetDraft;
  status: DraftInFlightStatus;
}

export function beginInFlightDraft(
  snapshot: CharacterSheetDraft,
): InFlightDraft {
  return { snapshot, status: "saving" };
}

export function completeInFlightDraft(inFlight: InFlightDraft): InFlightDraft {
  return { snapshot: inFlight.snapshot, status: "saved" };
}

export function isDraftInFlight(
  inFlight: InFlightDraft | null,
): inFlight is InFlightDraft {
  return inFlight !== null && inFlight.status === "saving";
}

/**
 * Guards the mutation surface: a snapshot whose save is still in flight must
 * not be mutated again, because every save is a full versioned write and the
 * next version must describe the stored snapshot, not a moving target.
 */
export function assertDraftMutable(inFlight: InFlightDraft | null): void {
  if (isDraftInFlight(inFlight)) {
    throw draftError(
      "draft_inflight",
      "The draft is mid-save; mutations are deferred until the save completes.",
    );
  }
}
