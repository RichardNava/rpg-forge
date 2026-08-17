# ADR-051 - Workerd PDF page extraction

**Status:** Accepted\n**Date:** 17/08/2026

## Context

The future rule-aware character-sheet work needs textual PDF evidence with reliable page provenance. It must run in Cloudflare `workerd`, not merely in a browser or Node.js, and does not need canvas rendering.

Phase 14.0 tested `pdfjs-dist@6.2.108` with an original 12-page fixture under both Cloudflare's Vitest pool and `wrangler dev --local`. The spike extracted every page with `getDocument()`, `getPage()`, and `getTextContent()`, including the exclusive `PAGE_TEST_07` provenance marker. The bundled PDF.js display module eagerly requires `DOMMatrix`, which `workerd` does not provide, even when no canvas is rendered.

## Decision

Use `pdfjs-dist@6.2.108` as the future implementation behind this direction:

```text
PdfPageExtractorPort
        ↓
pdfjs-dist
```

The adapter will be introduced only when Phase 14 implementation begins. It must:

- use page-by-page textual extraction only;
- not call PDF.js canvas rendering APIs;
- load the bundled PDF.js worker as an in-process message handler;
- keep the narrowly scoped `DOMMatrix` compatibility rationale under test, or replace it with an upstream-compatible solution;
- release PDF.js resources with `loadingTask.destroy()`;
- enforce explicit PDF byte and page-count limits before parsing.

## Consequences

- The Phase 14.0 extraction spike is accepted as viable with constraints, not migrated into `apps/web` yet.
- The measured spike bundle is 3195.57 KiB before gzip and 664.26 KiB gzip. It fits the current 3 MB gzip Free Worker size limit, but this is not a production size forecast because the spike bundles a fixture.
- The fixture's local wall-clock sample was 132.84 ms for 12 pages. A real Cloudflare preview must profile CPU and memory before Free-plan reliance because Workers Free allows 10 ms CPU per request.
- Scanned PDFs remain outside scope because this decision is textual extraction, not OCR.
- PDF.js upgrades require repeating the `workerd` tests because its display-module dependencies and bundling behavior are version-sensitive.

## Related ADRs

- ADR-001 - Cloudflare-first and free-first architecture
- ADR-002 - Next.js full-stack on Cloudflare Workers
- ADR-014 - Testing stack
- ADR-015 - PDF export stack
