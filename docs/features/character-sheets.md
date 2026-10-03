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
- This specification MUST NOT decide prematurely that `nodeOrder`/`rootNodeOrder` from the abandoned experiment is the final solution

### Approved V2 canonical structural model (DOMAIN IMPLEMENTED)

The V2 domain representation is now approved and implemented; it is not deferred to a later implementation slice:

- `fields[]` — the Field registry, holding Field content only
- `sections[]` — the Section registry, holding only `key` and `title`; no `parentKey`, no `fieldKeys`
- `structure[]` — the single canonical structural authority: one preorder array of placements, each `{ kind, key, parentKey }`
- Root membership is expressed by `parentKey === null`

Because `structure[]` is the only structural authority, a Section's position is its current placement rather than a property of the Section record, and mixed Field/Section sibling ordering needs no second ordering mechanism.

**Status:** implemented in the V2 domain. Web, Worker, and persistence still consume the V1 runtime structures until the coordinated cutover; the editor DnD UI is not implemented.

### Derived V2 structural read model (DOMAIN IMPLEMENTED)

Because `structure[]` is the sole structural authority, reading a draft is a derived concern rather than a stored one. The V2 domain now provides a structural read model that answers "what is the canonical shape of this draft?" without adding a second authority:

- canonical preorder of every Field and Section placement
- the Root list, in canonical sibling order
- direct children of any Field, Section, or Root
- node lookup by key
- each node's depth, and the exact Field or Section record plus the exact placement its key refers to

The read model is in-memory and read-only. It is never persisted and never competes with `structure[]`: it derives everything from `structure[]`, and `structure[]` remains canonical. Mixed Field/Section sibling ordering is preserved exactly as authored; there is no Root organizer, no separate tree, and no "Other fields" bucket.

This is the read surface a future editor or preview should use. Lower-level structural indexing is internal implementation detail and is deliberately not part of the public package boundary.

### V2 Draft → CharacterSheetSpec projection (DOMAIN IMPLEMENTED)

The V2 domain can now project a canonical draft into the render/export `CharacterSheetSpec` that preview and PDF export consume:

- it preserves canonical Field traversal order exactly
- a recursive Section interrupts its parent's Field run, and the parent resumes as a new run afterwards
- repeated flat Section groups can therefore appear for one canonical context; that is a flattening artifact of the flat render contract, not a structural statement
- an empty canonical Section produces no render output
- the flat target can now address up to 192 projected Sections, matching the page-addressable capacity of the sheet contract

This flattening is an adapter for the current flat render spec only. It is **not** the structural source of truth, and it does not replace `structure[]`.

**Status:** implemented and exported in the V2 domain package. The live preview and PDF export are still wired to the V1 projection; the parallel V2 preview/export consume the V2 projection but are not live.

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

### How to read this table

Statuses distinguish **domain implementation** from **runtime/UI integration**. A capability marked as V2 domain support is implemented and tested inside the draft domain package, but that does not mean a user can perform it in the editor yet, nor that the Worker, Web client, or persistence layer speak V2.

### V2 domain lifecycle status

The V2 domain layer now implements its complete lifecycle, independently of any runtime:

- direct V2 initial versioning (`initialDraftVersionV2`)
- V2 edit transitions (`applyDraftMutationV2`, the only public V2 edit contract)
- deterministic V2 reroll (`rerollLockedDraftValuesV2`)
- terminal V2 confirmation producing permanently read-only snapshots (`finalizeDraftV2`)

**Runtime cutover is still pending.** Worker routes and the extraction compiler still serve V1, and the live Web path (`CharacterWorkshop` → `SheetStore` → `SheetApiClient`) still reads and writes V1. In parallel, 4E3 prepared the route-independent Worker V2 core (canonical V2 persistence, create/mutation/reroll/confirm orchestration, egress serializers) and 4E4 prepared the parallel Web V2 runtime (`CharacterWorkshopV2` → `SheetStoreV2` → `SheetApiClientV2`, V2 fixtures, V2 extraction boundary, V2 sidebar/preview/export) — none of it live. Nothing in this section should be read as a claim that the V2 UI or the V2 runtime cutover has happened.

