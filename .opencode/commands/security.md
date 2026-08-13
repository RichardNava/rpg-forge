---
description: Run a read-only security and privacy audit of a scope or the current working changes
agent: security
subtask: true
---

Perform a read-only security review.

Requested scope:

$ARGUMENTS

If the scope is empty, review the current working-tree changes and the security-sensitive surfaces they affect.

Follow the root `AGENTS.md` and the Security agent rules.

Load only the documentation relevant to the reviewed surface.

Review as applicable:

- secret handling and client/server boundaries;
- Better Auth session/authentication behavior;
- authorization and ownership;
- AI endpoint abuse, quotas, prompt handling and output validation;
- Turnstile/rate limiting where relevant;
- uploads, MIME/type/size validation and SVG/script risk;
- D1 query/ownership/migration behavior;
- R2 privacy/access/lifecycle;
- WebSocket and Durable Object authorization;
- invite/realtime credential handling;
- high-frequency realtime abuse/DoS;
- dependency/supply-chain risk;
- privacy, logging and unnecessary retention;
- Cloudflare binding/config exposure.

Do not edit files and do not print secret values.

Classify findings:

- Critical
- High
- Medium
- Low
- Informational

For each actionable finding provide:

1. file/location;
2. risk;
3. realistic attack/failure scenario;
4. mitigation;
5. whether it blocks merge/release.

If no material security issue exists, state that explicitly.

Finish with a clear release recommendation.
