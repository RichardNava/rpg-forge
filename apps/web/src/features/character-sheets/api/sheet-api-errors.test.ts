import { describe, expect, it } from "vitest";
import { SheetApiError, parseSheetApiErrorBody } from "./sheet-api-errors";

describe("parseSheetApiErrorBody", () => {
  it("parses a well-formed error envelope", () => {
    const error = parseSheetApiErrorBody(
      { error: { code: "SHEET_DRAFT_NOT_FOUND", message: "No draft found." } },
      404,
    );
    expect(error).toBeInstanceOf(SheetApiError);
    expect(error?.code).toBe("SHEET_DRAFT_NOT_FOUND");
    expect(error?.message).toBe("No draft found.");
    expect(error?.status).toBe(404);
  });

  it("returns null for malformed envelopes", () => {
    expect(parseSheetApiErrorBody({}, 500)).toBeNull();
    expect(parseSheetApiErrorBody(null, 500)).toBeNull();
    expect(parseSheetApiErrorBody("not-an-object", 500)).toBeNull();
    expect(parseSheetApiErrorBody({ error: {} }, 500)).toBeNull();
    expect(parseSheetApiErrorBody({ error: { code: "X" } }, 500)).toBeNull();
    expect(
      parseSheetApiErrorBody({ error: { code: "", message: "m" } }, 500),
    ).toBeNull();
  });

  it("keeps the code open for unknown upstream codes", () => {
    const error = parseSheetApiErrorBody(
      { error: { code: "SOME_FUTURE_CODE", message: "future" } },
      422,
    );
    expect(error?.code).toBe("SOME_FUTURE_CODE");
  });
});
