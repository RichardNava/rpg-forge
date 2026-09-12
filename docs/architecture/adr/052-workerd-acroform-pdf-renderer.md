# ADR-052 - Workerd AcroForm PDF renderer

**Status:** Accepted
**Date:** 17/08/2026

## Context

ADR-015 selected `pdf-lib` for future fillable character-sheet PDFs. Phase 14.0 needed to prove this choice under `workerd` with a multipage document, static printable graphics, and editable AcroForm widgets rather than relying on browser or Node behavior.

The isolated spike generated blank and prefilled two-page PDFs using `pdf-lib@1.17.1`. It demonstrated text fields, checkboxes, radio groups, dropdowns, multiline text, prefilled values, and a deterministic coordinate layout under both Cloudflare's Vitest pool and `wrangler dev --local`.

## Decision

Use `pdf-lib@1.17.1` as the future implementation behind this direction:

```text
CharacterSheetPdfRenderer
        ↓
pdf-lib
```

When the production renderer is introduced, it must draw labels, frames, and manual-writing affordances as PDF graphics in addition to attaching AcroForm widgets. Form fields cannot be the sole source of printable visual structure.

The selected adapter must accept a deterministic bounded layout data shape and must remain separate from any final character-sheet domain schema. No renderer port, product dependency, or UI is introduced by this ADR.

## Implementation status

Phase 14.6 realizes this ADR as `packages/character-sheet-pdf-renderer`
(`renderCharacterSheetPdf({ spec }) → { bytes, manifest }`), a deterministic
AcroForm renderer over `pdf-lib@1.17.1` with a Node and a workerd test suite.
Two ADR-052 consequences now have concrete resolutions:

- Form-field appearance no longer depends on pdf-lib mutating the field: the
  renderer writes a full default appearance (`/Font size Tf r g b rg`) before
  `addToPage` because `setFontSize` on a fresh field throws
  `MissingDAEntryError`.
- Deterministic output uses fixed document metadata and
  `useObjectStreams: false`; verifying saved metadata requires
  `PDFDocument.load(bytes, { updateMetadata: false })` because pdf-lib
  overwrites `Producer`/`ModDate` during load.

Non-Latin glyphs, manual Acrobat/Chrome/Edge verification, and pdf-lib upgrade
checks remain open as documented below.

## Consequences

- The spike's bundle is 850.66 KiB before gzip and 218.49 KiB gzip, below the current 3 MB gzip Free Worker limit.
- The spike demonstrates a future two-page editable sheet; it does not prove an unbounded layout engine, PDF/A output, accessibility tagging, signatures, or template editing.
- Standard Helvetica is sufficient for the Latin test document. Production support for non-Latin field values requires an explicit embedded-font license, bundle-size, and viewer-appearance decision.
- Chrome, Edge, and Adobe Acrobat Reader interoperability remains a manual acceptance check. The generated spike artifacts are not evidence that Acrobat compatibility is complete.
- `pdf-lib` upgrades require rerunning the workerd and viewer checks because AcroForm appearance behavior can vary by version and viewer.

## Related ADRs

- ADR-001 - Cloudflare-first and free-first architecture
- ADR-002 - Next.js full-stack on Cloudflare Workers
- ADR-014 - Testing stack
- ADR-015 - PDF export stack
