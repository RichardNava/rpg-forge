# Phase 14.4 Semantic Rules Analysis (Vector Retrieval + RulesContext)

**Status:** Implemented
**Date:** 2026-09-08

## Purpose

Phase 14.4 turns a READY rulebook (Phase 14.3) into a semantic, provably
evidence-backed `RulesContext` (Phase 14.1):

1. embed the extracted, chunked rulebook text;
2. index the vectors in a shared Vectorize index, isolated per rulebook
   generation by `namespace == ingestionId`;
3. embed a query derived from the character intent and user overrides, then
   retrieve top-k evidence from the isolated namespace;
4. run the analysis model over that evidence with a strict Zod 4 JSON-schema
   output, labeling PDF text as untrusted;
5. validate, cite only retrieved evidence, surface conflicts, and require an
   explicit user confirmation before the RulesContext becomes `ready`.

The phase introduces the durable orchestration, the run bookkeeping, the
fail-closed provider adapters, the HTTP surface, and the derived-data
invalidation that a future character-sheet generation phase will consume.

## Model and Index Configuration

Per ADR-053 and the phase decision:

```text
EMBEDDING_MODEL              = @cf/google/embeddinggemma-300m
EMBEDDING_DIMENSIONS         = 768
VECTOR_METRIC                = cosine
RULE_ANALYSIS_MODEL          = @cf/meta/llama-3.3-70b-instruct-fp8-fast
SHARED_VECTOR_INDEX          = one Vectorize index for all analysis namespaces
NAMESPACE_IDENTITY           = ingestionId (per rulebook generation)
MAX_EVIDENCE_PER_RULE        = 16 citations per normalized rule
MAX_EVIDENCE_QUOTE_CHARS     = 240 characters per evidence quote
RETRIEVAL_TOP_K              = 8
EMBEDDING_BATCH_SIZE         = 16
MAX_ANALYSIS_RULES           = 512
MAX_ANALYSIS_CONFLICTS       = 128
MAX_EVIDENCE_PREVIEW_CHARS   = 1200 per chunk preview sent to the model
MAX_QUERY_TEXT_CHARS         = 2000
MAX_PROMPT_EVIDENCE_CHARS    = 24000 total evidence text per prompt
MAX_RULES_ANALYSIS_OUTPUT_TOKENS = 8192
VECTORIZE_UPSERT_BATCH_SIZE  = 500
VECTORIZE_VISIBILITY_POLL_MS = 500   (base backoff)
VECTORIZE_VISIBILITY_MAX_INTERVAL_MS = 4000 (backoff cap)
VECTORIZE_VISIBILITY_MAX_WAIT_MS = 30000 (overall visibility deadline)
```

- The index is **shared** but every write and every read carries a
  `namespace`. There is **no namespace-less production retrieval**.
- Model names live in infrastructure adapters/configuration, never in domain
  feature logic.
- Embedding dimension (768) and metric (cosine) are enforced on the write path
  so a misconfigured index or model fails closed instead of producing a vector
  of the wrong shape.

## Run Model

A **rules-analysis run** is a durable, generation-scoped attempt to produce a
RulesContext for one analysis session. Each run:

- carries a fresh opaque `rulesAnalysisRunId` (a `crypto.randomUUID()`
  generation);
- captures the rulebook `ingestionId` (generation) it analyzed at the moment it
  was created;
- tracks the run operationally in D1 (`rules_analysis_runs`); D1 persists only
  run bookkeeping (run_id, status, failure_code, is_current), never RulesContext
  JSON;
- writes derived artifacts under
  `temp/rules/<analysisId>/<ingestionId>/run/<rulesAnalysisRunId>/…` in R2,
  including the canonical `context.json` (versioned `schemaVersion: "1"`,
  validated with Zod), so stale generations can never collide with newer ones;
  D1 is never the canonical store for a RulesContext.

```text
QUEUED --(workflow picks up)--> RUNNING --(ok, no conflicts)--> READY
                                          |                     |
                                          `--(conflicts)------> CONFLICTS --(confirm)--> CONFIRMED
                                          |                                       |
                                          `--(provider/validation fail)----------> FAILED
QUEUED/RUNNING/READY/... --(stale/superseded/rulebook removed)--> INVALIDATED
```

CAS-only transitions. Every transition verifies the run is still the **current
run** for the session and that its captured `ingestionId` still matches the
session's current rulebook generation. A stale run **must not mutate** D1, R2,
or the vector index.

### Run statuses

```text
QUEUED       created, not yet processed
RUNNING      processing workflow started
CONFLICTS    analysis produced an unresolved conflict; not ready
CONFIRMED    conflicts explicitly confirmed/resolved by the user; RulesContext is ready
READY        analysis produced no conflicts and immediately validated ready
FAILED       terminal provider/validation failure (failure_code set)
INVALIDATED  superseded by a newer run, or its rulebook was removed/changed
```

