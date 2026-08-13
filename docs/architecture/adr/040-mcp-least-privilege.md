# ADR-040 — MCP: mínimo privilegio y deny-by-default

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

Las herramientas de un MCP se deniegan globalmente y se habilitan de forma explícita por agente.

Context7:

```text
context7_* → global deny
approved agents → allow
```

Futuros MCP capaces de modificar cuentas/servicios requerirán políticas todavía más restrictivas y aprobación humana para mutaciones.

## Motivo

Los MCP añaden contexto, herramientas externas y una nueva frontera de seguridad.
