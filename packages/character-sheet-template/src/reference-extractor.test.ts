import { describe, expect, it } from "vitest";
import {
  createReferenceSheetTemplateExtractor,
  extractSheetTemplate,
  REFERENCE_TEMPLATE_CATALOG,
} from "./index.js";

describe("createReferenceSheetTemplateExtractor", () => {
  it("extracts a cataloged direct-sheet template deterministically", async () => {
    const extractor = createReferenceSheetTemplateExtractor();
    const first = await extractSheetTemplate(
      { source: { kind: "direct-sheet", sheetKey: "one-shot-pc" } },
      { extractionPort: extractor },
    );
    const second = await extractSheetTemplate(
      { source: { kind: "direct-sheet", sheetKey: "one-shot-pc" } },
      { extractionPort: extractor },
    );
    expect(first.kind).toBe("ok");
    if (first.kind === "ok" && second.kind === "ok") {
      expect(second.template).toEqual(first.template);
    }
  });

  it("extracts a cataloged rulebook-contained sheet", async () => {
    const outcome = await extractSheetTemplate(
      {
        source: {
          kind: "rulebook-contained-sheet",
          rulebookKey: "intro-sample",
          pageStart: 1,
          pageEnd: 3,
        },
      },
      { extractionPort: createReferenceSheetTemplateExtractor() },
    );
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.template.mode).toBe("npc");
    }
  });

  it("reports extraction_unavailable for an unknown source key", async () => {
    const outcome = await extractSheetTemplate(
      { source: { kind: "direct-sheet", sheetKey: "does-not-exist" } },
      { extractionPort: createReferenceSheetTemplateExtractor() },
    );
    expect(outcome).toEqual({ kind: "extraction_unavailable" });
  });

  it("supports an augmented catalog for test fixtures", async () => {
    const extractor = createReferenceSheetTemplateExtractor({
      ...REFERENCE_TEMPLATE_CATALOG,
      "direct-sheet:custom": {
        schemaVersion: 1,
        mode: "npc",
        sections: [{ key: "attributes", title: "Attributes" }],
        fields: [
          {
            label: "Poise",
            category: "mechanical",
            kind: "number",
            numericBounds: { min: 1, max: 12 },
          },
        ],
      },
    });
    const outcome = await extractSheetTemplate(
      { source: { kind: "direct-sheet", sheetKey: "custom" } },
      { extractionPort: extractor },
    );
    expect(outcome.kind).toBe("ok");
  });
});
