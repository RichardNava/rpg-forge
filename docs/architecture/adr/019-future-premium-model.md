# ADR-019 — Modelo premium futuro sin migraciones prematuras

**Estado:** Aceptada como dirección futura  
**Fecha:** 12/08/2026

## Decisión

Se reserva conceptualmente un modelo futuro:

```text
campaigns
campaign_members
resources
campaign_resources
generations
saved_tables
lore_packs
user_sources
```

pero ninguna de estas tablas se crea durante el MVP.

## Principios

- `Resource` puede existir sin Campaign.
- Campaign organiza recursos; no es requisito para generarlos.
- DJ/PJ es un rol de campaña/Mesa, no del usuario global.
- No habrá `user.isPremium`.
- Una Mesa premium tendrá metadata en D1 y estado realtime en Durable Object.
- Binarios viven en R2; D1 almacena metadata.

## Regla para agentes

**Future schema is documentation, not an implementation instruction.**
