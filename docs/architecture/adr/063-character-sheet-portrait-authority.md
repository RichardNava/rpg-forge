# ADR-063 — Character Sheet Portrait Authority

**Status:** Accepted
**Date:** 2026-10-15

## Context

Phase 14.13 adds portraits to Character Sheets. The frozen product rule is
that a Portrait Slot is layout while a Portrait Image is content, and user
authority remains User > Draft > AI. The implementation must give users full
spatial control of the slot, converge three image sources onto one temporary
asset contract, and render the image without ever letting the model touch
geometry or content.

## Decision

### 1. The Portrait Slot is structural, not a Field

`DraftSlotV1 { key, type: "portrait" }` lives in an optional `slots[]`
registry (Draft V2 stays schemaVersion 2; historical snapshots remain valid).
`DraftPlacement.kind` grows to `field | section | slot` while `structure[]`
remains the sole hierarchy/order authority. At most one portrait Slot exists;
its key is globally unique; it is terminal; its parent is Root or a Section;
it carries exactly one placement. Geometry reuses the generic node contract;
aspect ratio (`1:1`, `3:4` default, `4:5`, `16:9`) lives in additive
`layout.slotDetails`, slot keys only.

### 2. Slot mutations are ordinary authoritative mutations

`add_portrait_slot`, `remove_portrait_slot`, and `set_portrait_aspect_ratio`
follow the registry-mutation contract (expectedVersion, confirmed guard, one
bump, no-op, atomic registry/structure/layout update, `validateDraftV2`
gate). `place_node` treats the Slot as a leaf. One-level Undo restores slot
state through existing snapshot semantics; there is no portrait-specific
Undo, and asset content is never rolled back.

### 3. Images converge to one session-owned asset

`CharacterSheetPortraitAssetStore` (put/get/delete, session sweep) persists
`image` + `metadata.json` under the existing session tenant. Upload, URL
import, and AI generation all mint a server-side opaque assetId and return
only `{ schemaVersion, assetId, source, mimeType }`. PNG/JPEG are magic-
validated with decoded pixel bounds. URL imports enforce HTTPS, no
credentials, no local/private targets, manual bounded redirects with
revalidation, no forwarded auth, and bounded bytes. AI generation receives
only the user description plus small trusted guidance behind an explicitly
injected `SHEET_PORTRAIT_MODEL`, failing closed when unconfigured.

### 4. Final generation revalidates; the renderer only draws bytes

`PortraitConfig` carries `none` or exactly one asset reference — never bytes,
base64, URLs, or prompts. The server rejects asset configs without a slot,
loads the asset by session + assetId, verifies the stored source kind, and
revalidates the bytes before rendering. The renderer receives validated
`{ slotKey, bytes, mimeType }` or null, embeds with contain-fit (never
distorted), and records `aspectRatio`/`contentState` in a style-invariant
semantic manifest.

## Alternatives considered

- **Portrait as a Field type** — rejected: fields carry labels/values/options
  and value semantics a picture must not have.
- **Draft V3** — rejected: additive optional registries keep every historical
  snapshot valid.
- **Storing image bytes in the Draft or D1** — rejected: content belongs in
  temporary session R2; the Draft carries geometry only.
- **Client-supplied URLs/prompts as generation authority** — rejected: the
  server imports once into R2 and revalidates ownership per run.
- **Portrait-specific Undo** — rejected: snapshot restore already covers slot
  state; assets are content, not history.

## Consequences

- Users author, move, resize, and remove the slot like any grid node.
- Upload, URL, and AI converge to one asset contract with identical downstream
  guarantees.
- Medieval and Sci-fi render the same portrait content with equal semantics.
- Portrait stays optional; `{ kind: "none" }` remains valid with or without
  a slot.
- AI character authoring remains deferred to 14.14.
