# ADR-042 — Routing de commands a agentes

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

```text
/feature  → Build, main context
/review   → Plan, subtask
/test     → QA, subtask
/security → Security, subtask
/adr      → Build, main context
```

## Motivo

Las revisiones aisladas pueden generar mucho análisis y deben regresar como resultado compacto.

Feature y ADR pueden necesitar coordinación/escritura y permanecen en Build.
