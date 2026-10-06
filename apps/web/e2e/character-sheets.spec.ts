import { expect, test, type Page } from "@playwright/test";

test.setTimeout(120 * 1000);

/**
 * Character Sheets browser journeys (4F lane A + 14.9 canvas journeys).
 *
 * Real public page (`/character-sheets`) + real React UI + real V2
 * store/domain, served in EXPLICIT LOCAL backend mode (see
 * `playwright.config.ts`). Deterministic and provider-free: no Turnstile,
 * no Workers AI, no remote D1/R2, no deployed Worker.
 */

async function openManualEditor(page: Page) {
  await page.goto("/character-sheets");
  await expect(
    page.getByRole("heading", {
      name: /how do you want to create your character\?/i,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /open the workshop/i }).click();
  await expect(
    page.getByRole("heading", { name: "Sheet canvas" }),
  ).toBeVisible();
}

async function addField(
  page: Page,
  label: string,
  type: "text" | "number" = "text",
) {
  await page.getByRole("button", { name: "Add field", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a field" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Label", { exact: true }).fill(label);
  if (type !== "text") {
    await dialog.getByLabel("Type").selectOption(type);
  }
  await dialog.getByRole("button", { name: "Add field" }).click();
}

async function addSection(page: Page, title: string): Promise<string> {
  await page.getByRole("button", { name: "Add section" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a section" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Section title").fill(title);
  const key = await dialog.getByLabel("Section key").inputValue();
  await dialog.getByRole("button", { name: "Add section" }).click();
  return key;
}

async function dragToIntent(
  page: Page,
  handleName: string | RegExp,
  intentId: string,
) {
  const handle = page.getByRole("button", { name: handleName });
  const target = page.locator(`[data-dnd-intent="${intentId}"]`);
  await handle.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, {
    steps: 50,
  });
  await page.mouse.up();
}

/** Canonical canvas order: every node key in document (preorder) order. */
async function canvasOrder(page: Page): Promise<string[]> {
  return page
    .locator("[data-canvas-node]")
    .evaluateAll((elements) =>
      elements.map(
        (element) => (element as HTMLElement).dataset.canvasNode as string,
      ),
    );
}

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

  // 3-4. Manual creation opens the Canvas editor.
  await page.getByRole("button", { name: /open the workshop/i }).click();
  await expect(
    page.getByRole("heading", { name: "Sheet canvas" }),
  ).toBeVisible();

  // Layout first: root columns while nothing is selected.
  await page.getByLabel("Sheet columns").selectOption("2");

  // 5. Character name via the toolbar title input.
  const titleInput = page.getByLabel("Sheet title");
  await titleInput.fill("E2E Hero");
  await expect(titleInput).toHaveValue("E2E Hero");

  // 10 (part). Change a Field value through the canvas card editor.
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

  // 8. The new node is visible on the Canvas.
  await expect(page.locator('[data-canvas-node="agility"]')).toBeVisible();

  // 7. Add a Section.
  await page.getByRole("button", { name: "Add section" }).click();
  const sectionDialog = page.getByRole("dialog", { name: "Add a section" });
  await expect(sectionDialog).toBeVisible();
  await sectionDialog.getByLabel("Section title").fill("Abilities");
  await expect(sectionDialog.getByLabel("Section key")).toHaveValue(
    "abilities",
  );
  await sectionDialog.getByRole("button", { name: "Add section" }).click();
  const abilitiesSection = page.locator(
    'section[aria-labelledby="canvas-section-abilities"]',
  );
  await expect(abilitiesSection).toBeVisible();

  // 10 (part). Change the numeric Field value.
  const agilityValueInput = page.getByLabel("Agility", { exact: true });
  await agilityValueInput.fill("14");
  await expect(agilityValueInput).toHaveValue("14");

  // 9. Reparent the Agility field inside Abilities using keyboard move
  // (pointer drag into empty section has a known collision detection issue
  // where the empty section body rect is miscalculated; keyboard flow works).
  const handle = page.getByRole("button", { name: "Move Agility" });
  await handle.focus();
  await page.keyboard.press("Space");
  const dialog = page.getByRole("dialog", { name: "Move Agility" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("Destination for Agility")
    .selectOption("Inside Abilities");
  await dialog.getByRole("button", { name: "Move here" }).click();
  await expect(
    abilitiesSection.locator('[data-canvas-node="agility"]'),
  ).toBeVisible();

  // 9 (second path). Section reparent control: nest Abilities, then restore.
  await page.getByRole("button", { name: "Add section" }).click();
  const secondDialog = page.getByRole("dialog", { name: "Add a section" });
  await secondDialog.getByLabel("Section title").fill("Extras");
  await secondDialog.getByRole("button", { name: "Add section" }).click();
  const extrasSection = page.locator(
    'section[aria-labelledby="canvas-section-extras"]',
  );
  await expect(extrasSection).toBeVisible();
  await extrasSection.getByRole("heading", { name: "Extras" }).click();
  await page.getByLabel("Parent section for Extras").selectOption("abilities");
  await expect(
    abilitiesSection.getByRole("heading", { name: "Extras" }),
  ).toBeVisible();
  await extrasSection.getByRole("heading", { name: "Extras" }).click();
  await page.getByLabel("Parent section for Extras").selectOption("");
  await expect(extrasSection).toBeVisible();

  // 14.8 layout authoring: section columns, then node geometry.
  await abilitiesSection.getByRole("heading", { name: "Abilities" }).click();
  await page
    .locator('select[aria-label="Columns for Abilities"]')
    .selectOption("2");
  await page.getByLabel("Agility", { exact: true }).click();
  await page.getByLabel("Column span for Agility").fill("2");
  await page.getByLabel("Row span for Agility").fill("2");

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

  // 14 + E2E D. No editing affordances remain: no handles, rails, resize,
  // inspector, or inputs — while the layout stays visible.
  await expect(
    page.getByRole("button", { name: "Add field", exact: true }),
  ).toBeHidden();
  await expect(page.getByLabel("Sheet title")).toBeHidden();
  await expect(page.getByRole("button", { name: "Move Agility" })).toBeHidden();
  await expect(page.getByLabel("Sheet columns")).toBeHidden();
  await expect(page.locator("[data-dnd-intent]")).toHaveCount(0);
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

test("E2E A — complete pointer DnD: before, after, inside, sections, root", async ({
  page,
}) => {
  await openManualEditor(page);
  await addField(page, "Field 1");
  await addField(page, "Field 2");
  await addField(page, "Field 3");
  await addSection(page, "Group A");
  await addSection(page, "Group B");
  expect(await canvasOrder(page)).toEqual([
    "character_name",
    "field_1",
    "field_2",
    "field_3",
    "group_a",
    "group_b",
  ]);

  // Field before another Field.
  await dragToIntent(page, "Move Field 2", "canvas:before:field:field_1");
  expect(await canvasOrder(page)).toEqual([
    "character_name",
    "field_2",
    "field_1",
    "field_3",
    "group_a",
    "group_b",
  ]);

  // Field after a Section: mixed sibling order at root.
  await dragToIntent(page, "Move Field 1", "canvas:after:section:group_a");
  expect(await canvasOrder(page)).toEqual([
    "character_name",
    "field_2",
    "field_3",
    "group_a",
    "field_1",
    "group_b",
  ]);

  // Field inside a Section.
  await dragToIntent(page, "Move Field 3", "canvas:inside:group_a");
  expect(await canvasOrder(page)).toEqual([
    "character_name",
    "field_2",
    "group_a",
    "field_3",
    "field_1",
    "group_b",
  ]);

  // Section inside a Section: nested hierarchy.
  await dragToIntent(page, "Move Group B", "canvas:inside:group_a");
  const groupA = page.locator(
    'section[aria-labelledby="canvas-section-group_a"]',
  );
  await expect(groupA.getByRole("heading", { name: "Group B" })).toBeVisible();

  // Section back to Root via the root end zone.
  await dragToIntent(page, "Move Group B", "canvas:inside:root");
  expect(await canvasOrder(page)).toEqual([
    "character_name",
    "field_2",
    "group_a",
    "field_3",
    "field_1",
    "group_b",
  ]);

  // Structure and layout did not diverge: the moved field still carries
  // layout the inspector can show.
  await page.locator('[data-canvas-node="field_3"]').click();
  await expect(page.getByLabel("Column start for Field 3")).toHaveValue("1");
});

test("E2E B — visual resize and placement commit grid geometry", async ({
  page,
}) => {
  await openManualEditor(page);
  await page.getByLabel("Sheet columns").selectOption("4");
  await addField(page, "Wide");

  // Select the field so resize handles appear.
  await page.locator('[data-canvas-node="wide"]').click();
  const widthHandle = page.getByRole("slider", { name: "Width of Wide" });
  const heightHandle = page.getByRole("slider", { name: "Height of Wide" });
  await expect(widthHandle).toBeVisible();
  await expect(heightHandle).toBeVisible();

  // Resize width visually: drag right by ~1.2 column widths.
  const card = page.locator('[data-canvas-node="wide"]');
  const cardBox = await card.boundingBox();
  const handleBox = await widthHandle.boundingBox();
  expect(cardBox).not.toBeNull();
  expect(handleBox).not.toBeNull();
  const pxPerColumn = cardBox!.width;
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2,
    handleBox!.y + handleBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2 + pxPerColumn * 1.2,
    handleBox!.y,
    {
      steps: 15,
    },
  );
  await page.mouse.up();
  // Give the async store update time to complete before polling.
  await page.waitForTimeout(200);
  // Wait for inspector to reflect the committed layout.
  await expect
    .poll(async () => {
      return (
        (await page.getByLabel("Column span for Wide").inputValue()) === "2"
      );
    })
    .toBe(true);

  // Resize height visually.
  const southBox = await heightHandle.boundingBox();
  const cardBoxAfter = await card.boundingBox();
  expect(southBox).not.toBeNull();
  expect(cardBoxAfter).not.toBeNull();
  await page.mouse.move(
    southBox!.x + southBox!.width / 2,
    southBox!.y + southBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(southBox!.x, southBox!.y + cardBoxAfter!.height * 1.2, {
    steps: 15,
  });
  await page.mouse.up();
  // Wait for inspector to reflect the committed layout.
  await expect
    .poll(
      async () => {
        return (
          (await page.getByLabel("Row span for Wide").inputValue()) === "2"
        );
      },
      { timeout: 10000, intervals: [100, 200, 500, 1000] },
    )
    .toBe(true);

  // Re-select the field to ensure inspector shows its mini-grid.
  await page.locator('[data-canvas-node="wide"]').click();

  // Visual placement control: move start to column 3 (span 2 still fits 4).
  await page.getByRole("button", { name: "Column 3 of 4 for Wide" }).click();
  await expect(page.getByLabel("Column start for Wide")).toHaveValue("3");

  // Committed geometry is visible on the Canvas footprint.
  await expect(
    page.locator('[data-canvas-node="wide"]').first(),
  ).toHaveAttribute("style", /span 2/);
});

test("E2E C — keyboard move flow with focus restore and cancel", async ({
  page,
}) => {
  await openManualEditor(page);
  await addField(page, "First");
  await addField(page, "Second");

  // Focus the handle, pick up with Space, commit through the menu.
  const handle = page.getByRole("button", { name: "Move Second" });
  await handle.focus();
  await page.keyboard.press("Space");
  const dialog = page.getByRole("dialog", { name: "Move Second" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel("Destination for Second")
    .selectOption("Before First");
  await dialog.getByRole("button", { name: "Move here" }).click();
  expect(await canvasOrder(page)).toEqual([
    "character_name",
    "second",
    "first",
  ]);
  await expect
    .poll(
      async () =>
        await page.evaluate(() =>
          document.activeElement?.getAttribute("aria-label"),
        ),
    )
    .toBe("Move Second");

  // Escape cancels the flow and restores focus without mutating.
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("dialog", { name: "Move Second" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Move Second" })).toBeHidden();
  expect(await canvasOrder(page)).toEqual([
    "character_name",
    "second",
    "first",
  ]);
  await expect
    .poll(
      async () =>
        await page.evaluate(() =>
          document.activeElement?.getAttribute("aria-label"),
        ),
    )
    .toBe("Move Second");
});
