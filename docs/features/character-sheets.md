# Character Sheets — Feature Specification

**Status:** ACTIVE
**Authority:** Canonical product/behavior specification for Character Sheets
**Phase:** 14 / current integration work
**Supersedes:** Character Sheets sections in `docs/product/mvp.md`, `docs/product/feature-map.md`, `docs/architecture/phase-14.7/character-sheet-integration.md` (for product behavior)

---

This is the single authoritative source for Character Sheets product behavior. Architecture documents, MVP descriptions, and feature maps summarize and link to this specification — they do not override it.

---

## A. CHARACTER SHEET PRODUCT FLOW

### Entry flow

1. **Upload an existing character sheet** — user provides PDF/PNG/JPG; AI/vision extracts visible structure into editable form
2. **Create manually** — user builds the sheet structure from scratch in the editor
3. **AI-assisted creation** — may exist as a future/product flow but must not bypass the deterministic/editor architecture

### Existing-sheet flow

- AI/vision extracts the **visible structure** of the uploaded sheet
- Extraction produces **editable structured information**
- The user **reviews and edits** it before final generation
- Extraction must preserve meaningful visual hierarchy
- Do not simply OCR text and invent a final sheet
- Do not copy the original visual design
- The final RPG Forge sheet is an **original rendering**

### Manual flow

- User builds the sheet structure manually
- The system remains **rules-system agnostic**
- Do not hardcode D&D attributes or terminology

---

## B. STRUCTURAL MODEL — PRODUCT SEMANTICS

### Conceptual hierarchy (recursive)

```
Root
  → Section
      → Section
          → ...
              → Field
```

### Rules

- There is **NO distinct Subsection entity**
- A Section can:
  - live at Root
  - live inside another Section
  - contain Fields
  - contain child Sections
  - be moved back to Root later
- **Root membership is CURRENT POSITION, not historical identity**
  - A root Section can become a descendant
  - A descendant Section can become root
- Field is a **terminal editable node**
- A Field may exist:
  - at Root when appropriate / for compatibility
  - inside any Section

### Technical constraints

- Maximum Section depth: **12** (technical safety guardrail, not a product hierarchy exposed as "12 levels")
- Invalid operations:
  - self-parenting
  - cycles
  - nonexistent parents/targets
  - depth > 12
- Confirmed drafts remain **immutable**

---

## C. ORDERING — CRITICAL INVARIANT

The editor must eventually support **arbitrary sibling ordering**, including mixed siblings:

```
Field
Section
Field
Section
```

### Invariants

- There must be **ONE CANONICAL STRUCTURAL ORDER**
- Do NOT introduce an independent "Root organizer", tree or alternative structural representation that can diverge from the editable sheet
- The actual editable Sections are the objects that users reorder
- Editor, preview and persistence must ultimately interpret the **SAME canonical structure**
- Do NOT maintain competing structural sources of truth whose synchronization depends on every mutation remembering to update several unrelated representations
- The exact domain representation will be designed in a later implementation slice
- This specification MUST NOT decide prematurely that `nodeOrder`/`rootNodeOrder` from the abandoned experiment is the final solution

---

## D. DND TARGET EXPERIENCE

### Required eventual operations

- reorder Field among siblings
- move Field between Sections
- move Field Root ↔ Section
- reorder root Sections
- move Section between parents
- promote Section to Root
- demote root Section into another Section
- reorder mixed Field/Section siblings

### DnD operates directly on the visible editable nodes

- **NO separate Root tree/organizer**

### Expected drop intents

- `before`
- `after`
- `inside Section`

### Required visual feedback

- obvious drag handle
- insertion line for before/after
- highlighted/indented container for inside
- invalid-drop feedback
- DragOverlay or equivalent description
- keyboard-accessible alternative where practical

### UX requirement

The UI must make the resulting position understandable **BEFORE drop**.

---

## E. FIELD EDITING LAYOUT

### Invariant

Preserve the **compact grid behavior** of Fields.

Fields such as Strength, Dexterity, Charisma, etc. must not automatically become a long vertical CRUD list merely because hierarchical DnD is added.

