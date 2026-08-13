# ADR-031 — Agent-specific write boundaries

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

Use per-agent `permission.edit` patterns.

- frontend edits UI/client-owned areas;
- backend-db edits server/domain/infrastructure areas;
- qa edits tests only;
- security edits nothing.

## Motivo

Reduce accidental cross-layer refactors and make parallel work safer.

The boundaries are guardrails, not replacements for architectural documentation.
