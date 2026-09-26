# RPG Project — OpenCode Project Rules

This file contains the always-on rules for this repository.

The product name is provisional.

## 1. Product invariants

- The application is system-agnostic by default. Do not hard-code D&D, Pathfinder, Call of Cthulhu, Vampire, or any other game system into the core domain.
- A **one-shot** is a short adventure designed to start and finish in a single play session.
- Public generators are standalone tools. They must not require a campaign, persistent library, or premium account to work.
- In the MVP, the standalone tools are:
  - adventure generator;
  - map generator;
  - NPC generator;
  - character-sheet generator;
  - standalone dice roller.
- **The Table is the only multi-user, collaborative, realtime feature in the MVP.**
- Realtime synchronization must not be added to adventures, generated maps, NPCs, character sheets, or the standalone dice roller.
- The Table requires authenticated users, but it is free in the MVP.
- Free Table state is operational and temporary. It may survive reconnects, but it is not a permanently saved user resource.
- `logged in` does not mean `persistent resources`.
- Campaigns, persistent libraries, saved Tables, contextual campaign AI, user-uploaded lore sources, payments, subscriptions, and premium entitlements are future features.
- Future entities documented in `docs/` are architectural direction, **not authorization to implement them now**.
- Generated content must remain editable before export whenever the feature requires editing.
- Text exports target Markdown and PDF. Maps target JPG. Character sheets primarily target PDF.

## 2. AI invariants

- Features must never depend directly on a concrete AI provider SDK.
- Text generation must depend on the project text-generation port/contract.
- Image generation must depend on the project image-generation port/contract.
- Cloudflare Workers AI is the initial MVP provider, not a domain dependency.
- Provider/model names belong in configuration or infrastructure adapters, never inside feature/domain logic.
- Automated tests must use fake AI providers by default and must not consume real inference quota.
- Do not add RAG, embeddings, vector databases, or persistent lore ingestion unless explicitly requested for the relevant future phase.
- Do not treat commercial RPG PDFs as automatically licensed product knowledge.

## 3. Architecture invariants

The target repository is a pnpm workspace.

```text
apps/web
  Next.js application deployed to Cloudflare Workers through OpenNext.

apps/realtime
  Separate Cloudflare Worker for The Table and Durable Objects.
  Create only when The Table implementation begins.

packages/dice-engine
  Pure shared dice engine.
  Create only when Dice implementation begins.

packages/table-contracts
  Shared realtime protocol/contracts.
  Create only when The Table implementation begins.
```

- Do not add Turborepo unless a later explicit architectural decision requires it.
- Do not create empty future folders merely because they appear in architecture documentation.
- A directory should exist when it has a real implemented responsibility.

### `apps/web/src`

```text
app/
features/
core/
infrastructure/
shared/
config/
```

Responsibilities:

- `app/`: Next.js routing, layouts, route handlers, composition. No business logic.
- `features/`: product capabilities grouped by feature.
- `core/`: technology-independent cross-feature contracts and application errors.
- `infrastructure/`: concrete adapters such as Cloudflare AI, D1, Better Auth, export, R2.
- `shared/`: reusable web UI, hooks and genuinely generic utilities.
- `config/`: validated application configuration.

## 4. Dependency rules

Allowed direction:

```text
app -> features
app -> shared
features -> core
features -> shared
infrastructure -> core
apps -> packages
```

Forbidden by default:

```text
domain -> React
domain -> Next.js
domain -> Cloudflare
domain -> Drizzle
domain -> Better Auth

shared -> feature
package -> app
apps/web -> apps/realtime implementation
apps/realtime -> apps/web implementation
```

- Avoid circular feature dependencies.
- Do not import another feature's private implementation to save a few lines.
- Extract shared code only when a clear shared abstraction and real reuse exist.
- Do not create generic workspace packages such as `utils`, `common`, `types`, or `shared` without an explicit architectural reason.

## 5. Data and persistence rules

### MVP persistent data

D1 initially contains the schema required by Better Auth.

Do not create MVP tables for:

- campaigns;
- resources;
- generations;
- saved Tables;
- plans;
- subscriptions;
- entitlements;
- lore packs;
- user sources.

### Temporary operational persistence (explicitly allowed by approved architecture)

The following temporary operational metadata tables ARE permitted in the MVP when explicitly required by approved architecture:

- `sheet_sessions` — temporary Character Sheet session metadata (120-minute lifetime)
- `sheet_generation_runs` — temporary generation run metadata (session-scoped)
- `sheet_drafts` — temporary versioned draft snapshots (session-scoped, R2-backed)

These tables store **temporary operational metadata only** — no `CharacterSheetSpec` JSON, no PDF bytes, no provider payloads, no persistent user resources. They expire with their parent session and are cleaned up by session-sweep logic. They are NOT persistent user libraries, generation history, or campaign resources.

Do not create MVP tables for:

