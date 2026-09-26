---
name: feature-development
description: Implement a bounded RPG-project feature end-to-end while preserving MVP scope, repository boundaries, contracts, tests, and Cloudflare constraints. Use when a task adds or materially changes product behavior across one or more layers.
compatibility: opencode
metadata:
  project: rpg-project
  scope: implementation-workflow
---

# Feature Development

Use this skill for a real product feature or a meaningful behavior change.

Do not use it for a tiny typo, isolated style adjustment, pure review, or documentation-only edit.

## 1. Establish the feature boundary

Read the root `AGENTS.md`.

Then classify the request:

```text
Standalone MVP tool
The Table
Cross-cutting platform capability
Future/premium capability
```

If it is future/premium and the current task does not explicitly authorize that phase, do not implement it.

For product behavior, read the smallest relevant documents:

```text
docs/product/vision.md
docs/product/mvp.md
docs/product/feature-map.md
docs/features/character-sheets.md (when working on Character Sheets)
```

When an ACTIVE feature specification exists (e.g., `docs/features/character-sheets.md`), it must be read before generic product docs.

For architectural impact, read only the relevant architecture file(s) and ADRs.

## 2. State the invariant before coding

Write down the one or two product/architecture rules that could most easily be violated.

Examples:

```text
Adventure generation is standalone.
The Table is the only realtime feature in the MVP.
Logged in does not imply saved resources.
Feature code must not depend directly on a concrete AI provider.
```

Use these invariants to judge every proposed change.

## 3. Locate ownership

Map each responsibility to its owner.

Typical web feature:

```text
Route/page composition
→ apps/web/src/app

Feature UI
→ apps/web/src/features/<feature>/components

Feature domain/application
→ apps/web/src/features/<feature>/domain
→ apps/web/src/features/<feature>/application

Runtime validation
→ apps/web/src/features/<feature>/schemas

Prompts
→ apps/web/src/features/<feature>/prompts

Cross-feature contract
→ apps/web/src/core

Concrete technology adapter
→ apps/web/src/infrastructure
```

Only extract a workspace package when there is real cross-runtime reuse.

Do not create future directories merely to make the tree look complete.

## 4. Define contracts before implementation

For external/user input:

1. define or reuse the Zod schema;
2. define the TypeScript type from that schema where appropriate;
3. define the application input/output;
4. define provider/storage/realtime ports only if a technology boundary genuinely exists.

Avoid speculative abstraction.

A single implementation does not automatically require a new interface unless it protects an architectural boundary already established by the project.

## 5. Build the smallest vertical slice

Prefer a coherent end-to-end slice over many unfinished abstractions.

Example:

```text
input schema
→ use case
→ adapter
→ route/action
→ UI
→ edit/preview
→ export
→ tests
```

Do not add adjacent premium/history/campaign behavior unless explicitly requested.

## 6. Respect collaboration boundaries

If frontend and backend work can be separated:

```text
backend owns the contract
frontend consumes the contract
```

Make the shared contract explicit before parallel edits.

Avoid two agents simultaneously rewriting the same public interface.

For The Table:

```text
table-contracts
→ shared protocol data

apps/realtime
→ authoritative server behavior

apps/web/features/table
→ client rendering/state
```

Do not share implementation code between the two apps.

## 7. Security trigger check

Before declaring the feature complete, ask whether it changes any of:

```text
authentication
authorization
public AI endpoint
uploads
R2
D1 ownership
secrets
WebSockets
Durable Objects
external dependency
```

If yes, require a `@security` review before release/integration.

## 8. Test at the lowest useful layer

Choose the smallest layer that proves behavior:

```text
pure domain
→ Vitest unit test

React interaction
→ React Testing Library

Worker/D1/DO
→ Cloudflare Vitest integration

cross-application user journey
→ Playwright
```

AI tests use fake providers by default.

Do not use live AI output as a deterministic assertion.

**When an ACTIVE feature specification exists, it must be read before generic product docs.**

**User-visible cross-layer interactions must be validated at the appropriate level.**

**Typecheck + unit tests alone are insufficient evidence for complex interactive UI completion.**

**Preserve existing behavior not explicitly superseded by the active feature spec.**

## 9. Cloudflare compatibility gate

For server/runtime changes, successful `next dev` is not sufficient.

When the preview workflow exists, verify relevant changes under OpenNext/Cloudflare `workerd`.

Do not introduce Node-only dependencies without proving compatibility.

## 10. Completion report

Report:

1. feature behavior implemented;
2. files/modules changed;
3. contracts introduced or changed;
4. tests/checks executed;
5. security review requirement;
6. deliberately excluded future behavior.
