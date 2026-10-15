# Phase 14.13 — Portrait Integration

**Status:** COMPLETED
**Date:** 2026-10-15
**Decision record:** `docs/architecture/adr/063-character-sheet-portrait-authority.md`
**Canonical product spec:** `docs/features/character-sheets.md` (ACTIVE)

## Purpose

Phase 14.13 adds portrait support to Character Sheets under one frozen rule:

**Portrait Slot = layout. Portrait Image = content.**

The Slot is spatial Draft/layout authority (authored, moved, resized like any
grid node). The Image is a temporary session-scoped content asset consumed
only by final generation. User authority remains User > Draft > AI: the model
never moves, resizes, or deletes the Slot.

Phase 14.13 does NOT own AI character creation, conversational NPC authoring
(14.14), image filters, crop editors, multiple portraits, or extra styles.

## What 14.13 delivered [COMPLETED]

```
Preflight
  -> binary-safe same-origin proxy (arrayBuffer for PDF/PNG/JPEG,
     content-disposition forwarded, non-UTF8 regression test)
  -> real container-local grid packing in the Draft-native renderer
     (siblings share rows, rowSpan reserves, breakBefore breaks, nested
     grids independent; planStyledDraftLayout exported and tested directly)
  -> explicit SHEET_PRESENTATION_MODEL injection (no globalThis lookup)

Draft Slot domain (schemaVersion stays "2"; no V3)
  -> slots?: DraftSlotV1[] (optional; historical V2 without slots valid)
  -> max ONE portrait Slot; globally unique keys; terminal (no children);
     Root-or-Section parents only; exactly one structure placement
  -> DraftPlacement.kind: field | section | slot (structure[] stays the SOLE
     hierarchy/order authority)
  -> DraftLayoutV1.slotDetails: bounded aspect enum (1:1, 3:4, 4:5, 16:9),
     default 3:4; slot-only keys; atomic with registry/structure/layout
  -> add_portrait_slot / remove_portrait_slot / set_portrait_aspect_ratio
     (expectedVersion, confirmed guard, one bump, no-op, validateDraftV2 gate)
  -> place_node extended: Slot is a leaf (before/after Field/Section/Slot,
     inside Section/Root; Field/Slot parents rejected; geometry preserved)
  -> read model: DraftSlotReadNodeV2; CanvasSelection + CanvasNodeKind + slot;
     SpatialNodes renderSlot shared by Canvas and Preview

Canvas portrait slot
  -> one clear "Add portrait" action while editable
  -> real grid item: distinct frame, select, drag (before/after/inside),
     keyboard move, resize through existing grid semantics
  -> inspector: parent, move, position, spans, aspect ratio, remove
  -> confirmed drafts immutable

Portrait assets (@repo/character-sheet-portraits, new)
  -> CharacterSheetPortraitAssetStore port (put/get/delete, session sweep)
  -> PNG/JPEG magic validation, decoded pixel bounds (8 MiB / 40M px)
  -> R2 tenant temp/character-sheets/v1/sessions/<s>/portraits/<a>/
     (image + metadata.json, no-store); session cleanup covers portraits
  -> PortraitGenerationPort (prompt + styleContext only; never Draft/tokens)

Sources -> one temporary session-owned asset
  -> POST .../portraits/upload (multipart image, PNG/JPEG magic, pixel bound)
  -> POST .../portraits/import-url (HTTPS-only, no credentials, no
     localhost/.local/private/reserved literals, manual redirects <= 3 with
     revalidation, no forwarded auth, bounded bytes, magic validation)
  -> POST .../portraits/generate (bounded prompt <= 2000, SHEET_PORTRAIT_MODEL
     explicit injection, fake port in tests, missing model fails closed)
  -> GET .../portraits/:assetId (authorized, session-scoped, raw bytes,
     stored mimeType, no-store; no public R2 URLs)
  -> dedicated sheet-portrait-upload/url/generate rate-limit keys

Final generation
  -> PortraitConfig: none | upload/url/ai + server-minted assetId (no bytes,
     base64, dataUrl, URL, or prompt in the request)
  -> server validates: no-slot + asset rejected; slot + none valid; asset
     must exist in-session with matching source kind and valid bytes
  -> renderer input: validated { slotKey, bytes, mimeType } or null; no
     fetching, no AI, no R2 inside the renderer
  -> portrait embedded contain-fit (aspect preserved, never distorted);
     empty slot renders a styled frame; styles differ only in frame treatment
  -> semantic manifest gains slot nodes (key/kind/parent/order/layout/
     aspectRatio/contentState); Medieval vs Sci-fi semantic equal

Web
  -> WorkshopPreferences.portrait reuses shared PortraitConfig (no duplicate)
  -> compact source selector (None/Upload/URL/AI); switches only on server
     confirmation; failures retain the previous config; no File/base64 in
     store (File lives only during upload execution)
  -> protected preview via ephemeral object URLs (contain fit, revoked on
     replace/unmount); empty placeholder frame
  -> store generateFinalSheet carries the workshop portrait config; stable
     per-Draft seed; technical PDF stays secondary
```

