# Spike D - PDF and AcroForm Renderer

**Status:** COMPLETE
**Date:** 17/08/2026

## Question

Can a Cloudflare `workerd` Worker generate a printable, multipage PDF with editable AcroForm text, checkbox, radio, dropdown, multiline, prefilled, and blank fields?

## Candidates

| Candidate | Version checked | License | Result |
| --- | --- | --- |
| `pdf-lib` | 1.17.1 | MIT | VIABLE WITH CONSTRAINTS |

`pdf-lib` is maintained by Hopding/pdf-lib and has a pure JavaScript browser-compatible distribution. Its direct production dependencies are `@pdf-lib/standard-fonts`, `@pdf-lib/upng`, `pako`, and `tslib`; the spike's bundled result proves the relevant code builds under Wrangler. No second renderer was installed because the first candidate demonstrated every required form control.

## Methodology

The Worker in `spikes/phase-14/pdf-renderer/` exposes:

- `GET /sample.pdf` for a blank two-page sheet;
- `GET /sample-npc.pdf` for the same editable form with NPC values prefilled.

It uses an intentionally limited `sampleLayout` of `{ x, y, width, height, fieldType }` records. The same layout drives static PDF graphics and the AcroForm widget coordinates. This demonstrates deterministic AI-driven-layout feasibility without introducing a production layout system or a final character-sheet schema.

Page 1 contains Character Name, Archetype, Strength, Health, a checkbox, radio options A/B, and a dropdown. Page 2 contains Skills, Equipment, and a multiline Notes field. Every widget has a static label and an outer graphical frame, circle, or square so the blank print remains usable with a pen even if a viewer suppresses interactive appearances.

## Results

### Workerd validation

`@cloudflare/vitest-pool-workers@0.21.3` ran three passing tests inside workerd. They loaded the emitted bytes back through `pdf-lib` and proved:

- two PDF pages;
- 10 named fields;
- text fields, checkbox, radio group, dropdown, and multiline text field;
- blank state is unselected;
- prefilled NPC values, checkbox, radio selection, dropdown selection, and multiline text survive a reload;
- all sample layout coordinates fit Letter pages.

`pnpm --filter @rpg-forge/phase-14-spikes verify:wrangler:pdf-renderer` started `wrangler dev --local` and produced:

```json
{
  "target": "pdf-renderer",
  "runtime": "wrangler dev --local",
  "blankPdfBytes": 19625,
  "npcPdfBytes": 21196,
  "elapsedMilliseconds": 128.81
}
```

The elapsed time covers concurrent local requests for both PDFs and is not a Cloudflare performance commitment.

`pnpm --filter @rpg-forge/phase-14-spikes generate:pdf-samples` wrote manually inspectable artifacts:

```text
spikes/phase-14/artifacts/sample.pdf
spikes/phase-14/artifacts/sample-npc.pdf
```

### Bundle and memory observations

`wrangler deploy --dry-run` bundled locally and reported:

```text
Total Upload: 850.66 KiB / gzip: 218.49 KiB
```

This is comfortably below Cloudflare's current 3 MB gzip Free Worker limit. The output bytes are generated in memory before returning a `Uint8Array`; the tested two-page documents are about 19-21 KB. Larger sheets, images, custom font files, and complex appearance streams need memory and CPU profiling before production adoption.

## Limitations

- Browser interoperability is not proven by code. Chrome, Edge, and Adobe Acrobat Reader manual checks are still required.
- `pdf-lib` standard Helvetica is appropriate for the tested Latin labels. The upstream documentation requires an embedded custom font for non-Latin field values; international typography needs a dedicated font-license and bundle-size decision.
- The spike does not cover digital signatures, PDF/A, accessibility tagging, source-template filling, image assets, or a general layout engine.
- Field appearances can vary across PDF viewers; the static graphics mitigate printability but do not replace manual viewer verification.
- This is not a production `CharacterSheetPdfRenderer` interface or a final `CharacterSheetSpec`.

## Decision

Use this future dependency direction, without creating the production port yet:

```text
CharacterSheetPdfRenderer
        ↓
pdf-lib@1.17.1
```

The result is **VIABLE WITH CONSTRAINTS**. It confirms and refines ADR-015's PDF-stack direction for fillable character sheets. Production migration remains a Phase 14 implementation task.

## Confidence

**High** for workerd byte generation, multipage output, and AcroForm structure. **Medium** for viewer compatibility until manual Chrome, Edge, and Acrobat verification is recorded.

## Follow-up

1. Manually inspect both artifacts in Chrome, Edge, and Adobe Acrobat Reader.
2. Decide on an embeddable, licensed Unicode font before supporting arbitrary international field values.
3. Introduce a production-owned renderer port and a bounded layout contract only in Phase 14 implementation.
4. Profile representative sheets under an OpenNext/Cloudflare preview before release.

## Sources

- https://pdf-lib.js.org/
- https://pdf-lib.js.org/docs/api/classes/pdfform
- https://github.com/Hopding/pdf-lib
- https://developers.cloudflare.com/workers/platform/limits/