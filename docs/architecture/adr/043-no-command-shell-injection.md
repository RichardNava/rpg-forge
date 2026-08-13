# ADR-043 — Sin shell-output injection en commands iniciales

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

No utilizar inicialmente:

```text
!`command`
```

dentro de los custom commands.

## Motivo

Git, tests y verificaciones deben ejecutarse mediante las herramientas/permisos normales del agente.

Esto mantiene aprobación, auditoría y control de contexto centralizados.