- campaigns;
- resources;
- generations;
- saved Tables;
- plans;
- subscriptions;
- entitlements;
- lore packs;
- user sources.

### D1 environments and migrations

- Local development uses Wrangler local D1 by default.
- Future remote environments are `rpg-forge-dev` for integration/beta and `rpg-forge-prod` for production.
- The current `DB` binding is local-only and intentionally has no remote `database_id`. It must not be used for deploy/upload commands because Wrangler may auto-provision an unbound resource. Add approved environment-specific remote IDs only when Dev/Prod are created.
- Local, Dev, and Prod share one Drizzle schema definition and one ordered migration sequence.
- Database migration commands must name their target explicitly. Do not create or use an ambiguous `db:migrate` command.
- Agents may run local migrations normally once the scripts exist.
- Dev migrations require explicit approval before any remote operation.
- OpenCode must never run production migrations automatically; Prod requires explicit human authorization and execution.
- Applied migrations in shared remote environments are immutable. Correct them with a new migration.
- Destructive migrations require review and explicit approval.

### Table state

The Table's canonical shared state belongs to its Durable Object.

- D1 is not the canonical store for active Table state.
- Connected participant presence belongs to WebSocket connection state.
- Temporary map assets may use R2 when The Table reaches that implementation stage.
- Standalone dice rolls have no persistent history in the MVP.
- Table dice rolls are realtime events, not a persistent roll history.

### Data conventions

- Use opaque non-sequential IDs for project-owned entities.
- `crypto.randomUUID()` is sufficient unless a later requirement justifies another ID scheme.
- Store project-owned timestamps in UTC.
- Validate persisted variable-shape JSON with Zod.
- Version persisted JSON structures with `schemaVersion`.
- Do not store images/PDF binaries as D1 BLOBs when R2 is the appropriate object store.

## 6. Cloudflare/runtime rules

Production server code targets Cloudflare `workerd`, not a traditional Node.js server.

- A dependency working under `next dev` is not enough to prove production compatibility.
- Validate relevant server changes with the Cloudflare/OpenNext preview workflow once the scripts exist.
- Keep Worker bindings typed.
- Secrets must use Cloudflare secrets/local ignored secret files; never hard-code them.
- Never expose server secrets through `NEXT_PUBLIC_*`.

## 7. TypeScript and validation

- TypeScript strict mode is mandatory.
- Avoid `any`. If an external API forces an unsafe boundary, isolate it and validate it.
- External input is untrusted until validated at runtime.
- Zod is the standard runtime-validation library.
- Reuse schemas when the same contract applies on client and server.
- Client-side validation never replaces server-side validation.

## 8. UI rules

- Use Tailwind CSS and the project's shadcn/Base UI primitives.
- Build the RPG visual language through reusable design tokens and themed components.
- Do not scatter arbitrary wood/parchment/sepia values across feature code.
- Prioritize accessibility, readability, responsive behavior and keyboard interaction over decorative effects.
- Keep `"use client"` at the smallest necessary boundary.
- Do not use `dangerouslySetInnerHTML` for AI-generated content unless explicitly justified and safely sanitized.

## 9. The Table rules

These rules apply only when working on The Table.

- The server/Durable Object is authoritative for shared state.
- The client may use optimistic/preview state, but canonical committed state comes from the server.
- Use world/board coordinates for shared positions, not screen pixels.
- Zoom, pan, local selection, hover and active tool are local UI state unless a future requirement explicitly changes this.
- Do not serialize Konva objects into the realtime protocol.
- Shared protocol messages contain domain data validated with Zod.
- Prefer preview + commit for high-frequency dragging/drawing rather than persisting every pointer movement.
- Reconnection obtains a canonical snapshot; do not require replaying a permanent event log.
- Realtime infrastructure must remain scoped to The Table in the MVP.

## 10. Change discipline

Before editing:

1. inspect the existing implementation;
2. inspect nearby tests and conventions;
3. identify the smallest responsible module;
4. read only the project documentation relevant to the task.

When editing:

- make the smallest coherent change that satisfies the request;
- preserve established architecture unless the task explicitly changes it;
- avoid unrelated refactors;
- avoid introducing a new dependency when the existing stack already solves the problem;
- do not install packages without first checking whether they are already present and whether the architecture allows them;
- do not implement future/premium features opportunistically;
- do not generate speculative tables, folders, APIs or abstractions "for later".

After editing:

- run focused checks first;
- then run the broader quality gates relevant to the change;
- summarize what changed and any remaining risk.

## 11. Verification

Once the bootstrap scripts exist, use the repository scripts rather than inventing alternative commands.

Target quality gates:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For relevant changes also run:

```text
pnpm test:e2e
Cloudflare/OpenNext preview
```

Prefer focused tests while iterating, followed by the required broader checks.

## 12. Git and destructive operations

- Never push to a remote repository unless the user explicitly requests it.
- Do not perform destructive Git operations such as hard reset, clean, force push or history rewriting unless explicitly requested.
- Do not silently commit changes.
- Do not overwrite user work unrelated to the current task.
- Never read or expose secrets from `.env`, `.dev.vars`, credentials, tokens or secret stores.

