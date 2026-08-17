import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { sampleLayout } from "../src/renderer";
import worker from "../src/worker";

describe("pdf-lib AcroForm renderer in workerd", () => {
  it("creates a printable two-page blank sheet with all requested field types", async () => {
    const response = await worker.fetch(
      new Request("https://spike.test/sample.pdf"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");

    const document = await PDFDocument.load(await response.arrayBuffer());
    const form = document.getForm();
    const names = form.getFields().map((field) => field.getName());

    expect(document.getPageCount()).toBe(2);
    expect(names).toEqual([
      "character-name",
      "archetype",
      "strength",
      "health",
      "ready",
      "stance",
      "travel-style",
      "skills",
      "equipment",
      "notes",
    ]);
    expect(form.getTextField("notes").isMultiline()).toBe(true);
    expect(form.getCheckBox("ready").isChecked()).toBe(false);
    expect(form.getRadioGroup("stance").getSelected()).toBeUndefined();
    expect(form.getDropdown("travel-style").getSelected()).toEqual([]);
  });

  it("keeps prefilled NPC widgets editable and preserves their values", async () => {
    const response = await worker.fetch(
      new Request("https://spike.test/sample-npc.pdf"),
    );
    const document = await PDFDocument.load(await response.arrayBuffer());
    const form = document.getForm();

    expect(document.getPageCount()).toBe(2);
    expect(form.getTextField("character-name").getText()).toBe("Mira Thorn");
    expect(form.getTextField("strength").getText()).toBe("14");
    expect(form.getCheckBox("ready").isChecked()).toBe(true);
    expect(form.getRadioGroup("stance").getSelected()).toBe("B");
    expect(form.getDropdown("travel-style").getSelected()).toEqual(["On foot"]);
    expect(form.getTextField("notes").getText()).toContain("editable");
  });

  it("uses deterministic layout records with valid PDF coordinates", () => {
    const fields = sampleLayout.flatMap((page) => page.fields);

    expect(fields).toHaveLength(10);
    expect(
      fields.every(
        (field) =>
          field.x >= 0 &&
          field.y >= 0 &&
          field.width > 0 &&
          field.height > 0 &&
          field.x + field.width <= 612 &&
          field.y + field.height <= 792,
      ),
    ).toBe(true);
  });
});
