---
description: Perform a read-only architecture and code review of a scope or the current working changes
agent: review
subtask: false
---

Perform a read-only review.

Requested scope:

$ARGUMENTS

If the scope is empty, review the current uncommitted/working-tree changes.

Follow the root `AGENTS.md`.

Read only the product/architecture documentation needed to understand the reviewed code.

Inspect the relevant implementation, tests, and Git diff/status as needed.

Focus on:

- correctness and likely bugs;
- violations of MVP/product scope;
- architecture/dependency-boundary violations;
- accidental premium/future implementation;
- inappropriate persistence or realtime behavior;
- Cloudflare/workerd compatibility risks;
- TypeScript/Zod contract quality;
- maintainability and unnecessary abstractions;
- missing or weak tests;
- regressions and edge cases;
- unrelated refactors or excessive change scope.

This is not a full security audit. Mention obvious security issues, but use `/security` for a dedicated security review.

Do not edit files.

Report findings in priority order:

- Critical
- High
- Medium
- Low
- Informational

For each actionable finding include:

1. file/location;
2. issue;
3. why it matters;
4. concrete recommendation.

If there are no material findings, state that explicitly.

Finish with:

- overall assessment;
- merge/integration readiness;
- tests or reviews still recommended.
