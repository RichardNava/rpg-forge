# ADR-007 — R2 diferido y almacenamiento efímero

**Estado:** Aceptada  
**Fecha:** 11/08/2026

## Contexto

Los mapas generados del MVP deben poder descargarse sin guardarse. Sin embargo, un mapa utilizado en La Mesa debe estar disponible para todos sus participantes.

## Decisión

No activar almacenamiento de recursos generados durante las primeras features.

Al implementar La Mesa, introducir `StoragePort` y R2 para mapas temporales compartidos.

Posteriormente R2 podrá almacenar recursos premium de forma permanente.

## Separación

```text
temporary table storage
≠
premium user library
```

Los objetos temporales tendrán limpieza/expiración.

## Consecuencia

Se evita pagar o diseñar una biblioteca antes de necesitarla y se conserva una ruta natural hacia persistencia futura.