A RulesContext may also be `ready` via `status: "ready"` in the RunsContext
schema while the run is `CONFIRMED`; the run's own status is always what the
runtime owns.

## Shared Vectorize Index and Visibility Barrier

All vectors for all sessions live in **one** production index. Isolation is by
Vectorize `namespace`:

- write: `namespace = ingestionId` on every vector;
- read: query always passes `namespace = ingestionId` of the run's captured
  rulebook generation. There is no namespace-less production retrieval.

**Bounded visibility barrier:** Vectorize applies upserts asynchronously, so a
query that lands immediately after an upsert can miss freshly inserted vectors.
The adapter therefore waits after upsertting before returning, with an exact,
non-hot-loop mechanic:

- a single shared deadline (`VECTORIZE_VISIBILITY_MAX_WAIT_MS = 30 s`) bounds the
  wait across all upsert batches;
- a cheap query probe (`topK = 1`, no values/metadata, same namespace) acts as
  a propagation signal: once any just-upserted id is queryable, each batch
  (≤ `VECTORIZE_UPSERT_BATCH_SIZE = 500` ids) is confirmed exactly with
  `getByIds`;
- between checks the adapter backs off exponentially from
  `VECTORIZE_VISIBILITY_POLL_MS = 500 ms` to at most
  `VECTORIZE_VISIBILITY_MAX_INTERVAL_MS = 4 s`; it never hot-polls at a fixed
  sub-second interval;
- if the deadline expires before a batch is fully visible, the run fails closed
  (`RULES_CONTEXT_INDEX_UNAVAILABLE`) and the adapter rolls back the vectors it
  already wrote for the run;
- confirmation is best-effort against Vectorize's asynchronous replication and
  is an adapter concern only — the domain performs no visibility logic.

The `deleteByIds` invalidation path is unchanged: removing a rulebook or
superseding a run deletes the run's stored vector ids, so no stale vector is
retrievable through a newer run.

## Evidence-Backed Provenance (No Fabricated Citations)

The analysis model is shown retrieved chunk text labeled as **untrusted
rulebook data**. Each evidence item is an object `{ chunkId, quote }`, where
`chunkId` is opaque (already minted by Phase 14.3 chunking) and `quote` is a
verbatim, contiguous excerpt of that chunk's text.

The model output schema (a strict Zod 4 JSON-schema) requires each normalized
rule to cite at least one such evidence entry. After parsing:

1. the model output is validated structurally with `RulesAnalysisOutputSchema`
   (strict: an injected key such as `authorityOrder` or `ruleOverrides` is
   rejected at the schema boundary);
2. every evidence `chunkId` is checked against the set of chunkIds that were
   actually retrieved;
3. every evidence `quote` is normalized (whitespace runs collapsed to a single
   space, trimmed) and must occur as a substring of the referenced chunk's
   text. An unretrieved chunkId, an unknown chunkId, an empty quote, or a quote
   absent from the chunk text fails the run, and the prompt is replayed with
   the failed citations listed as feedback;
4. every `chunkId` is then mapped to its chunk's provenance (`sourceId`,
   `pageStart`, `pageEnd`, `chunkId`);
5. the resulting `RulesContext` goes through `RulesContextSchema` +
   `validateRulesContextDomain()`, which re-checks every citation's page bounds
   against the uploaded-rulebook `pageCount`.

The `quote` is provider-boundary proof of grounding only — it is never written
into the canonical RulesContext. Fabricated or out-of-corpus citations, and
quotes planted by instruction-injection attacks, are therefore structurally
impossible to persist in a READY RulesContext.

## Prompt Trust Boundaries (Role Separation)

The provider request is split into two Workers AI message roles:

- a trusted `system` message built only from server code and server-derived
  source identity (filename, size, sha256, the authoritative `source id`). It
  declares the rulebook text untrusted, forbids executing instructions found
  inside it, fixes the authority order to the single source, and forbids tools
  and external actions;
- an untrusted `user` (data) message that carries the character intent, user
  house rules, and the retrieved rulebook text labeled `RETRIEVED RULEBOOK
DATA`.

PDF-derived text never appears in the `system` message; the provider call
declares no tools. The two-channel boundary is asserted by production
regression tests using adversarial rulebook text.

## CharacterIntent ≠ RuleOverride

- `characterIntent` is the player's desired character, provided by the user and
  kept as its own domain field.
- `ruleOverrides` are user-authored house-rule changes, also provided by the
  user, stored in their own array with `sourceId` referencing the rulebook
  source.
- The model never merges the two; the domain contracts (Phase 14.1) keep them
  distinct, and the analysis prompt instructs the model to treat the user's
  override as a user-authored change distinct from character intent.

## Authority Order and Conflicts

- `authorityOrder` lists sources; the model never silently resolves a conflict
  by reordering sources or dropping a rule.
