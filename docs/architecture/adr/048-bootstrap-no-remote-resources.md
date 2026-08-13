# ADR-048 — Bootstrap sin recursos remotos ni deploy

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

La Fase 10 crea y verifica el repositorio local, pero no:

```text
deploy
D1 database
R2 bucket
Better Auth configuration
Workers AI binding
Durable Object
realtime Worker
production secrets
```

## Motivo

Esas piezas deben introducirse cuando llegue su fase funcional y exista una necesidad real.

## Consecuencia

Durante el wizard de Cloudflare se seleccionará **No** cuando pregunte si se desea desplegar.