## Contract summary

- **Portrait Slot = spatial Draft/layout authority; Portrait Image = temporary
  generation content.** The slot is not a Field; Draft V2 stays schemaVersion 2
  and old snapshots remain valid; exactly one portrait Slot in 14.13.
- **Aspect ratio is layout metadata** (1:1, 3:4 default, 4:5, 16:9); moving the
  slot never alters it; resizing changes grid spans, not image content.
- **One active source** — upload/url/ai resolve to one temporary assetId; no
  raw image lives in the Draft, the request, or Workshop state.
- **Portrait assets are session-scoped R2** (`portraits/<assetId>/image` +
  `metadata.json`); final generation revalidates ownership server-side.
- **The renderer consumes validated bytes only** — same portrait content in
  Medieval and Sci-fi; semantic manifests equal.
- **No portrait-specific Undo** — slot mutations restore through existing
  snapshot semantics; asset content is not rolled back.
- **Technical export limitation** — the flat `CharacterSheetSpec` technical
  PDF cannot represent Portrait Slots, so technical export rejects slotted
  drafts with an explicit error instead of silently dropping the slot.
- **AI character authoring still belongs to 14.14.**

## Test coverage

**Draft domain (`@repo/character-sheet-draft`, 1409+slot suite):**
historical slotless validity; one-slot cap; global key uniqueness; exactly-one
placement; terminality; Root/Section parents; Field/Slot parents rejected;
atomic add/remove/aspect; confirmed/stale-version rejection; one bump; no-op;
layout node + detail lifecycle; layoutless stays layoutless; aspect matrix;
place_node before/after/inside incl. geometry preservation; read-model slot
node; Undo restores slot state via snapshot semantics.

**Portraits (`@repo/character-sheet-portraits`, 13 tests):** PNG/JPEG magic and
dimensions; empty/oversized/non-image/truncated/GIF rejections; key tenant
paths and traversal rejection; asset round-trip, cross-session isolation,
session sweep, missing-null reads.

**Renderer (`@repo/character-sheet-pdf-renderer`, 66 tests):** real container
grid packing direct-plan tests (shared rows, occupancy, rowSpan, breakBefore,
nested independence, mixed order); empty slot frame; PNG + JPEG embed; magic
mismatch rejection; aspect-driven frame heights; root/nested/shared-row
slots; Medieval/Sci-fi same-image semantic equality; no raster artwork;
overflow fails closed.

**Worker (`rules-worker`, 402 node + 132 workerd tests):** presentation-model
injection (custom model reaches `ai.run`); portrait URL validation + import
policy (HTTPS, credentials, localhost/.local/private/IPv6 literals, redirect
to forbidden host, redirect limit, oversized, non-image, no auth forwarding);
portrait AI adapter (prompt-only input, blank-prompt gate, provider failure,
invalid bytes); R2 portrait adapter (round-trip, headers, traversal guard,
session sweep); upload/import/generate/preview endpoints (happy paths,
400/413/415/404/503 codes, cross-session block); orchestrator slot coherence
(no-slot+asset rejected with no run; slot+asset renders image bytes into PDF;
missing/mismatched asset fails run without PDF; slot+none valid).

**Web (unit/RTL/API, no Playwright):** canvas slot render/select/keyboard-move/
resize; inspector aspect/geometry/move/remove; proxy portrait routes;
binary-safe proxy regression; client upload/import/generate/download; store
portrait switching/failure-retention/stable-seed; local backend portrait
round-trip and closed URL/AI; final panel (Medieval/Sci-fi, threat,
instructions, stable seed, technical PDF secondary); set_mode intact.

## Related documents

- ADR-063 — Character Sheet Portrait Authority
- `docs/features/character-sheets.md` (ACTIVE product behavior)
- ADR-062 — Character Sheet AI Presentation Authority (Phase 14.12)
- ADR-061 — Canonical Final Generation Contract (Phase 14.11)
- `docs/architecture/phase-14.12/character-sheet-ai-final-presentation.md`
