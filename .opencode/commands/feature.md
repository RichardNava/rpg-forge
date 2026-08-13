---
description: Implement a bounded product feature or behavior change using the project workflow
agent: build
subtask: false
---

Implement the following requested feature or behavior change:

$ARGUMENTS

If no feature/change was provided, stop and ask the user to describe it.

Before editing:

1. Follow the root `AGENTS.md`.
2. Load the `feature-development` skill.
3. Read only the product/architecture documents relevant to this feature.
4. Inspect the existing implementation, tests, and nearby conventions.
5. Determine whether the request is:
   - standalone MVP functionality;
   - The Table;
   - cross-cutting infrastructure;
   - future/premium scope.

If the documentation does not resolve a material product or architectural ambiguity, ask the user before making that decision.

Do not implement future/premium behavior unless it is explicitly part of the request.

Plan the smallest coherent vertical slice, then implement it.

Delegate bounded work to project specialists when useful:

- `@frontend` for UI/client-owned work;
- `@backend-db` for domain/server/database/Cloudflare work;
- `@qa` for independent verification;
- `@security` when the change touches auth, authorization, public AI endpoints, uploads, secrets, D1 ownership, R2, WebSockets, Durable Objects, or sensitive dependencies.

Do not delegate the same file/contract to multiple agents concurrently.

Use approved project skills only when relevant, especially:

- `rpg-frontend-style` for material visible UI design;
- `ai-generation` for AI-backed generation behavior;
- approved external skills for current framework/platform guidance.

When implementation is complete:

1. run focused checks first;
2. run the broader quality gates relevant to the change;
3. validate Cloudflare/OpenNext compatibility for relevant server/runtime changes when that workflow exists;
4. report:
   - behavior implemented;
   - files/modules changed;
   - contracts/schema/config changes;
   - tests/checks executed;
   - security review status;
   - deliberately excluded future scope.
