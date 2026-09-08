# @repo/rulebook-ingestion

Pure application logic for one temporary, page-aware rulebook ingestion per
temporary Rules Analysis session.

The package has no Cloudflare, D1, Drizzle, R2, Workflow, Node, DOM, or Next.js
dependency. HTTP request streams are adapted to `AsyncIterable<Uint8Array>` at
the Worker boundary. Processing reads bounded byte ranges through a pure source
port, then emits validated extraction and chunk artifacts.

## Lifecycle

```text
UPLOADING -> QUEUED -> PROCESSING -> READY
                               └-> FAILED

any current state -> DELETING -> metadata removed
```

`analysisId` owns the one current row. `ingestionId` is an independent,
non-secret UUID generation guard, so a stale workflow cannot modify a later
replacement rulebook.

## Safety limits

- PDF bytes: 50 MiB
- PDF pages: 500
- per-page extracted text: 20,000 chars
- total extracted text: 2,000,000 chars
- chunks: 1,500 max chars, 1,200 target chars, 200-char overlap, 2,500 max

The text-quality gate is deterministic, not OCR: it requires at least 1,000
non-whitespace characters, 50 characters/page on average, and meaningful text
on at least `min(pageCount, max(2, ceil(pageCount * 0.05)))` pages. Failure is
reported as `RULEBOOK_REQUIRES_OCR`; this does not claim to identify the
physical origin of a PDF.

PDF-derived text is always untrusted data. This package only normalizes,
validates, and chunks it deterministically; it never interprets it as
instructions or invokes an AI provider.
