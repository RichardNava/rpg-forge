# ADR-023 — Organización feature-first

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

Dentro de `apps/web/src`:

```text
app/
features/
core/
infrastructure/
shared/
config/
```

`features` organiza capacidades de producto.

`core` contiene contratos transversales independientes de tecnología.

`infrastructure` contiene adaptadores concretos.

`shared` contiene UI/utilidades realmente genéricas.

## Restricciones

- domain no importa infraestructura;
- features no deben crear dependencias circulares;
- shared no importa features;
- app compone features pero no contiene negocio;
- route handlers y Server Actions delegan en casos de uso.
