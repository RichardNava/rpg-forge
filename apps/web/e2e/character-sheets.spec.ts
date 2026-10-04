import { expect, test } from "@playwright/test";

test.setTimeout(120 * 1000);

/**
 * Character Sheets manual authoring happy path (4F stabilization lane A).
 *
 * Real public page (`/character-sheets`) + real React UI + real V2
 * store/domain, served in EXPLICIT LOCAL backend mode (see
 * `playwright.config.ts`). Deterministic and provider-free: no Turnstile,
 * no Workers AI, no remote D1/R2, no deployed Worker.
 *
 * Structural coverage: the currently supported `inside` reparent is exercised
 * twice — once through a real pointer drag, once through the section "Parent
 * section" control. `before`/`after` DnD is intentionally NOT implemented and
 * has no browser coverage here.
 */
test("manual authoring happy path: create, edit, reparent, confirm, export, restart", async ({
  page,
}) => {
  // 1-2. Landing.
  await page.goto("/character-sheets");
  await expect(
    page.getByRole("heading", {
      name: /how do you want to create your character\?/i,
    }),
  ).toBeVisible();

  // 3-4. Manual creation opens the editor.
  await page.getByRole("button", { name: /open the workshop/i }).click();
  await expect(
    page.getByRole("heading", { name: "Sheet fields" }),
  ).toBeVisible();

  // 5. Character name via the toolbar title input.
  const titleInput = page.getByLabel("Sheet title");
  await titleInput.fill("E2E Hero");
  await expect(titleInput).toHaveValue("E2E Hero");

  // 10 (part). Change a Field value through the sidebar editor.
  const nameValueInput = page.getByRole("textbox", { name: "Character name" });
  await expect(nameValueInput).toHaveValue("E2E Hero");

  // 6. Add a numeric Field.
  await page.getByRole("button", { name: "Add field", exact: true }).click();
  const fieldDialog = page.getByRole("dialog", { name: "Add a field" });
  await expect(fieldDialog).toBeVisible();
  await fieldDialog.getByLabel("Label", { exact: true }).fill("Agility");
  await expect(fieldDialog.getByLabel("Key")).toHaveValue("agility");
  await fieldDialog.getByLabel("Type").selectOption("number");
  await fieldDialog.getByLabel("Minimum").fill("1");
  await fieldDialog.getByLabel("Maximum").fill("20");
  await fieldDialog.getByRole("button", { name: "Add field" }).click();

  // 8. The new node is visible.
  const agilityLabelInput = page.getByLabel("Label for agility");
  await expect(agilityLabelInput).toBeVisible();

  // 7. Add a Section.
  await page.getByRole("button", { name: "Add section" }).click();
  const sectionDialog = page.getByRole("dialog", { name: "Add a section" });
  await expect(sectionDialog).toBeVisible();
  await sectionDialog.getByLabel("Section title").fill("Abilities");
  await expect(sectionDialog.getByLabel("Section key")).toHaveValue(
    "abilities",
  );
  await sectionDialog.getByRole("button", { name: "Add section" }).click();
  await expect(page.getByRole("heading", { name: "Abilities" })).toBeVisible();

  // 10 (part). Change the numeric Field value.
  const agilityValueInput = page.getByLabel("Agility", { exact: true });
  await agilityValueInput.fill("14");
  await expect(agilityValueInput).toHaveValue("14");

  // 9. Real pointer drag: reparent the Agility field inside Abilities.
  const abilitiesSection = page.locator(
    'section[aria-labelledby="section-abilities"]',
  );
  const dragHandle = page.getByRole("button", { name: "Move Agility" });
  await dragHandle.scrollIntoViewIfNeeded();
  await abilitiesSection.scrollIntoViewIfNeeded();
  const from = await dragHandle.boundingBox();
  const to = await abilitiesSection.boundingBox();
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, {
    steps: 20,
  });
  await page.mouse.up();
  await expect(abilitiesSection.getByLabel("Label for agility")).toBeVisible();

  // 9 (second path). Section reparent control: nest Abilities, then restore.
  await page.getByRole("button", { name: "Add section" }).click();
  const secondDialog = page.getByRole("dialog", { name: "Add a section" });
  await secondDialog.getByLabel("Section title").fill("Extras");
  await secondDialog.getByRole("button", { name: "Add section" }).click();
  const extrasSection = page.locator(
    'section[aria-labelledby="section-extras"]',
  );
  await expect(extrasSection).toBeVisible();
  // The reparent control lives inside the collapsed section-settings
  // disclosure; expand it first.
  await extrasSection.getByText(/section settings for extras/i).click();
  await page.getByLabel("Parent section for Extras").selectOption("abilities");
  await expect(
    abilitiesSection.getByRole("heading", { name: "Extras" }),
  ).toBeVisible();
  // Re-rendering collapses the disclosure again; expand before restoring.
  await extrasSection.getByText(/section settings for extras/i).click();
  await page.getByLabel("Parent section for Extras").selectOption("");
  await expect(extrasSection).toBeVisible();

  // 14.8 layout authoring: root columns, section columns, node geometry.
  await page.getByLabel("Sheet columns").selectOption("2");
  await abilitiesSection.getByText(/section settings for abilities/i).click();
  await page.getByLabel("Columns for Abilities").selectOption("2");
  await page.getByLabel("Column span for agility").fill("2");
  await page.getByLabel("Row span for agility").fill("2");

  // 11. PC/NPC preference + threat level.
  await page
    .getByRole("button", { name: "Player character", exact: true })
    .click();
  await expect(page.getByLabel("Threat")).toBeHidden();
  await page
    .getByRole("button", { name: "Non-player character", exact: true })
    .click();
  await page.getByRole("button", { name: "Veteran" }).click();
  await expect(page.getByRole("button", { name: "Veteran" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // 12-13. Confirm the sheet.
  await page.getByRole("button", { name: "Confirm sheet" }).click();
  const confirmDialog = page.getByRole("dialog", {
    name: "Confirm character sheet",
  });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Confirm sheet" }).click();
  await expect(page.getByText(/confirmed and read-only/)).toBeVisible();

  // 14. Editing controls can no longer mutate the confirmed draft.
  await expect(
    page.getByRole("button", { name: "Add field", exact: true }),
  ).toBeHidden();
  await expect(page.getByLabel("Sheet title")).toBeHidden();
  await expect(page.getByRole("button", { name: "Move Agility" })).toBeHidden();
  await expect(page.getByLabel("Sheet columns")).toBeHidden();
  await expect(page.getByText("E2E Hero").first()).toBeVisible();

  // 14.8 preview reflects the authored grid directly from the draft.
  const preview = page.getByLabel("Sheet preview");
  await expect(preview).toBeVisible();
  const abilitiesPreview = preview.locator(
    'section[aria-labelledby="preview-section-abilities"]',
  );
  await expect(abilitiesPreview).toBeVisible();
  await expect(
    abilitiesPreview.locator("div.character-workshop__preview-section-fields"),
  ).toHaveAttribute("style", /repeat\(2,/);
  const agilityPreview = abilitiesPreview.locator(
    "div.character-workshop__preview-field",
    { hasText: "Agility" },
  );
  // The browser serializes gridColumn/gridRow into the grid-area shorthand:
  // row span 2, column 1 span 2.
  await expect(agilityPreview).toHaveAttribute(
    "style",
    /grid-area: span 2 \/ 1 \/ auto \/ span 2/,
  );

  // 15-16. PDF download occurs with a PDF filename.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);

  // 17-18. Restart restores the landing.
  await page.getByRole("button", { name: "Start a new sheet" }).click();
  await expect(
    page.getByRole("heading", {
      name: /how do you want to create your character\?/i,
    }),
  ).toBeVisible();
});
