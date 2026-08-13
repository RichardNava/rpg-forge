# Skills de OpenCode — Proyecto RPG

**Fase:** 7 — Skills  
**Estado:** Aprobada  
**Versión:** 0.1  
**Fecha:** 12 de agosto de 2026

## 1. Objetivo

Añadir conocimiento procedural reutilizable sin duplicar:

- `AGENTS.md`;
- documentación de producto/arquitectura;
- prompts de agentes especializados.

OpenCode descubre skills locales desde:

```text
.opencode/skills/<skill-name>/SKILL.md
```

y muestra a los agentes su nombre/description. El contenido completo se carga solo cuando el agente utiliza el tool `skill`.

## 2. Principio

```text
AGENTS.md
→ reglas permanentes

Agent
→ rol y límites de responsabilidad

Skill
→ procedimiento especializado reutilizable

Documentation
→ conocimiento detallado del proyecto

MCP
→ herramientas/datos externos
```

Un skill no debe convertirse en una segunda copia de `AGENTS.md`.

## 3. Skills propios activos

```text
.opencode/skills/
├── feature-development/
│   └── SKILL.md
├── rpg-frontend-style/
│   └── SKILL.md
└── ai-generation/
    └── SKILL.md
```

### `feature-development`

Procedimiento transversal para:

- delimitar una feature;
- comprobar MVP/premium;
- localizar ownership;
- definir contratos;
- construir un vertical slice;
- coordinar frontend/backend;
- elegir nivel de test;
- detectar necesidad de security review.

No sustituye a `/feature`, que se definirá en Fase 9. El futuro command podrá pedir explícitamente que se utilice este skill.

### `rpg-frontend-style`

Define cómo ejecutar la identidad visual del producto:

- pergamino;
- madera;
- tinta;
- cartografía;
- escritorio de DJ/escriba;

manteniendo:

- accesibilidad;
- legibilidad;
- responsive;
- jerarquía;
- reutilización de tokens/componentes.

Es más específico que un skill genérico de frontend design.

### `ai-generation`

Procedimiento común para:

- aventura;
- NPC;
- mapas;
- hojas;
- futuras generaciones.

Fija la secuencia:

```text
domain result
→ input schema
→ project-owned port
→ provider adapter
→ validated result
→ editable output
→ export
→ fake-provider tests
```

No autoriza RAG ni persistencia.

## 4. Skills externos activos

Tres skills externos han sido aprobados para instalación posterior.

### Cloudflare

```text
cloudflare
```

Fuente:

```text
cloudflare/skills
```

Mantenido por Cloudflare.

### React/Next.js

```text
vercel-react-best-practices
```

Fuente:

```text
vercel-labs/agent-skills
```

### Diseño web

```text
web-design-guidelines
```

Fuente:

```text
vercel-labs/agent-skills
```

Los comandos exactos están en:

```text
docs/opencode/external-skills.md
```

## 5. Skills diferidos

No se instalarán todavía:

```text
durable-objects
turnstile-spin
vercel-composition-patterns
```

Se incorporan únicamente al aparecer su caso de uso.

Esto respeta la regla del proyecto de no anticipar complejidad.

## 6. Por qué no creamos skills de QA y Security

### QA

El agente `qa` ya contiene el procedimiento exacto de testing del proyecto.

Un skill general de testing duplicaría su contexto.

### Security

El agente `security` ya está diseñado específicamente para:

- Better Auth;
- Workers AI;
- D1;
- R2;
- uploads;
- Durable Objects;
- WebSockets.

Preferimos esa revisión contextual a un skill genérico.

## 7. Permisos por agente

El acceso queda limitado explícitamente.

| Skill                       | Build | Plan | frontend | backend-db |  qa | security |
| --------------------------- | ----: | ---: | -------: | ---------: | --: | -------: |
| feature-development         |     ✓ |    ✓ |        ✓ |          ✓ |   — |        — |
| rpg-frontend-style          |     ✓ |    ✓ |        ✓ |          — |   — |        — |
| ai-generation               |     ✓ |    ✓ |        — |          ✓ |   — |        — |
| cloudflare                  |     ✓ |    ✓ |        — |          ✓ |   ✓ |        ✓ |
| vercel-react-best-practices |     ✓ |    ✓ |        ✓ |          — |   ✓ |        — |
| web-design-guidelines       |     ✓ |    ✓ |        ✓ |          — |   ✓ |        — |

`Explore` y `Scout` no necesitan cargar skills de proyecto; sirven como herramientas de exploración/investigación para el agente que los invoca.

## 8. Política global

`opencode.jsonc` cambia de:

```json
"skill": "allow"
```

a una política deny-by-default.

```text
global
→ deny skills

Build/Plan
→ explicit allow list

custom agents
→ own explicit allow list
```

Así un nuevo skill instalado no aparece automáticamente a todos los agentes.

## 9. Formato

Cada skill propio usa el formato oficial:

```yaml
---
name: lower-kebab-case
description: ...
compatibility: opencode
metadata:
  project: rpg-project
  scope: ...
---
```

El nombre coincide exactamente con el directorio.

No se añaden campos frontmatter inventados.

## 10. Instalación externa

Los skills externos se instalarán cuando exista el repositorio real.

Regla:

```text
local project install
not global install
```

Después de instalar:

1. revisar la ruta generada;
2. comprobar `SKILL.md`;
3. comprobar cualquier script incluido;
4. confirmar `npx skills list`;
5. abrir OpenCode y verificar que solo los agentes autorizados los ven.

## 11. Versionado de externos

Una vez revisados e instalados localmente, sus archivos se versionarán en Git.

No dependeremos de que skills.sh entregue siempre la misma versión en cada máquina.

Actualizaciones:

```text
check upstream
→ inspect diff
→ test
→ commit reviewed update
```

No:

```text
blind update all
```

## 12. Skills y documentación

Los skills pueden ordenar leer documentación relevante, pero no deben copiar documentos enteros.

Ejemplo:

```text
feature-development
→ read relevant product docs
→ apply workflow
```

Así la fuente de verdad sigue siendo `docs/`.

## 13. Skills y agents

Los agentes no deben cargar un skill en cada tarea por rutina.

Solo cuando su description coincida con el trabajo.

Ejemplos:

```text
"Implementa el generador de NPC"
→ feature-development
→ ai-generation
→ cloudflare if provider/runtime details needed

"Rediseña la pantalla del generador"
→ rpg-frontend-style
→ vercel-react-best-practices when relevant

"Audita accesibilidad"
→ web-design-guidelines
```

## 14. Skills y commands

Fase 9 podrá conectar workflows repetibles:

```text
/feature
→ feature-development

/security
→ @security

/test
→ @qa
```

Un command inicia el flujo; el skill aporta procedimiento.

## 15. Seguridad de skills externos

Un skill externo es parte de la cadena de suministro del agente.

Antes de instalarlo:

- revisar procedencia;
- revisar instrucciones;
- revisar scripts;
- revisar operaciones shell/red;
- revisar incompatibilidades con reglas locales.

Las instrucciones del repositorio tienen prioridad sobre un skill.

## 16. Próxima fase

**Fase 8 — MCP.**

Evaluaremos únicamente MCPs que aporten una capacidad que OpenCode no tenga ya de forma suficiente.

Candidatos a revisar:

```text
Context7
Cloudflare
GitHub
Playwright
```

No se instalarán MCP de filesystem, shell o Git si duplican herramientas nativas.