The editor should remain **space-efficient**.

When mixed ordering exists, consecutive runs of Fields may be rendered as compact grids while preserving their canonical sibling order.

---

## F. SECTION ACTIONS

Actions belong to the visible Section itself.

Section delete must **NOT** require a separate structural tree.

### Initial deletion behavior

`remove_section` with safe semantics:

- empty Section can be deleted
- non-empty Section is rejected
- confirmation required in UI

Do not automatically promote/delete descendants unless explicitly designed later.

Field deletion also requires user confirmation.

---

## G. UNDO

Undo is required for structural mutations because DnD is error-prone.

### Target architecture

- server authoritative
- version-aware
- `expectedVersion` conflict protection
- undo creates a **NEW version** containing the previous state
- historical versions are not destroyed
- stale undo must fail safely
- confirmed draft cannot be undone/mutated

### UI target

- snackbar/action after structural operation
- Undo action
- authoritative reconciliation

Redo/full history UI is not currently required.

---

## H. PREVIEW

The editing workspace should prioritize **editing**.

The preview must **NOT** permanently consume a large second column.

### Target UX

```
Preview button
  → opens preview in a modal/dialog
```

It is an optional inspection of the current structure.

The preview represents **structural layout** before the later ornamented/generated final sheet.

**Editor and Preview must consume the same canonical structural representation.**

---

## I. CHARACTER IMAGE

Both upload/manual flows eventually support an optional character image.

### Image enabled → one mutually exclusive source

- uploaded image
- URL
- AI generated

### AI generation

- can accept an optional description
- if no description is supplied, available character concepts such as race/basic identity may be used

The editor/layout must eventually provide a place for the portrait.

**Status: TARGET/PLANNED** (not implemented in the approved baseline)

---

## J. PC / NPC

### PC (Player Character)

- blank fields remain blank
- suitable for printing/completing later

### NPC (Non-Player Character)

- blank fields may be populated by AI during final generation
- supports **threat level**:

| Level   | Description       |
| ------- | ----------------- |
| Common  | Standard enemy    |
| Veteran | Experienced enemy |
| Elite   | Strong enemy      |
| Boss    | Major antagonist  |

Reflect the actual current code where already implemented, but distinguish implemented UI preference from final server-side generation integration.

---

## K. VISUAL STYLE

Target styles include concepts such as:

- medieval
- steampunk
- retrofuturistic
- oriental
- fantasy
- etc.

Style keys will map to rendering/AI style instructions.

The product must create **ORIGINAL sheets** and must not reproduce copyrighted existing sheet designs.

Clearly distinguish current implementation from target integration.

---

## L. VISUAL / UX DIRECTION

RPG Forge must feel like a **medieval fantasy forge/cartography/scribe workshop**.

### Preferred visual language

- parchment
- wood
- leather
- ink
- aged metal
- cartographic / artisan workshop cues

### Avoid

- generic SaaS dashboards
- CRUD/admin-panel aesthetics
- excessively sparse forms
- unnecessarily large vertical controls

Usability remains more important than ornament.

Use the existing `rpg-frontend-style` skill as the visual implementation guide.

---

## IMPLEMENTATION STATUS

