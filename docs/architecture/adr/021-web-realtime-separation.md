# ADR-021 — Web y Realtime como deployables separados

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

```text
apps/web
→ Next.js/OpenNext Worker

apps/realtime
→ Cloudflare Worker + Durable Objects
```

`apps/realtime` se creará únicamente cuando comience La Mesa.

## Motivo

Los dos componentes tienen modelos de ejecución, bindings y testing distintos.

No se importará código de implementación entre ambas apps.

La comunicación será mediante protocolo y mecanismos de Cloudflare apropiados.
