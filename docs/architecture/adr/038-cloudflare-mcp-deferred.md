# ADR-038 — Cloudflare API MCP diferido

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

No activar todavía el MCP oficial de Cloudflare:

```text
https://mcp.cloudflare.com/mcp
```

## Motivo

Su valor principal es operar sobre la cuenta Cloudflare real.

Durante desarrollo temprano preferimos:

```text
Cloudflare skill
Context7
Wrangler
```

Se activa cuando exista una necesidad concreta de inspeccionar o gestionar infraestructura remota, con OAuth y mínimo privilegio.
