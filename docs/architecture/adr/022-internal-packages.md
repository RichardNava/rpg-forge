# ADR-022 — Paquetes internos solo con reutilización real

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

Primeros paquetes previstos:

```text
@repo/dice-engine
@repo/table-contracts
```

Se crearán únicamente cuando llegue la feature correspondiente.

## Regla

No crear paquetes genéricos:

```text
utils
common
shared
types
```

sin una responsabilidad clara y consumo real por múltiples workspaces.

## Dependencia

```text
apps → packages
```

Nunca:

```text
packages → apps
```
