import { describe, expect, it } from "vitest";
import {
  SHEET_UPLOAD_MAX_BYTES,
  validateSheetUploadFile,
} from "./sheet-upload-validation";

describe("validateSheetUploadFile", () => {
  it("accepts a PDF upload", () => {
    const result = validateSheetUploadFile({
      name: "sheet.pdf",
      type: "application/pdf",
      size: 1024,
    });
    expect(result.valid).toBe(true);
    expect(result.code).toBeNull();
  });

  it("accepts PNG and JPG uploads", () => {
    expect(
      validateSheetUploadFile({
        name: "sheet.png",
        type: "image/png",
        size: 512,
      }).valid,
    ).toBe(true);
    expect(
      validateSheetUploadFile({
        name: "sheet.jpg",
        type: "image/jpeg",
        size: 512,
      }).valid,
    ).toBe(true);
  });

  it("rejects a missing file", () => {
    const result = validateSheetUploadFile(null);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("empty");
  });

  it("rejects unsupported file types", () => {
    const result = validateSheetUploadFile({
      name: "notes.txt",
      type: "text/plain",
      size: 100,
    });
    expect(result.valid).toBe(false);
    expect(result.code).toBe("unsupported_type");
  });

  it("rejects oversized documents", () => {
    const result = validateSheetUploadFile({
      name: "huge.pdf",
      type: "application/pdf",
      size: SHEET_UPLOAD_MAX_BYTES + 1,
    });
    expect(result.valid).toBe(false);
    expect(result.code).toBe("too_large");
  });

  it("rejects empty documents", () => {
    const result = validateSheetUploadFile({
      name: "blank.png",
      type: "image/png",
      size: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.code).toBe("empty");
  });
});