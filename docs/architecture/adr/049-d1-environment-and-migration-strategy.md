# ADR-049 - D1 environment and migration strategy

**Status:** Accepted  
**Date:** 13/08/2026

## Context

RPG Forge will introduce D1 with Drizzle when authentication and database infrastructure begin. The project needs a safe, repeatable path from local development to the future shared development/beta and production databases without diverging schemas or ambiguous migration targets.

## Decision

Use three D1 environments with one shared Drizzle schema definition and one ordered migration sequence:

| Environment | D1 database                | Purpose                                 |
| ----------- | -------------------------- | --------------------------------------- |
| Local       | Wrangler local D1          | Default development environment         |
| Dev         | `rpg-forge-dev` remote D1  | Future integration and beta environment |
| Prod        | `rpg-forge-prod` remote D1 | Future production environment           |

When database tooling is implemented, migration scripts must have explicit targets:

```text
db:generate
db:migrate:local
db:migrate:dev
db:migrate:prod
```

There will be no ambiguous `db:migrate` command.

Operational controls:

- Local migrations may be run normally by agents.
- Dev migrations require explicit approval before any remote operation.
- Production migrations must never be run automatically by OpenCode and require explicit human authorization and execution.
- A migration already applied to a shared remote environment is immutable. Corrections use a new migration.
- Destructive migrations require review and explicit approval before execution.

## Rationale

Local D1 keeps normal development fast and isolated. Separate remote Dev and Prod databases protect production data while giving integration and beta work a realistic Cloudflare environment. A single schema and migration history prevent environment-specific drift. Explicit command names and permission boundaries make remote operations intentional and auditable.

## Alternatives considered

- A single remote D1 for all work: rejected because local development and production would share operational risk.
- Separate Drizzle schemas or migration histories per environment: rejected because they would introduce schema drift.
- A generic `db:migrate` command: rejected because it obscures the migration target.
- Automatically running production migrations from OpenCode: rejected because production schema changes require human control.

## Consequences

- Database tooling must declare and document each target explicitly when added in the database implementation phase.
- Future permission rules may allow local migration commands while requiring approval for Dev and denying automatic Prod migration commands.
- This ADR does not create D1 databases, Drizzle configuration, migration scripts, or authentication infrastructure.

## Impact on existing architecture

This extends ADR-004 and ADR-011 operationally without changing the choice of D1, Drizzle, or Better Auth. It preserves the MVP persistence boundary in ADR-016 and does not authorize future tables or remote resources during the current phase.

## Related ADRs

- ADR-004 - D1 + Better Auth
- ADR-011 - D1 + Drizzle + Better Auth
- ADR-016 - MVP persistence boundary
- ADR-017 - Data conventions