| Capability                                           | Status          | Notes                                                                                     |
| ---------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------- |
| Manual sheet creation                                | IMPLEMENTED     | Blank draft + editor                                                                      |
| Upload existing sheet (PDF/PNG/JPG)                  | IMPLEMENTED     | AI vision extraction → editable draft                                                     |
| AI vision extraction                                 | IMPLEMENTED     | Workers AI vision adapter                                                                 |
| Recursive Section hierarchy                          | IMPLEMENTED     | Domain model supports arbitrary depth (max 12) via `parentKey`                            |
| Field editing (text/number/textarea/checkbox/choice) | IMPLEMENTED     | Schema-driven editors                                                                     |
| Live preview                                         | IMPLEMENTED     | `projectDraftToSpec` projection                                                           |
| Confirm → read-only                                  | IMPLEMENTED     | `finalizeDraft`                                                                           |
| PC/NPC mode                                          | IMPLEMENTED     | UI + threat level for NPC                                                                 |
| Visual style selection                               | PLANNED         | Style keys defined, rendering integration pending                                         |
| Character image (upload/URL/AI)                      | PLANNED         | UI placeholder only                                                                       |
| Visual style rendering                               | PLANNED         | Style keys defined, rendering integration pending                                         |
| Recursive DnD (before/after/inside)                  | NOT IMPLEMENTED | Target UX defined; domain mutations and UI not implemented                                |
| Arbitrary sibling ordering                           | NOT IMPLEMENTED | Target UX defined; no domain support for mixed Field/Section ordering or `before`/`after` |
| Mixed Field/Section sibling ordering                 | NOT IMPLEMENTED | Target UX defined; current model appends Fields to Section end                            |
| `place_node` mutation                                | NOT IMPLEMENTED | Target domain mutation; not implemented                                                   |
| `place_field` mutation                               | NOT IMPLEMENTED | Target domain mutation; not implemented                                                   |
| `place_section` mutation                             | NOT IMPLEMENTED | Target domain mutation; not implemented                                                   |
| `remove_section` mutation                            | NOT IMPLEMENTED | Target domain mutation; not implemented                                                   |
| `remove_section` safe semantics                      | NOT IMPLEMENTED | Target behavior defined; not implemented                                                  |
| Undo (server-authoritative)                          | NOT IMPLEMENTED | Target architecture defined; no domain mutation, Worker endpoint, or UI                   |
| `expectedVersion` conflict protection                | NOT IMPLEMENTED | Target architecture defined; not implemented                                              |
| Visual style selection                               | PLANNED         | Style keys defined, rendering integration pending                                         |
| Character image (upload/URL/AI)                      | PLANNED         | UI placeholder only                                                                       |
| Visual style rendering                               | PLANNED         | Style keys defined, rendering integration pending                                         |
| Preview as modal                                     | NOT IMPLEMENTED | Live preview pane exists; modal UX target not implemented                                 |
| PDF export/download                                  | IMPLEMENTED     | AcroForm renderer                                                                         |
| Recursive Section hierarchy (parentKey)              | IMPLEMENTED     | Domain model supports arbitrary depth (max 12) via `parentKey`                            |
| Field ↔ Section movement (`move_field`)              | IMPLEMENTED     | Moves Field to Section (appends to end)                                                   |
| Section reparenting (`reparent_section`)             | IMPLEMENTED     | Changes Section parent (including to Root)                                                |
| Section creation/renaming                            | IMPLEMENTED     | `add_section`, `rename_section`                                                           |
| Field label/type editing                             | IMPLEMENTED     | `set_field_label`, `set_field_type`                                                       |
| Field lock/unlock                                    | IMPLEMENTED     | `lock_field`, `unlock_field`                                                              |
| Value set/clear                                      | IMPLEMENTED     | `set_value`, `clear_value`                                                                |
| Field add/remove                                     | IMPLEMENTED     | `add_field`, `remove_field`                                                               |
| Section creation (`add_section`)                     | IMPLEMENTED     | `add_section`                                                                             |
| Section renaming (`rename_section`)                  | IMPLEMENTED     | `rename_section`                                                                          |
| Section reparenting (`reparent_section`)             | IMPLEMENTED     | `reparent_section` (changes parent, including to Root)                                    |
| Section deletion (`remove_section`)                  | NOT IMPLEMENTED | Target mutation not implemented                                                           |
| PDF export/download                                  | IMPLEMENTED     | AcroForm renderer                                                                         |

---

## RELATED DOCUMENTS

- **Architecture:** `docs/architecture/phase-14.7/character-sheet-integration.md` (for implementation details, labeled with CURRENT/COMPLETED/SUPERSEDED/DEFERRED)
- **Data Model:** `docs/architecture/data-model.md` (persistence direction)
- **ADRs:** ADR-056, ADR-057, ADR-015, ADR-052, ADR-054
- **Visual Style:** `.opencode/skills/rpg-frontend-style/SKILL.md`
