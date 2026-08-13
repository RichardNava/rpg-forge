# ADR-029 — Specialized agents use `mode: all`

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

The project agents:

- frontend;
- backend-db;
- qa;
- security;

use `mode: all`.

## Motivo

They can be:

1. selected directly as primary agents for dedicated sessions;
2. invoked by Build as subagents;
3. invoked manually using `@agent`.

This supports both focused desktop sessions and delegated/parallel work.
