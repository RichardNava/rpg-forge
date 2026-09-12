# Phase 14.6 Character-Sheet PDF Renderer — Deterministic AcroForm Output

**Status:** Implemented
**Date:** 2026-09-12

## Purpose

The character-sheet PDF renderer turns a validated `CharacterSheetSpec` into
fillable AcroForm PDF bytes and a manifest. It is the export half of the
standalone character-sheet generator and the first production use of
`pdf-lib@1.17.1` behind the renderer direction approved in ADR-015 and
ADR-052.

Implementation lives in `packages/character-sheet-pdf-renderer`; the
renderer-neutral contract it consumes lives in
`packages/character-sheet-schema`.

## Public API

```text
renderCharacterSheetPdf({ spec }) → Promise<{ bytes, manifest }>
```

- `spec` is validated at runtime with the canonical `CharacterSheetSpecSchema`
  (Zod) and the schema package's domain validation before any PDF work begins.
- `bytes` is the raw PDF (object streams disabled for determinism).
- `manifest` describes the output: page count and one entry per rendered form
  field (`canonicalKey`, `pdfFieldName` with the `rpgforge.` prefix,
  `pageIndex`, `editable`), in placement order.
- The renderer is fully asynchronous and throws only
  `CharacterSheetPdfRenderError` with a documented, typed error code.

## AcroForm output model

- Every renderable field becomes a `PDFTextField` widget on the page where its
  section is placed. Only text fields exist in the MVP contract
  (`fieldKind` in the value resolver maps text, number, and calculated/scalar
  values to a text control; checkbox, select, and other kinds are
  `unsupported_field_type` for now).
- Textarea values are multiline widgets (`enableMultiline`).
- Calculated fields and any non-editable resolved value are read-only widgets
  (`enableReadOnly`) that reflect the stored snapshot value.
- Blank (`absent`/`null`) values produce a field with no `/V` entry — pdf-lib's
  representation of a truly empty control (`getText()` returns `undefined`).
- Duplicate AcroForm names (two fields whose `.`/`:`-normalized ids collide
  after the `rpgforge.` prefix) fail with `duplicate_form_field` rather than
  silently producing an invalid form.

### Default appearance and the `MissingDAEntryError`

Freshly created pdf-lib fields have no `/DA` (default appearance) entry, so
calling `PDFField.setFontSize` throws `MissingDAEntryError` (and a `/DA` with
no `Tf` operator throws `MissingTfOperatorError`). `PDFForm.addToPage` only
appends a text-color operator to an existing `/DA`; it never adds the font.

The renderer therefore writes the full default appearance itself before the
widget hits the page:

```text
/Helvetica <fittedSize> Tf r g b rg
```

`fitFieldValue` picks the largest supported size (10pt → 7pt) at which the
widest line fits the widget width. The size stays in the `/DA`, and pdf-lib's
appearance provider re-renders the visible value with the same font; the
appearance color operator appended by `addToPage` matches the `/DA` color, so
parser color-ordering is irrelevant.

## Determinism

- Identical specs produce byte-identical PDFs across calls (asserted in both
  the Node and workerd suites; verified artifact is a SHA-256 hash of bytes).
- The input spec is never mutated or reordered.
- Document metadata is pinned: title from the spec, producer `RPG Forge`,
  creator `RPG Forge Character Sheet Renderer`, and a fixed
  `RENDER_METADATA_EPOCH` creation/modification date.
- Object streams are disabled (`useObjectStreams: false`) and field
  appearances are updated from the renderer side so serialization is
  deterministic.
- Reading metadata back for verification requires
  `PDFDocument.load(bytes, { updateMetadata: false })`: pdf-lib otherwise
  overwrites `Producer` and `ModDate` at load time.

## Layout model

The renderer is a deterministic bounded fixed-grid engine for sheets produced
by the shared compiler's deterministic layout (`packages/character-sheet-schema`):

- Page sizes are US Letter (612&times;792pt, default) or A4
  (595.28&times;841.89pt), swapped for landscape orientation; the compact size
  intent coerces to US Letter.
- Margins, header, and footer are fixed. Sections are stacked top-right to
  bottom-left in field placement order; a section that does not fit the
  remaining vertical space fails with `layout_overflow` instead of overflowing
  the page.
- Section titles and field labels are drawn as PDF graphics (not form fields);
  frame rules and backgrounds come from the shared theme constants.
- Glyphs are pre-validated against the Standard 14 Helvetica encoding before
  any PDF work. Unsupported characters fail with `unsupported_glyph`;
  newlines are rejected in single-line values and allowed only in textareas.

## Text fitting policy

- **Field values**: shrink deterministically from 10pt to the 7pt floor; if
  even 7pt does not fit, the render clamps to 7pt instead of failing. The
  complete value stays stored in the field's `/V` entry. pdf-lib renders the
  static single-line appearance at the `/DA` font size verbatim, so text wider
  than the widget at 7pt is clipped to the widget bounds in the initial
  appearance; interactive viewers may re-render the field when it is focused
  or edited. `fitFieldValue` measures the widest single line so multiline
  textarea values fit correctly.
- **Labels and section headings** (fail-closed): shrink first (8pt→7pt,
  10pt→8pt), then wrap labels up to two lines; if still too wide, fail
  visibly with `layout_overflow`. Labels and headings are never silently
  truncated.

## Runtime and testing

- Node suite (33 tests, `vitest`): structural output, metadata, value
  round-trips, editable/read-only behavior, page geometry, determinism, input
  immutability, and the full error taxonomy.
- Workerd suite (3 tests, `@cloudflare/vitest-pool-workers`): the same
  renderer and an identical PDF pipeline inside the Cloudflare runtime,
  including determinism and error taxonomy.
- No AI provider is involved anywhere in this package.

## Limitations and risks

- Only Standard 14 Helvetica is embedded per viewer; non-Latin text in field
  values requires an explicit embedded-font decision (ADR-052 consequence,
  unchanged).
- Manual Acrobat/Chrome/Edge observable appearance remains a manual acceptance
  check; automated suites prove pdf-lib round-trips and determinism, not
  viewer pixel parity.
- `pdf-lib` upgrades require rerunning both suites and the viewer check
  (ADR-052 consequence, unchanged).
- The worker rewrite-response integration that will serve these bytes
  completes in the later integration phase (Phase 14.7); this package is the
  renderer, not the endpoint.

## Related documents

- ADR-015 — PDF export stack
- ADR-052 — Workerd AcroForm PDF renderer (accepted direction; this package is
  the production realization)
- ADR-054 — Zod 4 as canonical runtime validation
- ADR-056 — Deterministic character-sheet final construction (the producer of
  the `CharacterSheetSpec` this renderer consumes)
- Phase 14.5 — Character-Sheet Generation (the `spec` contract source)
- `docs/architecture/spikes/phase-14/04-pdf-acroform-renderer.md` — the
  original pdf-lib spike this phase promotes to production
