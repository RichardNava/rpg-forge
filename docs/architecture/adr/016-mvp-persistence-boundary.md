# ADR-016 — Persistencia mínima del MVP

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Contexto

El producto permite generar recursos sin cuenta y una cuenta gratuita solo es obligatoria para La Mesa.

## Decisión

D1 contendrá inicialmente el schema requerido por Better Auth.

No se crearán tablas de:

- campañas;
- recursos;
- generaciones;
- Mesas;
- planes;
- cuotas.

Los resultados de generadores gratuitos no se persisten por el hecho de estar autenticado.

## Consecuencia

```text
logged in
≠
persistent resources
```

La persistencia premium se añadirá cuando exista esa feature.