## 13. Documentation loading

Do **not** preemptively read every document in `docs/`.

Read the smallest relevant set.

### Product behavior

- `docs/product/vision.md` — product purpose, access model and long-term direction.
- `docs/product/mvp.md` — what is and is not in the MVP; acceptance criteria.
- `docs/product/feature-map.md` — relationships and release-level feature scope.
- `docs/features/character-sheets.md` — **canonical specification for Character Sheets feature behavior**.

### Architecture

- `docs/architecture/architecture.md` — system architecture and major boundaries.
- `docs/architecture/stack.md` — approved technologies and intentionally excluded dependencies.
- `docs/architecture/data-model.md` — persistence, Table temporary state and future data direction.
- `docs/architecture/repository-structure.md` — workspace structure, folder responsibilities and dependency boundaries.
- `docs/architecture/bootstrap.md` — reproducible Windows/bootstrap procedure and Phase 10 verification checkpoint.
- `docs/architecture/adr/` — decision history. Read the ADR relevant to the decision being changed or questioned.
- `docs/architecture/phase-14.7/character-sheet-integration.md` — implementation detail for Character Sheets; labeled CURRENT/COMPLETED/SUPERSEDED/DEFERRED.

### Loading rule

- Product/UX change: read the relevant product document(s). **For Character Sheets, read `docs/features/character-sheets.md` first.**
- Infrastructure/architecture change: read `architecture.md` and the relevant specialized architecture document/ADR.
- Database change: read `data-model.md` plus relevant ADRs.
- Folder/package/workspace change: read `repository-structure.md` plus relevant ADRs.
- Cross-cutting redesign: read all directly affected documents, not the entire documentation tree by default.

### Source-of-truth hierarchy

When resolving contradictions, the following authority order applies:

1. Explicit current task requirements from the user
2. Active feature specification for the feature being changed (e.g., `docs/features/character-sheets.md` for Character Sheets)
3. Current architecture contracts / ADRs
4. Current project context (`docs/opencode/project-context.md`)
5. Product-level documents such as MVP / feature map / vision
6. Historical phase documents
7. Existing implementation

**Important nuance:**

- The implementation is evidence of the current code state, but it is NOT automatically the product specification.
- Old documentation must NOT override a newer active feature specification.
- If documentation and implementation disagree, **do not silently choose one. Identify the discrepancy and determine which document is explicitly marked current/authoritative.**
- Historical/superseded documents are informative only.
- If no current authoritative answer exists, stop and ask rather than inventing a decision.

### Anti-regression rule

For an existing working feature, agents MUST preserve existing behavior unless the active task/spec explicitly changes it.

Large UI rewrites must not be used merely to make a new behavior easier to implement.

## 14. External documentation and MCP

- When a task depends on the **current API, configuration syntax, or version-specific behavior of a library/framework**, prefer the `context7` MCP tools instead of guessing from model memory.
- Use Context7 only when current external library documentation materially helps the task; do not call it for ordinary repository questions already answered by local code/docs.
- Local project documentation remains the source of truth for project-specific decisions, even when upstream documentation describes another valid approach.
- Do not use an MCP server to bypass repository permissions or architecture rules.
- Do not add a new MCP server merely because one exists. MCP tools consume context and expand the development supply chain.
- Cloudflare account-management MCP is intentionally deferred until infrastructure/account operations are needed.
- GitHub MCP is not part of the initial setup; local Git remains the default for repository work.
- Playwright MCP is not part of the initial setup; use the project's Playwright tests/CLI workflow for coding-agent browser work.

## 15. Project commands

The repository defines a small set of project-local OpenCode commands under `.opencode/commands/`.

Use them as workflow shortcuts; they do not override `AGENTS.md`, agent permissions, architecture, or user instructions.

```text
/feature <request>
→ Build coordinates a bounded implementation using the feature workflow.

/review [scope]
→ Plan performs an isolated read-only code/architecture review.
  With no scope, review current working changes.

/test [scope]
→ QA performs isolated verification and may edit tests only.
  With no scope, infer verification from current working changes.

/security [scope]
→ Security performs an isolated read-only audit.
  With no scope, review current working changes.

/adr <accepted decision>
→ Build records the next ADR and updates architecture documentation when needed.
  It must ask the user if the architectural decision is materially unresolved.
```

- `/review`, `/test`, and `/security` run as subtasks so their detailed review context does not unnecessarily pollute the main implementation context.
- `/feature` and `/adr` run in the main Build context because they may coordinate or write repository files.
- Project commands do not pin a model; they inherit the configured agent/model strategy.
- Do not use command-level shell-output injection for routine workflows. Let the executing agent run approved shell commands through normal permissions.
- Do not create a custom command with the same name as a built-in OpenCode command unless intentionally overriding that built-in behavior.
