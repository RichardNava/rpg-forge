---
description: Record an accepted architectural decision as the next project ADR
agent: build
subtask: false
---

Create or update architecture decision documentation for:

$ARGUMENTS

If no decision/topic is provided, stop and ask the user for it.

Follow the root `AGENTS.md`.

Before writing:

1. read `docs/architecture/architecture.md`;
2. read the specialized architecture document(s) affected by the decision;
3. inspect `docs/architecture/adr/` for related or superseded decisions;
4. identify the next available ADR number.

Determine whether the user has supplied an actually accepted decision.

If a material architectural tradeoff is still unresolved, or the requested choice conflicts with existing product/architecture decisions and the user's intent is not explicit, stop and ask the user before marking anything `Accepted`.

When the decision is clear:

1. create exactly one new ADR unless the request clearly requires updating an existing draft;
2. use a stable filename:
   `<NNN>-<short-kebab-case-title>.md`;
3. include:
   - title;
   - status;
   - date;
   - context;
   - decision;
   - rationale;
   - alternatives considered when relevant;
   - consequences/tradeoffs;
   - impact on existing architecture;
   - superseded/superseding ADR references when applicable;
4. update the relevant architecture document only if the accepted decision changes its source-of-truth description;
5. do not change production code as part of `/adr`;
6. do not create speculative implementation for the decision.

Never delete an old ADR merely because it was superseded. Mark the historical relationship instead.

Report:

- ADR created/updated;
- decision recorded;
- related ADRs;
- architecture documents updated;
- implementation work that remains separate.
