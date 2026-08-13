# ADR-018 — Estado temporal de La Mesa

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

Cada Mesa activa tiene un Durable Object con SQLite propio.

Schema conceptual:

```text
table_meta
tokens
drawings
```

No existe `table_sessions` en D1 durante el MVP.

## Estado no persistido

No se almacenan:

- historial de dados;
- cursores;
- hover;
- zoom/pan;
- previews de drag;
- previews de dibujo.

## Escrituras

Movimientos/dibujos usan patrón:

```text
preview → realtime only
commit → persist + broadcast
```

## Expiración

El estado tiene TTL y alarm.

Al expirar:

- se invalida la Mesa;
- se elimina su estado temporal;
- se eliminan assets R2 temporales.

Esto no se considera persistencia premium.
