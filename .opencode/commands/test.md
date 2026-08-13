---
description: Run focused QA verification and add tests when appropriate without changing production code
agent: qa
subtask: true
---

Verify the following behavior/scope:

$ARGUMENTS

If no scope is provided, inspect the current working-tree changes and determine the relevant verification scope.

Follow the root `AGENTS.md` and the QA agent rules.

Read the minimum product documentation needed for acceptance criteria.

Use the lowest testing layer that proves the behavior:

- Vitest for pure/domain logic;
- React Testing Library for component behavior;
- Cloudflare Vitest integration for Worker/D1/Durable Object behavior;
- Playwright for end-to-end flows.

You may add or update tests and fixtures within QA's allowed paths.

Do not modify production implementation.

For AI behavior, use fake/deterministic providers in normal automated tests. Do not consume real Workers AI quota.

Workflow:

1. inspect the target behavior and existing tests;
2. reproduce reported failures when applicable;
3. run focused tests first;
4. add the smallest meaningful regression/coverage test when useful;
5. rerun the focused suite;
6. run broader relevant checks if justified;
7. classify failures as:
   - production defect;
   - test defect;
   - environment/configuration issue;
   - expected behavior mismatch.

Do not fix production defects yourself.

Report:

- behavior verified;
- tests added/changed;
- commands executed;
- passing checks;
- failing checks;
- exact production defects discovered;
- recommended next implementation agent if a fix is required.
