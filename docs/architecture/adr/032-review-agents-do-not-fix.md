# ADR-032 — QA and Security separation

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

QA may write tests but not production implementation.

Security is fully read-only.

## Motivo

Review agents should preserve independent verification.

Workflow:

```text
reviewer finds issue
→ implementation agent fixes
→ reviewer verifies
```

This reduces the risk of a reviewer hiding or reshaping the issue while attempting to fix it.
