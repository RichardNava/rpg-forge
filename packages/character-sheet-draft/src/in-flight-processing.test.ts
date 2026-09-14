import { describe, expect, it } from "vitest";
import {
  assertDraftMutable,
  beginInFlightDraft,
  completeInFlightDraft,
  DraftError,
  isDraftInFlight,
} from "./index";
import { makeDraft } from "./draft-fixture";

describe("in-flight draft processing", () => {
  it("marks a snapshot as saving then saved", () => {
    const inflight = beginInFlightDraft(makeDraft());
    expect(inflight.status).toBe("saving");
    expect(isDraftInFlight(inflight)).toBe(true);
    const saved = completeInFlightDraft(inflight);
    expect(saved.status).toBe("saved");
    expect(isDraftInFlight(saved)).toBe(false);
  });

  it("treats null as not in flight", () => {
    expect(isDraftInFlight(null)).toBe(false);
  });

  it("guards mutations while a save is in flight", () => {
    const inflight = beginInFlightDraft(makeDraft());
    expect(() => assertDraftMutable(inflight)).toThrowError(DraftError);
    try {
      assertDraftMutable(inflight);
      throw new Error("unreachable");
    } catch (error) {
      expect((error as DraftError).code).toBe("draft_inflight");
    }
  });

  it("allows mutations once the save completes", () => {
    const saved = completeInFlightDraft(beginInFlightDraft(makeDraft()));
    expect(() => assertDraftMutable(saved)).not.toThrow();
    expect(() => assertDraftMutable(null)).not.toThrow();
  });
});
