# MCP de OpenCode — Proyecto RPG

**Fase:** 8 — MCP  
**Estado:** Aprobada  
**Versión:** 0.1  
**Fecha:** 12 de agosto de 2026

## 1. Resultado

El catálogo inicial queda reducido a:

```text
ACTIVO
└── Context7

DIFERIDO
└── Cloudflare API MCP

OMITIDOS
├── GitHub MCP
├── Playwright MCP
├── filesystem MCP
├── shell MCP
└── Git MCP
```

## 2. Por qué solo Context7

La necesidad inmediata que no cubre bien el repositorio local es:

> documentación externa actualizada y específica de versión.

Context7 resuelve exactamente esa necesidad.

OpenCode incluye Context7 entre sus ejemplos oficiales de MCP y documenta el endpoint:

```text
https://mcp.context7.com/mcp
```

No necesitamos introducir una API key en Git.

## 3. Integración con AGENTS.md

Se añade una regla:

```text
si una tarea depende de la API/sintaxis actual de una librería,
usar Context7 en vez de asumirla de memoria
```

Esto no afecta a decisiones propias del proyecto:

```text
docs/
→ sigue siendo source of truth
```

## 4. Permisos

Las herramientas MCP de OpenCode usan el nombre del servidor como prefijo.

Por tanto:

```text
context7_*
```

se deniega globalmente y se habilita explícitamente a:

```text
Build
Plan
frontend
backend-db
qa
security
```

Así un futuro MCP no se convierte automáticamente en herramienta disponible para todos.

## 5. Cloudflare MCP

Cloudflare publica actualmente un MCP remoto oficial en:

```text
https://mcp.cloudflare.com/mcp
```

Es técnicamente atractivo porque su API completa se expone mediante un patrón Code Mode de dos herramientas y un coste de contexto mucho menor que miles de schemas.

Aun así se difiere.

### Motivo

La Fase 8 no necesita acceso operativo a nuestra cuenta Cloudflare.

Cuando comencemos a gestionar infraestructura real, revisaremos:

- OAuth;
- scopes;
- operaciones permitidas;
- confirmación para mutaciones.

Hasta entonces:

```text
Cloudflare skill
+
Context7
+
Wrangler
```

son suficientes.

## 6. GitHub MCP

No se instala.

Razones:

- tenemos Git local;
- el repositorio es privado;
- todavía no existe un workflow intenso de issues/PRs;
- OpenCode advierte expresamente del coste de contexto del GitHub MCP.

Se reconsidera si GitHub pasa a ser una herramienta operativa del agente y no simplemente hosting remoto del repositorio.

## 7. Playwright MCP

No se instala.

Microsoft diferencia actualmente:

```text
Playwright CLI
→ recomendado para coding agents / menor coste de tokens

Playwright MCP
→ automatización exploratoria/agéntica persistente
```

Nuestro stack ya incorpora Playwright Test.

Por tanto QA utilizará:

```text
Playwright Test
shell/CLI
```

y no un MCP adicional.

## 8. Sin MCP duplicados

No instalaremos MCP de:

```text
filesystem
shell
Git
```

OpenCode ya proporciona esas capacidades de forma nativa.

Tampoco Supabase, porque la arquitectura usa D1/Drizzle/Better Auth.

## 9. Configuración resultante

`opencode.jsonc` añade:

```jsonc
"mcp": {
  "context7": {
    "type": "remote",
    "url": "https://mcp.context7.com/mcp",
    "enabled": true
  }
}
```

y:

```jsonc
"permission": {
  "context7_*": "deny"
}
```

Los agentes aprobados sobrescriben esa regla con `allow`.

## 10. Documentación

Se añade:

```text
docs/opencode/mcp-manifest.md
```

como inventario de:

- activos;
- diferidos;
- omitidos;
- reglas de seguridad;
- comandos de diagnóstico.

## 11. Cambios acumulativos

Fase 8 actualiza:

```text
AGENTS.md
opencode.jsonc
.opencode/agents/*.md
```

No crea plugins ni commands.

## 12. Próxima fase

**Fase 9 — Commands.**

Ahí definiremos workflows explícitos, previsiblemente:

```text
/feature
/review
/test
/security
/adr
```

y decidiremos cuáles lanzan un agente, cuáles cargan un skill y cuáles son simplemente prompts de coordinación.
