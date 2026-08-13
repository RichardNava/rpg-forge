# ADR-026 — Política base de permisos de OpenCode

**Estado:** Aceptada  
**Fecha:** 12/08/2026

## Decisión

Permitir automáticamente:

- lectura/edición normal;
- búsquedas;
- LSP;
- quality gates;
- Git de solo lectura.

Solicitar aprobación para:

- cambios de dependencias;
- staging/commit;
- deploy;
- directorios externos.

Denegar:

- push remoto;
- operaciones Git destructivas;
- borrado genérico;
- lectura de archivos de secretos mediante herramientas de archivo.

Los agentes de Fase 6 pueden imponer reglas más restrictivas.