- The analysis model may emit explicit conflicts. If any conflict is
  unresolved, the RulesContext status becomes `building -> conflicts` (never
  `ready`).
- A `conflicts` context is only allowed to become `ready` through an **explicit
  user confirmation** (`POST …/confirmation`). Confirmation is CAS-guarded on
  `runId` + `analysisId` + captured `ingestionId` + `is_current` + status
  `CONFLICTS` (there is no separate confirmation-guard row). After confirmation
  the context is re-validated; unresolved conflicts block `ready`.

## API Surface

New endpoints (all require a valid active session bearer token and remain
`Cache-Control: no-store`):

| Method | Route                                                                | Behavior                                                                     |
| ------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| POST   | `/v1/rules-analysis/sessions/:analysisId/rules-context`              | start/queue a rules-analysis run; body `{ characterIntent, ruleOverrides? }` |
| GET    | `/v1/rules-analysis/sessions/:analysisId/rules-context`              | current run + RulesContext view (`202`/`200`/`404`)                          |
| POST   | `/v1/rules-analysis/sessions/:analysisId/rules-context/confirmation` | confirm a CONFLICTS context → READY/CONFIRMED                                |

Request body (`POST rules-context`):

```text
{ "characterIntent": { "summary": "…" },
  "ruleOverrides":   [ { "key": "…", "summary": "…", "sourceId": "<rulebook source id>" } ] }
```

### Error Contract

Existing error codes are reused and new run-typed codes added:

`RULES_CONTEXT_NO_READY_RULEBOOK` (409),
`RULES_CONTEXT_STORAGE_UNAVAILABLE` (503),
`RULES_CONTEXT_INDEX_UNAVAILABLE` (503),
`RULES_CONTEXT_MODEL_UNAVAILABLE` (503),
`RULES_CONTEXT_RUN_NOT_FOUND` (404),
`RULES_CONTEXT_ALREADY_READY` (409),
`RULES_CONTEXT_CONFIRMATION_NOT_NEEDED_OR_INVALID` (409),
`RULES_CONTEXT_ANALYSIS_FAILED` (500),
`RULES_CONTEXT_INVALID_CONFIRMATION` (400).

## Provider-Agnostic Ports

All AI/vector functionality lives behind ports in `@repo/rules-analysis-run`
(ADR-005, ADR-012). Infrastructure adapters in `apps/rules-worker` are the only
place that knows Workers AI / Vectorize.

```text
EmbeddingsPort        embed(texts) -> vectors
RuleVectorIndexPort   upsert(namespace, vectors); query(namespace, vector, topK);
                      deleteByIds(namespace, ids)
RuleAnalysisPort      generate({ system, user }) -> raw text
                      (system = trusted instructions only; user = untrusted run
                      data: character intent, house rules, retrieved rulebook text)
ChunkSourcePort       readChunks(analysisId, ingestionId) -> RulebookChunk[]
RunArtifactPort       putContext / putRetrieval / deleteRunArtifacts(analysisId, ingestionId, runId)
```

## Lifetime and Derivation Invalidation

- Parent session lifetime stays at **12 hours** (Phase 14.2). Run rows and
  derived artifacts share the session lifecycle.
- **Remove Rulebook invalidates semantic derivatives**: removing, re-uploading,
  or session cleanup of a rulebook marks every run for that `analysisId`
  `INVALIDATED`, deletes the run's R2 artifacts, and calls
  `deleteByIds(namespace=ingestionId, runVectorIds)` on the indexed vectors.
- A stale run R1 must not mutate a newer run R2: every run-hostile mutation is
  CAS-guarded by "still the current run for this analysisId + captured
  ingestionId still matches the session's current rulebook".

## Local Dev and Test Model

- `apps/rules-worker` declares no `vectorize` binding yet in `wrangler.jsonc`
  (deferred production resource, like the rate limiter and remote R2); the
  worker exposes an optional `VECTORIZE` binding in `Env` and fails closed when
  absent. The `ai` binding, by contrast, is declared in `wrangler.jsonc`
  (root `"ai": { "binding": "AI" }`), and `Env.AI` stays optional and fails
  closed when absent.
- A local-only Vectorize namespace and a local AI are NOT simulated here;
  tests use **deterministic fakes/stubs** for embeddings, the vector index, and
  analysis generation. No AI quota is consumed, and no remote index is
  created/mutated.
- Pure domain (`@repo/rules-analysis-run`): unit tests for the run state
  machine, evidence mapping, conflicts, confirmation, and stale-run guards.
- Worker handlers: HTTP tests with fake adapters.
- D1 + R2: workerd tests against the local D1/R2 and recording stubs for the AI
  and Vectorize adapters.

## Deferred

Not implemented in this phase: any route that consumes the RulesContext to
generate character sheets, OCR, multiple sources per run (presets/chat
sources), campaign persistence, premium entitlements, or realtime behavior.
