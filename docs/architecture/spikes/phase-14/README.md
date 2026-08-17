# Phase 14.0 Technical Spikes

**Status:** PARTIALLY COMPLETE — SPIKE C PENDING
**Date:** 17/08/2026

This directory records isolated technical experiments completed before any Phase 14 character-sheet feature work. The experimental implementation lives only in `spikes/phase-14/`; nothing here creates a product feature, a Cloudflare remote resource, or a persistent data model.

## Status Matrix

| Spike                          | Status                                      | Decision state                 |
| ------------------------------ | ------------------------------------------- | ------------------------------ |
| A - Page-aware PDF extraction  | COMPLETE                                    | Closed; ADR-051                |
| B - Multilingual embeddings    | COMPLETE                                    | Closed; ADR-053                |
| C - Structured Workers AI      | BLOCKED — REMOTE WORKERS AI ACCESS REQUIRED | No model roles or ADR selected |
| D - PDF plus AcroForm renderer | COMPLETE                                    | Closed; ADR-052                |

## Scope Boundary

The spikes deliberately do not create `RulesContext`, a production `CharacterSheetSpec`, routes, UI, workflows, RAG, Vectorize, R2, D1, presets, NPC generation, or player-character generation. The existing dice and auth implementation was not modified.

## Reproduction

From the repository root:

```text
pnpm --filter @rpg-forge/phase-14-spikes generate:fixture
pnpm --filter @rpg-forge/phase-14-spikes typecheck
pnpm --filter @rpg-forge/phase-14-spikes test:all
pnpm --filter @rpg-forge/phase-14-spikes verify:wrangler:pdf-extraction
pnpm --filter @rpg-forge/phase-14-spikes verify:wrangler:pdf-renderer
pnpm --filter @rpg-forge/phase-14-spikes generate:pdf-samples
```

`verify:wrangler:*` starts `wrangler dev --local`, exercises the relevant endpoint, and terminates only the process it created. It does not deploy or contact Cloudflare.

Manual PDF checks remain pending for:

- `spikes/phase-14/artifacts/sample.pdf`
- `spikes/phase-14/artifacts/sample-npc.pdf`

Open each artifact in Chrome, Edge, and Adobe Acrobat Reader before treating viewer interoperability as confirmed.

## Remote Resource Record

Spike B executed 12 remote Workers AI embedding calls through a temporary `ai-benchmark` Worker with a remote `[[ai]]` binding. No Vectorize index, R2 bucket, D1 database, Worker deployment, or paid billing was created or enabled.

Spike C has not yet executed remote Workers AI calls.

## Experimental Dependencies

All packages below are confined to `@rpg-forge/phase-14-spikes`; none is installed in `apps/web` as a product runtime dependency.

| Package                           | Version      | License           | Upstream               | Runtime bundle status                     |
| --------------------------------- | ------------ | ----------------- | ---------------------- | ----------------------------------------- |
| `pdfjs-dist`                      | 6.2.108      | Apache-2.0        | Mozilla PDF.js         | Bundled only by the extraction spike      |
| `pdf-lib`                         | 1.17.1       | MIT               | Hopding/pdf-lib        | Bundled only by the renderer spike        |
| `zod`                             | 4.4.3        | MIT               | colinhacks/zod         | Spike validation and tests only           |
| `@cloudflare/vitest-pool-workers` | 0.21.3       | MIT               | cloudflare/workers-sdk | Development and workerd test harness only |
| `@cloudflare/workers-types`       | 5.20260811.1 | MIT OR Apache-2.0 | cloudflare/workerd     | Development types only                    |

`THIRD_PARTY_NOTICES.md` was not changed: no candidate has been adopted into the product runtime. Package adoption, notices, and production placement belong to the Phase 14 implementation phase.

## Source Material

- Cloudflare Workers AI model catalogue, pricing, JSON Mode, and Vectorize documentation were checked on 17/08/2026.
- `pdfjs-dist` and `pdf-lib` package metadata was checked from the npm registry before installation.
- Upstream model cards were checked only to classify candidates; they do not replace a Workers AI benchmark.

See the individual records for full methodology, evidence, limitations, confidence, and follow-up work.
