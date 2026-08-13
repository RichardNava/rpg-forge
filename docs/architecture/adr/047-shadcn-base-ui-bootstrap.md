# ADR-047 — shadcn inicial con Base UI

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

Inicializar shadcn/ui en `apps/web` usando Base UI, que es la base por defecto recomendada para nuevos proyectos desde julio de 2026.

Los aliases se ajustarán a la arquitectura del repositorio:

```text
@/shared/components
@/shared/components/ui
@/shared/hooks
@/shared/utils/cn
```

## Consecuencia

Los componentes generados por shadcn no crean una estructura paralela `src/components/ui` ajena al diseño aprobado.
