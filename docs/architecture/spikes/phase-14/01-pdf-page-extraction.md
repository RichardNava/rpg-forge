# Spike A - Page-Aware PDF Extraction

**Status:** COMPLETE
**Date:** 17/08/2026

## Question

Can a maintained library run inside Cloudflare `workerd` and return page-aware text records in this shape without rendering canvas?

```ts
interface PageTextRecord {
  pageNumber: number;
  text: string;
  extractionQuality: number;
}
```

## Candidates

| Candidate                     | Version checked | License    | Result                  |
| ----------------------------- | --------------- | ---------- | ----------------------- |
| `pdfjs-dist` / Mozilla PDF.js | 6.2.108         | Apache-2.0 | VIABLE WITH CONSTRAINTS |

PDF.js was the required first candidate and met the spike requirements after an explicitly constrained runtime adaptation. No second candidate was installed because the first candidate is viable for the tested scope.

`pdfjs-dist@6.2.108` is maintained by Mozilla, requires Node `>=22.13.0 || >=24` for its Node package path, and declares `@napi-rs/canvas` only as an optional dependency. The spike does not install, import, or render through that canvas package.

## Methodology

The original, versionable fixture is generated from `spikes/phase-14/fixtures/fixture-content.ts`:

- `test-rulebook-source.md` and `test-rulebook.pdf` contain 12 original pages;
- each page has a unique `PAGE_TEST_01` through `PAGE_TEST_12` marker;
- the fixture includes English, Spanish accents, formulas, repeated terms, simple tables, and the page-12 prompt-injection evidence string;
- it contains no commercial rulebook material.

The minimal Worker in `spikes/phase-14/pdf-extraction/` exposes:

- `GET /fixture.pdf` for the bundled fixture bytes;
- `GET /extract` for fixture extraction;
- `POST /extract` for caller-supplied PDF bytes.

The extractor:

1. receives one `Uint8Array`;
2. calls `getDocument()` once;
3. iterates `getPage(pageNumber)` then `getTextContent()`;
4. rebuilds text from `TextItem` values only;
5. destroys the PDF.js loading task in `finally`;
6. never calls `render()` or creates a canvas.

PDF.js eagerly initializes code from its display/canvas module and therefore accesses `DOMMatrix` at module evaluation time. `workerd` does not provide that DOM global. The spike registers a narrowly scoped constructor-only `DOMMatrix` shim before dynamically loading PDF.js. Text extraction did not invoke matrix operations in the tested fixtures. The bundled `pdf.worker.mjs` is imported as an in-process message handler, avoiding `workerSrc`, a browser Worker, filesystem access, or external worker assets.

## Results

### Workerd validation

`@cloudflare/vitest-pool-workers@0.21.3` ran four passing tests against the experimental Worker:

- one-page textual PDF;
- 12-page original fixture;
- simple table extraction;
- English and Spanish accented text;
- valid blank PDF;
- invalid bytes and zero-byte payload rejection;
- provenance assertion that `PAGE_TEST_07` appears only in page 7.

`pnpm --filter @rpg-forge/phase-14-spikes verify:wrangler:pdf-extraction` also started the Worker with `wrangler dev --local` and returned:

```json
{
  "target": "pdf-extraction",
  "runtime": "wrangler dev --local",
  "pageCount": 12,
  "pageSevenMarker": true,
  "elapsedMilliseconds": 132.84
}
```

The elapsed time is one local wall-clock sample on this machine, not a Cloudflare CPU measurement or an SLA.

### Bundle and memory observations

`wrangler deploy --dry-run` only bundled locally and reported:

```text
Total Upload: 3195.57 KiB / gzip: 664.26 KiB
```

Cloudflare's current Worker size limit is 3 MB after gzip on Workers Free, so this spike bundle is below that limit. The uncompressed number includes the fixture payload and must not be used as a production size forecast.

The Worker holds caller bytes and PDF.js parsing structures in memory. It avoids multiple application-level PDF copies other than the necessary request/fixture handoff; PDF.js may take ownership of the typed array internally. No 500-page stress test, heap profile, or real Cloudflare CPU profile was performed. Cloudflare's documented per-isolate memory limit is 128 MB, and Workers Free has 10 ms CPU time per request. The local 12-page wall-clock sample is a material warning that production implementation must profile CPU and set an explicit upload/page policy before relying on the Free plan.

## Limitations

- The `DOMMatrix` shim is sufficient only for tested text extraction; it is not a rendering implementation.
- PDFs that cause PDF.js to use canvas/path transforms, CMaps, WASM image decoding, password handling, XFA, or unusual fonts require separate tests.
- This is textual extraction, not OCR. A scanned PDF can legitimately produce empty text and quality `0`.
- `extractionQuality` is an observability ratio of nonblank text items, not semantic or OCR confidence.
- Table layout is flattened to text spacing; the spike does not reconstruct table cells.
- The test-pool run emits PDF.js's Node-environment warning because the test runner exposes a Node-like process. The independent `wrangler dev --local` run is the workerd compatibility evidence.

## Decision

Use this future dependency direction, without creating the production port yet:

```text
PdfPageExtractorPort
        ↓
pdfjs-dist@6.2.108
```

The decision is accepted as **VIABLE WITH CONSTRAINTS**. The production adapter must preserve the no-canvas constraint, retain the shim rationale or replace it with an upstream-compatible solution, enforce PDF/page limits, and profile a real Cloudflare preview before release.

## Confidence

**Medium-high.** Page provenance and local `workerd` execution are directly demonstrated. Runtime compatibility beyond textual PDFs and Cloudflare Free CPU feasibility remain unmeasured.

## Follow-up

1. During Phase 14 implementation, add a production-owned `PdfPageExtractorPort` and adapter only after setting input/page limits.
2. Run an OpenNext/Cloudflare preview with representative permitted PDFs and measure CPU/memory.
3. Test encoded, multi-column, malformed, password-protected, and scanned PDFs separately.
4. Reassess the shim and bundle size on every PDF.js upgrade.

## Sources

- https://mozilla.github.io/pdf.js/
- https://github.com/mozilla/pdf.js
- https://developers.cloudflare.com/workers/platform/limits/