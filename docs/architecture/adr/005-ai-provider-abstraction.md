# ADR-005 — IA desacoplada del proveedor

**Estado:** Aceptada  
**Fecha:** 11/08/2026

## Contexto

Workers AI es apropiado para las pruebas gratuitas, pero el producto podría utilizar OpenAI, Gemini u otros proveedores en el futuro.

## Decisión

Definir puertos de aplicación separados como mínimo para:

```text
TextGenerationPort
ImageGenerationPort
```

El primer adaptador será Cloudflare Workers AI.

## Regla

Las features no pueden importar SDKs de proveedores de IA.

Solo los adaptadores de infraestructura conocen el proveedor.

## Consecuencias

Permite cambiar modelo/proveedor por calidad, coste, disponibilidad o plan del usuario sin reescribir aventuras, NPC o mapas.
