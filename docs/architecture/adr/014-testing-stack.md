# ADR-014 — Stack de testing

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

- Vitest 4 para unit tests;
- React Testing Library para componentes;
- `@cloudflare/vitest-pool-workers` para Workers, D1 y Durable Objects;
- Playwright para E2E.

## Regla

Tests automáticos de IA usarán providers fake.

No consumir cuota real salvo suites de integración explícitas.