| Capability                                           | Status                                       | Notes                                                                                                                                               |
| ---------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual sheet creation                                | IMPLEMENTED                                  | Blank draft + editor (V1 runtime)                                                                                                                   |
| Upload existing sheet (PDF/PNG/JPG)                  | IMPLEMENTED                                  | AI vision extraction → editable draft (V1 runtime)                                                                                                  |
| AI vision extraction                                 | IMPLEMENTED                                  | Workers AI vision adapter; extraction compiler still emits V1 drafts                                                                                |
| Recursive Section hierarchy                          | IMPLEMENTED                                  | Domain model supports arbitrary depth (max 12) via `parentKey`                                                                                      |
| Field editing (text/number/textarea/checkbox/choice) | IMPLEMENTED                                  | Schema-driven editors (V1 runtime)                                                                                                                  |
| Live preview                                         | IMPLEMENTED (V1 RUNTIME)                     | Live preview renders via V1 `projectDraftToSpec`; parallel `SheetPreviewV2` renders via V2 projection but is not live                               |
| Confirm → read-only                                  | IMPLEMENTED                                  | V1 `finalizeDraft` live; V2 `finalizeDraftV2` implemented in domain                                                                                 |
| PC/NPC mode                                          | IMPLEMENTED                                  | UI + threat level for NPC                                                                                                                           |
| PDF export/download                                  | IMPLEMENTED (V1 RUNTIME)                     | Export renders via V1 `projectDraftToSpec`; parallel V2 export renders via V2 projection but is not live                                            |
| Visual style selection                               | PLANNED                                      | Style keys defined, rendering integration pending                                                                                                   |
| Visual style rendering                               | PLANNED                                      | Style keys defined, rendering integration pending                                                                                                   |
| Character image (upload/URL/AI)                      | PLANNED                                      | UI placeholder only                                                                                                                                 |
| Preview as modal                                     | NOT IMPLEMENTED                              | Live preview pane exists; modal UX target not implemented                                                                                           |
| Undo (server-authoritative)                          | NOT IMPLEMENTED                              | Target architecture defined; no domain mutation, Worker endpoint, or UI                                                                             |
| V2 initial versioning                                | IMPLEMENTED (V2 DOMAIN)                      | `initialDraftVersionV2`; creation validates supplied structure, never infers placements                                                             |
| V2 edit transitions                                  | IMPLEMENTED (V2 DOMAIN)                      | `applyDraftMutationV2` is the only public V2 edit contract                                                                                          |
| V2 deterministic reroll                              | IMPLEMENTED (V2 DOMAIN)                      | `rerollLockedDraftValuesV2`; deterministic per seed and Field registry order                                                                        |
| V2 terminal confirmation / read-only                 | IMPLEMENTED (V2 DOMAIN)                      | `finalizeDraftV2`; confirmed snapshots are permanently read-only                                                                                    |
| V2 structural read model                             | IMPLEMENTED (V2 DOMAIN)                      | Derived canonical preorder/roots/children/node lookup; `structure[]` stays canonical                                                                |
| V2 Draft → CharacterSheetSpec projection             | IMPLEMENTED (V2 DOMAIN)                      | `projectDraftV2ToSpec`; canonical Field order preserved; wired to parallel V2 preview/export, not to live UI                                        |
| `place_node` mutation                                | IMPLEMENTED (V2 DOMAIN)                      | Unified V2 placement for Fields and Sections; reachable from the parallel V2 workshop, not from live Web or Worker                                  |
| Recursive DnD (before/after/inside)                  | PARTIAL                                      | Domain: before/after/inside implemented via `place_node`; DnD UI not implemented                                                                    |
| Arbitrary sibling ordering                           | PARTIAL                                      | Domain: single canonical preorder implemented; editor DnD UI pending                                                                                |
| Mixed Field/Section sibling ordering                 | PARTIAL                                      | Domain support implemented; UI/runtime integration pending                                                                                          |
| `place_field` mutation                               | SUPERSEDED                                   | Not a separate V2 operation; unified `place_node` handles Field and Section placement                                                               |
| `place_section` mutation                             | SUPERSEDED                                   | Not a separate V2 operation; unified `place_node` handles Field and Section placement                                                               |
| `expectedVersion` conflict protection                | IMPLEMENTED (V2 DOMAIN + TRANSPORT CONTRACT) | Domain precondition → `version_conflict`; `expectedVersion` carried in every post-create V2 transport envelope. Worker/HTTP runtime cutover pending |
| Field label/type editing                             | IMPLEMENTED                                  | V1 runtime + V2 domain parity: `set_field_label`, `set_field_type`                                                                                  |
| Field lock/unlock                                    | IMPLEMENTED                                  | V1 runtime + V2 domain parity: `lock_field`, `unlock_field`                                                                                         |
| Value set/clear                                      | IMPLEMENTED                                  | V1 runtime + V2 domain parity: `set_value`, `clear_value`                                                                                           |
| Field add/remove                                     | IMPLEMENTED                                  | V1 runtime + V2 domain parity: `add_field`, `remove_field`                                                                                          |
| Section creation/renaming                            | IMPLEMENTED                                  | V1 runtime + V2 domain parity: `add_section`, `rename_section`                                                                                      |
| Field ↔ Section movement (`move_field`)              | IMPLEMENTED (V1 ONLY)                        | V1 compatibility/runtime op; superseded in V2 by `place_node`; not in `DraftMutationV2`                                                             |
| Section reparenting (`reparent_section`)             | IMPLEMENTED (V1 ONLY)                        | V1 compatibility/runtime op; superseded in V2 by `place_node`; not in `DraftMutationV2`                                                             |
| `remove_section` mutation                            | NOT IMPLEMENTED                              | Not implemented in V1 or V2; `place_node` does not cover deletion                                                                                   |
| `remove_section` safe semantics                      | NOT IMPLEMENTED                              | Target behavior only: empty Section may be removed, non-empty Section rejected                                                                      |
| Web V2 cutover                                       | PREPARED, NOT LIVE                           | Parallel `CharacterWorkshopV2`/`SheetStoreV2`/`SheetApiClientV2`, V2 fixtures/extraction/sidebar/preview/export exist; live Web path still V1       |
| Worker V2 cutover                                    | NOT IMPLEMENTED                              | Create/mutate/reroll/confirm routes and extraction compiler still V1; route-independent V2 core prepared but unwired                                |
| Persistence V2 write path                            | PREPARED, NOT LIVE                           | Canonical V2 R2 store adapter plus atomic initial-create primitive exist in parallel; live writes still V1                                          |
| V2 transport schemas                                 | IMPLEMENTED (V2 CONTRACT)                    | Six frozen payload schemas public via `@repo/character-sheet-draft`; consumed by the parallel V2 Web client, not by live traffic                    |
| V2 HTTP runtime cutover                              | NOT IMPLEMENTED                              | Worker routes, live Web client/store and live R2 writes remain V1                                                                                   |

### V2 response policy (after runtime cutover)

- HTTP draft responses are canonical V2 only; there is no V1|V2 response union.
- Historical V1 persistence is canonicalized in memory by
  `parseCanonicalCharacterSheetDraft`; the stored bytes are never rewritten
  merely because they were read, and the next state-changing write is V2.
- The `/v1/character-sheets` route prefix is API/storage-layout versioning, not
  draft `schemaVersion`, and is unchanged by the V2 draft cutover.

Full transport, concurrency and error contract:
`docs/architecture/phase-14.7/character-sheet-v2-transport-contract.md`.

---

## RELATED DOCUMENTS

- **Architecture:** `docs/architecture/phase-14.7/character-sheet-integration.md` (for implementation details, labeled with CURRENT/COMPLETED/SUPERSEDED/DEFERRED)
- **V2 transport contract:** `docs/architecture/phase-14.7/character-sheet-v2-transport-contract.md` (FROZEN FOR 4E CUTOVER)
- **Data Model:** `docs/architecture/data-model.md` (persistence direction)
- **ADRs:** ADR-056, ADR-057, ADR-015, ADR-052, ADR-054
- **Visual Style:** `.opencode/skills/rpg-frontend-style/SKILL.md`
