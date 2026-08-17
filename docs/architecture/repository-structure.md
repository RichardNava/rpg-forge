# Estructura del repositorio — Proyecto OpenCode RPG

**Fase:** 4 — Estructura del repositorio/directorios  
**Estado:** Aprobada para configuración posterior de OpenCode y bootstrap  
**Versión:** 0.1  
**Fecha:** 12 de agosto de 2026

---

## 1. Objetivo

Definir una estructura de repositorio profesional que:

- refleje la arquitectura modular definida en Fase 1;
- soporte Next.js y el Worker realtime de La Mesa;
- permita compartir únicamente código que realmente lo necesite;
- facilite el trabajo de agentes de OpenCode;
- mantenga claras las fronteras entre dominio, infraestructura y UI;
- no cree código premium antes de tiempo;
- permita incorporar nuevas features sin degradar la organización;
- siga siendo comprensible sin introducir Turborepo ni microservicios innecesarios.

---

# 2. Decisión principal

Utilizaremos:

```text
1 repositorio Git
+
1 pnpm workspace
+
2 aplicaciones desplegables como máximo en el MVP
+
paquetes internos únicamente cuando exista código compartido real
```

Arquitectura física:

```text
Repository
│
├── apps/
│   ├── web/
│   └── realtime/          [cuando llegue La Mesa]
│
├── packages/
│   ├── dice-engine/       [implementado: Dados]
│   └── table-contracts/   [cuando llegue La Mesa]
│
├── docs/
├── tests/
└── OpenCode/configuración raíz
```

No utilizaremos Turborepo.

`pnpm` ya proporciona workspaces y enlaces entre paquetes locales, suficiente para este proyecto.

---

# 3. Por qué un workspace

Inicialmente podría parecer suficiente:

```text
src/
workers/
```

pero existen dos runtimes claramente diferentes:

```text
apps/web
→ Next.js + OpenNext

apps/realtime
→ Cloudflare Worker + Durable Objects
```

Además, existen dos piezas que deben ejecutarse en ambos contextos:

```text
dice-engine
table-contracts
```

Por tanto, `pnpm workspace` nos permite representar estas fronteras de forma explícita sin introducir herramientas de orquestación adicionales.

---

# 4. Estructura objetivo global

```text
rpg-project/
│
├── apps/
│   │
│   ├── web/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── features/
│   │   │   ├── core/
│   │   │   ├── infrastructure/
│   │   │   ├── shared/
│   │   │   └── config/
│   │   │
│   │   ├── drizzle/
│   │   ├── public/
│   │   ├── tests/
│   │   ├── drizzle.config.ts
│   │   ├── next.config.ts
│   │   ├── open-next.config.ts
│   │   ├── wrangler.jsonc
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── realtime/                         [DEFERRED: Table]
│       ├── src/
│       │   ├── index.ts
│       │   ├── table/
│       │   ├── security/
│       │   └── config/
│       ├── tests/
│       ├── wrangler.jsonc
│       ├── vitest.config.ts
│       ├── tsconfig.json
│       └── package.json
│
├── packages/
│   │
│   ├── dice-engine/                      [IMPLEMENTED: Dice]
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── index.test.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── table-contracts/                  [DEFERRED: Table]
│       ├── src/
│       ├── package.json
│       ├── tsconfig.json
│       └── vitest.config.ts
│
├── docs/
│   ├── product/
│   │   ├── vision.md
│   │   ├── mvp.md
│   │   └── feature-map.md
│   │
│   └── architecture/
│       ├── architecture.md
│       ├── stack.md
│       ├── data-model.md
│       ├── repository-structure.md
│       └── adr/
│
├── tests/
│   └── e2e/
│
├── .github/
│   └── workflows/
│
├── .opencode/                            [configurado en fases posteriores]
│   ├── agents/
│   ├── skills/
│   └── commands/
│
├── AGENTS.md                             [fase posterior]
├── opencode.jsonc                        [fase posterior]
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── package.json
├── tsconfig.base.json
├── eslint.config.mjs
├── prettier.config.mjs
├── .prettierignore
├── .editorconfig
├── .gitignore
├── .nvmrc
└── README.md
```

La estructura es **objetivo**, no una orden para crear todas las carpetas vacías durante el bootstrap.

---

# 5. Regla: no crear directorios vacíos preventivamente

OpenCode no deberá materializar todo el árbol en el primer commit.

Ejemplo:

```text
packages/table-contracts/
```

solo se crea cuando comience La Mesa.

```text
packages/dice-engine/
```

solo se crea cuando comience el motor de dados.

```text
infrastructure/storage/r2/
```

solo se crea cuando necesitemos R2.

## Regla

> Una carpeta existe cuando contiene una responsabilidad implementada, no para anticipar una feature futura.

La documentación describe el destino arquitectónico; el repositorio físico crece incrementalmente.

---

# 6. Raíz del repositorio

La raíz contiene únicamente configuración transversal.

```text
/
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── eslint.config.mjs
├── prettier.config.mjs
├── .editorconfig
├── .gitignore
├── .nvmrc
├── README.md
├── AGENTS.md
└── opencode.jsonc
```

No se colocará código de negocio en la raíz.

---

# 7. `pnpm-workspace.yaml`

Modelo objetivo:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Esto permite crear paquetes gradualmente sin modificar continuamente la configuración.

---

# 8. `package.json` raíz

El `package.json` raíz será `private`.

Responsabilidades:

- fijar pnpm;
- fijar Node;
- scripts transversales;
- devDependencies compartidas de tooling cuando proceda.

Ejemplo conceptual:

```json
{
  "private": true,
  "packageManager": "pnpm@<exact>",
  "engines": {
    "node": ">=24 <25"
  }
}
```

No contendrá dependencias de runtime específicas de features si pueden vivir en su workspace.

---

# 9. Scripts raíz

El objetivo será poder ejecutar:

```text
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
```

desde la raíz.

Los scripts raíz delegarán mediante filtros de pnpm.

No necesitaremos Turborepo para ello.

---

# 10. `apps/web`

Es la aplicación principal del producto.

Responsabilidades:

```text
routing
UI
generators
auth
exports
D1 access
Workers AI access
Table client
```

No contendrá la implementación del Durable Object.

---

# 11. Estructura interna de `apps/web/src`

```text
src/
├── app/
├── features/
├── core/
├── infrastructure/
├── shared/
└── config/
```

Cada directorio tiene una responsabilidad distinta.

---

# 12. `src/app`

`app/` pertenece exclusivamente al App Router de Next.js.

Contiene:

- rutas;
- layouts;
- loading/error boundaries;
- route handlers;
- metadata;
- composición de features.

No contiene lógica de negocio.

---

# 13. Route Groups

Usaremos Route Groups para organizar las grandes experiencias sin afectar las URLs.

Estructura conceptual:

```text
app/
│
├── (public)/
│   ├── page.tsx
│   ├── adventures/
│   │   └── page.tsx
│   ├── maps/
│   │   └── page.tsx
│   ├── npcs/
│   │   └── page.tsx
│   ├── character-sheets/
│   │   └── page.tsx
│   └── dice/
│       └── page.tsx
│
├── (auth)/
│   └── login/
│       └── page.tsx
│
├── (table)/
│   └── table/
│       ├── page.tsx
│       └── [tableId]/
│           └── page.tsx
│
├── api/
├── layout.tsx
├── error.tsx
└── not-found.tsx
```

Los nombres entre paréntesis no forman parte de la URL.

---

# 14. Qué significa `(public)`

No significa necesariamente contenido estático.

Significa:

> herramientas cuyo uso básico no requiere autenticación.

Incluye:

```text
Adventure Generator
Map Generator
NPC Generator
Character Sheet
Dice Roller
```

---

# 15. Qué significa `(table)`

Agrupa únicamente la UX de La Mesa.

```text
/table
/table/<tableId>
```

Estas rutas requieren autenticación.

El realtime pertenece exclusivamente a esta experiencia.

---

# 16. `app/api`

Contiene adaptadores HTTP de entrada.

Ejemplos futuros:

```text
api/
├── auth/
├── generations/
│   ├── adventure/
│   ├── map/
│   └── npc/
└── table/
```

## Regla

Un `route.ts`:

- valida HTTP;
- autentica si corresponde;
- llama a un use case;
- convierte el resultado a HTTP.

No contiene:

- prompts grandes;
- SQL;
- lógica de aventura;
- lógica de dados;
- llamadas directas dispersas al proveedor IA.

---

# 17. Server Actions

Cuando se utilicen Server Actions, tendrán la misma regla:

```text
delivery adapter
     ↓
application use case
```

No se convertirán en un lugar alternativo donde meter lógica de negocio.

---

# 18. `src/features`

Cada capacidad funcional vive en una feature.

Objetivo:

```text
features/
├── adventures/
├── maps/
├── npcs/
├── character-sheets/
├── dice/
├── auth/
└── table/
```

No todas existirán desde el bootstrap.

---

# 19. Plantilla de feature

Una feature compleja puede adoptar:

```text
features/adventures/
│
├── domain/
│   ├── adventure-draft.ts
│   └── adventure-types.ts
│
├── application/
│   └── generate-adventure.ts
│
├── schemas/
│   └── adventure-input.schema.ts
│
├── prompts/
│   └── adventure.prompt.ts
│
├── components/
│   ├── adventure-form.tsx
│   ├── adventure-editor.tsx
│   └── adventure-preview.tsx
│
└── index.ts
```

No es obligatorio crear todas esas carpetas si la feature todavía es pequeña.

---

# 20. Regla de complejidad de feature

No crear:

```text
domain/
application/
schemas/
components/
```

con un único archivo artificial en cada carpeta si la feature aún no lo justifica.

Se comienza simple y se separa cuando las responsabilidades aparecen.

La arquitectura exige fronteras, no burocracia.

---

# 21. `domain`

Contiene conceptos puros de la feature.

Ejemplos:

```text
AdventureDraft
NpcDraft
GeneratedMap metadata
```

No puede importar:

```text
React
Next.js
Cloudflare
Drizzle
Better Auth
Konva
```

---

# 22. `application`

Contiene casos de uso.

Ejemplo:

```text
GenerateAdventure
GenerateNpc
GenerateMap
```

Puede depender de interfaces/ports.

No debe conocer detalles del adaptador concreto.

---

# 23. `schemas`

Contiene validaciones Zod propias de la feature.

Ejemplos:

```text
AdventureInputSchema
NpcInputSchema
```

No se duplicará un schema en:

```text
client/
server/
api/
```

si el mismo contrato es válido para los tres.

---

# 24. `prompts`

Los prompts de negocio pertenecen a la feature que los utiliza.

Correcto:

```text
features/adventures/prompts/
```

Incorrecto:

```text
prompts/
  50 prompts de todas las features mezclados
```

Esto ayuda especialmente a los agentes de OpenCode a modificar una feature sin afectar a otras.

---

# 25. `components`

Contiene componentes específicos de la feature.

Ejemplo:

```text
AdventureForm
AdventureEditor
AdventurePreview
```

No deben trasladarse a `shared` simplemente porque se usan en dos archivos de la misma feature.

---

# 26. `index.ts` de feature

Puede actuar como interfaz pública.

Ejemplo:

```ts
export { AdventureGenerator } from "./components/adventure-generator";
```

## Regla

Los consumidores externos deberían importar desde el punto público de la feature cuando resulte práctico.

Evitar barrels profundos y circulares.

---

# 27. `features/dice`

La UI del lanzador vive en:

```text
apps/web/src/features/dice/
```

El motor no.

```text
UI
→ @repo/dice-engine
```

Así el mismo motor puede utilizarse desde:

```text
web standalone dice roller
+
realtime Durable Object
```

---

# 28. `features/table`

Contiene el cliente web de La Mesa.

Ejemplo futuro:

```text
features/table/
├── components/
│   ├── table-canvas.tsx
│   ├── table-toolbar.tsx
│   ├── token-layer.tsx
│   └── drawing-layer.tsx
│
├── state/
│   └── table-store.ts
│
├── realtime/
│   └── table-socket-client.ts
│
├── schemas/
└── index.ts
```

No contiene:

```text
Durable Object
SQLite del Durable Object
WebSocket server
```

Eso pertenece a `apps/realtime`.

---

# 29. `src/core`

`core/` contiene **contratos transversales de aplicación**, no infraestructura.

Objetivo:

```text
core/
├── ai/
│   ├── text-generation-port.ts
│   ├── image-generation-port.ts
│   └── generation-types.ts
│
├── export/
│   └── export-port.ts
│
├── storage/
│   └── storage-port.ts            [cuando sea necesario]
│
└── errors/
    └── application-errors.ts
```

---

# 30. Qué puede vivir en `core`

Solo conceptos compartidos por varias features que no pertenecen a ninguna tecnología concreta.

Ejemplo:

```ts
interface TextGenerationPort {}
```

Sí.

```ts
class CloudflareTextGenerator {}
```

No.

---

# 31. `src/infrastructure`

Contiene adaptadores tecnológicos.

Estructura objetivo progresiva:

```text
infrastructure/
├── ai/
│   └── cloudflare/
│
├── auth/
│   └── better-auth/
│
├── db/
│   ├── client/
│   ├── schema/
│   └── repositories/
│
├── export/
│   ├── react-pdf/
│   └── pdf-lib/
│
├── storage/
│   └── r2/                       [DEFERRED]
│
└── security/
    ├── turnstile/
    └── rate-limit/
```

Solo se crean las partes necesarias.

---

# 32. IA

Estructura futura:

```text
core/ai/
├── text-generation-port.ts
└── image-generation-port.ts

infrastructure/ai/cloudflare/
├── cloudflare-text-provider.ts
├── cloudflare-image-provider.ts
└── model-config.ts
```

Esto materializa la abstracción diseñada en fases anteriores.

---

# 33. Base de datos

En `apps/web`:

```text
infrastructure/db/
├── client/
│   └── d1.ts
├── schema/
│   └── auth.ts
└── repositories/

drizzle/
└── <migrations>
```

## Regla MVP

Al principio `schema/` contendrá únicamente lo requerido por Better Auth.

No se crearán archivos vacíos:

```text
campaign.ts
resource.ts
generation.ts
```

hasta que esas features existan.

---

# 34. Migraciones

Las migraciones viven fuera de `src`:

```text
apps/web/drizzle/
```

Motivo:

Son artefactos de infraestructura/versionado, no código de aplicación importable.

Nunca se editará una migración ya aplicada a producción para "arreglarla".

Se crea una migración nueva.

---

# 35. Auth

Estructura orientativa:

```text
infrastructure/auth/
├── auth.ts
├── auth-client.ts
└── auth-guards.ts
```

La UI específica puede vivir en:

```text
features/auth/
```

Esto separa:

```text
Better Auth implementation
≠
Login UI
```

---

# 36. `src/shared`

Código web reutilizable que no es lógica de dominio ni infraestructura.

```text
shared/
├── components/
│   ├── ui/
│   └── themed/
├── hooks/
├── utils/
└── types/
```

---

# 37. `shared/components/ui`

Contiene principalmente los componentes base gestionados/adaptados desde shadcn.

Ejemplos:

```text
button.tsx
dialog.tsx
input.tsx
select.tsx
textarea.tsx
```

No introducir lógica de aventura, mapas o Mesa.

---

# 38. `shared/components/themed`

Componentes visuales propios reutilizables.

Ejemplo:

```text
parchment-panel.tsx
wood-toolbar.tsx
scroll-card.tsx
ink-divider.tsx
```

Así mantenemos separada:

```text
primitive UI
vs.
RPG visual language
```

---

# 39. `shared/utils`

Solo utilidades verdaderamente genéricas.

Permitido:

```text
cn()
formatDate()
downloadBlob()
```

No permitido:

```text
generateAdventurePrompt()
calculateDiceRoll()
saveCampaign()
```

La carpeta `utils` no será un cajón de sastre.

---

# 40. `src/config`

Configuración validada de la aplicación.

Ejemplo:

```text
config/
├── env.server.ts
├── env.client.ts
├── ai.config.ts
└── app.config.ts
```

Variables de entorno se validarán.

No se accederá a `process.env` o bindings de forma arbitraria desde cualquier feature.

---

# 41. Dependencias permitidas dentro de `apps/web`

Dirección conceptual:

```text
app
 ↓
features
 ↓
core

app/features
 ↓
shared

composition root / server adapter
 ↓
infrastructure
```

La infraestructura implementa interfaces definidas por `core` o por los módulos de aplicación.

---

# 42. Dependencias prohibidas

Ejemplos:

```text
domain → infrastructure       ❌
domain → React                ❌
domain → Next.js              ❌
domain → Cloudflare           ❌

dice-engine → apps/web        ❌
table-contracts → Konva       ❌
table-contracts → Durable Object implementation ❌

shared → feature              ❌
```

---

# 43. Regla contra imports cruzados de features

No queremos:

```ts
features/adventures/
   import "../../npcs/components/npc-editor"
```

por defecto.

Si Adventures necesita información de NPC:

- usar un modelo/contrato compartido apropiado;
- componer features desde `app`;
- extraer código realmente compartido si existe una abstracción clara.

No crear dependencias circulares entre features.

---

# 44. Alias de imports

Dentro de `apps/web`:

```ts
@/features/...
@/core/...
@/infrastructure/...
@/shared/...
@/config/...
```

Paquetes del workspace:

```ts
@repo/dice-engine
@repo/table-contracts
```

`@repo` es un namespace interno provisional y puede cambiar al decidir el nombre definitivo del proyecto.

---

# 45. Nombres de archivos

Convención general:

```text
kebab-case.ts
kebab-case.tsx
```

Ejemplos:

```text
adventure-form.tsx
generate-adventure.ts
table-socket-client.ts
```

Exports React:

```ts
export function AdventureForm() {}
```

PascalCase para componentes/tipos/clases.

camelCase para funciones y variables.

---

# 46. Archivos especiales de Next.js

Se respetarán los nombres requeridos:

```text
page.tsx
layout.tsx
route.ts
loading.tsx
error.tsx
not-found.tsx
```

No se renombran para adaptarlos a nuestra convención.

---

# 47. Client Components

`"use client"` se añadirá solo en el límite que necesite:

- estado cliente;
- efectos;
- eventos;
- APIs de navegador.

No se propagará indiscriminadamente hacia arriba.

Ejemplo:

```text
page.tsx                  Server Component
   ↓
AdventureGenerator.tsx   Client Component
```

---

# 48. Código solo servidor

Código con:

- secrets;
- D1;
- Workers AI;
- Better Auth server;
- R2 privado;

debe permanecer fuera de bundles cliente.

La estructura y las revisiones de OpenCode deberán tratar esto como una restricción de seguridad.

---

# 49. `apps/realtime`

Cuando comience La Mesa:

```text
apps/realtime/
├── src/
│   ├── index.ts
│   ├── table/
│   │   ├── table-durable-object.ts
│   │   ├── handlers/
│   │   ├── state/
│   │   └── storage/
│   ├── security/
│   └── config/
├── tests/
├── wrangler.jsonc
├── vitest.config.ts
├── tsconfig.json
└── package.json
```

Es un Worker independiente.

---

# 50. `apps/realtime/src/index.ts`

Debe permanecer pequeño.

Responsabilidad:

```text
HTTP/WebSocket entry
   ↓
routing / Durable Object binding
```

No contendrá toda la lógica de La Mesa.

---

# 51. `table-durable-object.ts`

Es el coordinador de una Mesa.

Delega responsabilidades a:

```text
handlers/
state/
storage/
security/
```

El objetivo es evitar una clase Durable Object de miles de líneas.

---

# 52. `table/handlers`

Ejemplos futuros:

```text
handle-token-created.ts
handle-token-moved.ts
handle-drawing-created.ts
handle-dice-roll.ts
```

Cada handler:

- valida permisos/contexto;
- aplica la operación;
- actualiza estado cuando corresponda;
- genera evento canónico.

---

# 53. `table/storage`

Encapsula SQLite del Durable Object.

No se dispersarán sentencias SQL por los handlers.

Ejemplo:

```text
table-storage.ts
token-repository.ts
drawing-repository.ts
```

La granularidad definitiva se decidirá según tamaño real.

---

# 54. `packages/dice-engine`

Se crea cuando implementemos Dados.

```text
packages/dice-engine/
├── src/
│   ├── tokenizer.ts
│   ├── parser.ts
│   ├── ast.ts
│   ├── evaluator.ts
│   ├── rng.ts
│   ├── errors.ts
│   └── index.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

No depende de React ni Cloudflare.

---

# 55. Motivo de `dice-engine` como paquete

Se usa desde dos aplicaciones:

```text
apps/web
→ tiradas standalone

apps/realtime
→ tiradas autoritativas de La Mesa
```

Es una extracción justificada por reutilización entre runtimes.

---

# 56. `packages/table-contracts`

Solo se crea con La Mesa.

Contiene el protocolo compartido:

```text
packages/table-contracts/
├── src/
│   ├── events/
│   ├── commands/
│   ├── schemas/
│   ├── protocol-version.ts
│   └── index.ts
└── ...
```

Será consumido por:

```text
apps/web
apps/realtime
```

---

# 57. Qué NO contiene `table-contracts`

No contiene:

```text
Konva
Zustand store
Durable Objects
SQLite
R2
UI
```

Solo:

```text
messages
schemas
types
protocol version
```

---

# 58. Versionado del protocolo

El protocolo tendrá versión explícita.

Ejemplo:

```ts
export const TABLE_PROTOCOL_VERSION = 1;
```

Los mensajes incorporarán versión cuando sea necesaria para detectar clientes incompatibles.

---

# 59. `packages/` no es una papelera de código compartido

No se crearán paquetes genéricos:

```text
@repo/utils
@repo/types
@repo/common
@repo/shared
```

al inicio.

Estos nombres tienden a convertirse en dependencias globales sin fronteras.

Solo se crea un paquete cuando existe:

1. una responsabilidad definida;
2. consumo real por más de un workspace;
3. una API pública coherente.

---

# 60. Documentación

En el repositorio final:

```text
docs/
├── product/
│   ├── vision.md
│   ├── mvp.md
│   └── feature-map.md
│
└── architecture/
    ├── architecture.md
    ├── stack.md
    ├── data-model.md
    ├── repository-structure.md
    └── adr/
```

---

# 61. Los nombres de documentación serán estables

No usar en Git:

```text
01_VISION_PRODUCTO_v0.2.md
05_STACK_TECNOLOGICO_v0.1.md
```

Usar:

```text
vision.md
stack.md
```

La versión vive:

- dentro del documento;
- en commits;
- tags/releases cuando proceda.

## Motivo

`AGENTS.md` y `opencode.jsonc` podrán apuntar siempre a:

```text
docs/product/vision.md
```

sin actualizar referencias cada vez que cambie la versión.

---

# 62. ADRs

Los ADR conservan número estable:

```text
docs/architecture/adr/
├── 001-cloudflare-first.md
├── 002-nextjs-cloudflare-workers.md
...
└── 023-feature-first-boundaries.md
```

Una decisión reemplazada no se borra.

Se marca:

```text
Superseded
```

y se referencia el nuevo ADR.

Esto conserva el historial arquitectónico.

---

# 63. README

El README raíz será práctico y corto.

Debe contener:

```text
qué es el proyecto
estado actual
prerrequisitos
instalación
dev
tests
preview Cloudflare
estructura de alto nivel
enlace a docs/
```

No duplicará toda la documentación de arquitectura.

---

# 64. OpenCode

La configuración se ubicará en la raíz porque gobierna todo el workspace.

```text
AGENTS.md
opencode.jsonc

.opencode/
├── agents/
├── skills/
└── commands/
```

No habrá configuraciones independientes de OpenCode dentro de cada app salvo una necesidad futura demostrada.

---

# 65. AGENTS.md y documentación

Cuando llegue la fase correspondiente, `AGENTS.md` explicará:

```text
repository boundaries
allowed imports
testing commands
Cloudflare constraints
realtime scope
premium exclusions
```

Los documentos de producto/arquitectura permanecerán como fuentes ampliadas.

---

# 66. `.opencode/agents`

Futuro:

```text
frontend.md
backend-db.md
qa.md
security.md
```

Los agentes deberán recibir límites de escritura coherentes con esta estructura.

Ejemplo conceptual:

```text
frontend
→ apps/web/src/app
→ apps/web/src/features/*/components
→ apps/web/src/shared

backend-db
→ core
→ infrastructure
→ drizzle

qa
→ tests
→ *.test.*
```

Los permisos exactos se definirán en su fase.

---

# 67. Tests unitarios

Preferencia:

```text
archivo.ts
archivo.test.ts
```

cerca del código cuando es una prueba unitaria.

Ejemplo:

```text
parser.ts
parser.test.ts
```

Esto mejora localización y refactoring.

---

# 68. Tests de integración

Por app:

```text
apps/web/tests/integration/
apps/realtime/tests/integration/
```

Aquí viven tests que necesitan:

- workerd;
- D1;
- Durable Objects;
- bindings.

---

# 69. E2E

Los E2E viven en:

```text
/tests/e2e/
```

porque prueban el producto completo y pueden involucrar:

```text
apps/web
+
apps/realtime
```

Ejemplo:

```text
table-realtime.spec.ts
```

con dos contextos Playwright.

---

# 70. Fixtures

Los fixtures deben estar cerca de la suite que los utiliza.

Evitar un:

```text
fixtures/
```

global gigantesco.

Ejemplo:

```text
tests/e2e/fixtures/
```

o:

```text
features/adventures/test-fixtures/
```

solo cuando exista necesidad real.

---

# 71. Assets

Assets versionables de UI:

```text
apps/web/public/
├── textures/
├── illustrations/
├── icons/
└── fonts/          [solo si licencia y estrategia lo permiten]
```

Los nombres describen el contenido.

No almacenar ahí recursos subidos/generados por usuarios.

---

# 72. R2

No existe como carpeta de datos del repositorio.

Su adapter futuro:

```text
apps/web/src/infrastructure/storage/r2/
```

y su configuración:

```text
wrangler.jsonc
```

Los ficheros reales están en Cloudflare, no en Git.

---

# 73. Configuración de Cloudflare

Cada deployable tiene su configuración propia.

```text
apps/web/wrangler.jsonc
apps/realtime/wrangler.jsonc
```

Esto refleja que son Workers independientes.

No habrá un `wrangler.jsonc` único con responsabilidades mezcladas.

---

# 74. Desarrollo multi-Worker

Cuando exista `apps/realtime`, ambos Workers podrán desarrollarse de forma independiente.

```text
Terminal A
→ apps/web

Terminal B
→ apps/realtime
```

Cloudflare soporta desarrollo local de varios Workers y Service Bindings.

Si necesitamos comunicación Worker-to-Worker, preferiremos un Service Binding frente a convertir una comunicación interna en una API pública.

---

# 75. Variables y secrets

Cada aplicación declara únicamente lo que necesita.

Ejemplo:

```text
apps/web
→ D1
→ AI
→ Turnstile
→ auth secrets

apps/realtime
→ Durable Objects
→ R2 temp
→ realtime signing/verification config
```

No compartir todos los secrets con todos los Workers.

---

# 76. `.env` local

Los archivos reales locales:

```text
.dev.vars
.env.local
```

según herramienta y runtime, estarán ignorados por Git.

El repositorio podrá incluir ejemplos sin secretos:

```text
.env.example
```

solo cuando resulte útil.

---

# 77. Configuración TypeScript

Raíz:

```text
tsconfig.base.json
```

Cada workspace extiende lo necesario.

No intentaremos forzar una configuración idéntica a Next.js y al Worker realtime si tienen necesidades diferentes.

---

# 78. ESLint y Prettier

Configuración base en raíz para consistencia.

Cada app podrá extender/ajustar reglas solo cuando el framework lo requiera.

Evitar múltiples configuraciones contradictorias.

---

# 79. CI

Estructura:

```text
.github/workflows/
├── ci.yml
└── deploy.yml       [si finalmente necesitamos workflow propio]
```

Si Cloudflare Workers Builds gestiona el despliegue directamente, `deploy.yml` puede no ser necesario.

No se crea por anticipado.

---

# 80. Imports entre workspaces

Utilizar el protocolo workspace de pnpm.

Ejemplo conceptual en `apps/web/package.json`:

```json
{
  "dependencies": {
    "@repo/dice-engine": "workspace:*"
  }
}
```

Esto impide resolver accidentalmente un paquete remoto del mismo nombre.

---

# 81. Grafo esperado del MVP

```text
                     ┌───────────────┐
                     │  apps/web     │
                     └───────┬───────┘
                             │
                  ┌──────────┴──────────┐
                  ▼                     ▼
        @repo/dice-engine    @repo/table-contracts
                  ▲                     ▲
                  │                     │
                  │             ┌───────┴────────┐
                  │             │ apps/realtime  │
                  └─────────────┤                │
                                └────────────────┘
```

No existe dependencia:

```text
apps/realtime → apps/web
apps/web → apps/realtime source code
```

La comunicación entre aplicaciones ocurre por protocolo/red/bindings, no mediante imports de su implementación.

---

# 82. Prohibición de dependencia circular

Grafo permitido:

```text
apps → packages
```

No:

```text
packages → apps
```

Ni:

```text
package A ↔ package B
```

si podemos evitarlo.

Las dependencias deberán formar un DAG comprensible.

---

# 83. Qué se crea en el bootstrap inicial

Mínimo:

```text
/
├── apps/
│   └── web/
├── docs/
├── .github/              [cuando configuremos CI]
├── .opencode/            [cuando configuremos OpenCode]
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── eslint.config.mjs
├── prettier.config.mjs
├── .editorconfig
├── .gitignore
├── .nvmrc
└── README.md
```

Puede que `.github` y `.opencode` se creen antes del bootstrap de código en sus fases específicas.

---

# 84. Qué NO se crea en el bootstrap inicial

```text
apps/realtime
packages/dice-engine
packages/table-contracts
R2 adapters
campaign features
resource library
premium
lore
RAG
payment
```

Se crean en la fase funcional correspondiente.

---

# 85. Secuencia de crecimiento físico

```text
Bootstrap
│
├── apps/web
│
└── docs/OpenCode config
        ↓
Dice
│
└── packages/dice-engine
        ↓
Auth/DB
│
└── web infrastructure/auth + db
        ↓
Table
│
├── apps/realtime
├── packages/table-contracts
└── web features/table
        ↓
Temporary map sharing
│
└── infrastructure/storage/r2
        ↓
Premium
  campaigns/resources/etc.
```

---

# 86. Ventaja para OpenCode

Con esta estructura, una petición:

```text
"mejora el formulario de aventuras"
```

debería concentrarse en:

```text
apps/web/src/features/adventures
```

Una petición:

```text
"corrige el parser de 4d6kh3"
```

en:

```text
packages/dice-engine
```

Y:

```text
"corrige la sincronización de tokens"
```

en:

```text
apps/web/src/features/table
packages/table-contracts
apps/realtime/src/table
```

Esto reduce el riesgo de modificaciones innecesarias en todo el repositorio.

---

# 87. Regla para agentes: inspeccionar antes de crear

Antes de crear:

```text
new util
new component
new schema
new package
```

el agente deberá buscar si ya existe una responsabilidad equivalente.

Objetivo:

- evitar duplicados;
- reutilizar componentes;
- mantener API coherente.

Esta regla se incorporará posteriormente a `AGENTS.md`.

---

# 88. Regla para agentes: modificación mínima

Una tarea de una feature no autoriza refactors globales no solicitados.

Ejemplo:

```text
Task: add field to NPC generator
```

No autoriza:

```text
rename every folder
replace validation library
rewrite UI primitives
```

Los cambios arquitectónicos amplios requieren decisión explícita.

---

# 89. Regla para agentes: documentación futura no es implementación actual

La existencia de:

```text
docs/architecture/data-model.md
```

con entidades premium futuras no autoriza crear carpetas:

```text
features/campaigns
features/library
```

si la fase actual no las requiere.

Esta regla será permanente en `AGENTS.md`.

---

# 90. Estructura documental estable para OpenCode

Cuando configuremos instrucciones, podrán apuntar a rutas estables:

```text
AGENTS.md
docs/product/*.md
docs/architecture/*.md
```

Los ADR podrán consultarse bajo demanda cuando una decisión específica lo requiera.

No será necesario renombrar instrucciones por cada revisión documental.

---

# 91. ADR resultantes

| ADR     | Decisión                                                      |
| ------- | ------------------------------------------------------------- |
| ADR-020 | pnpm workspace sin Turborepo                                  |
| ADR-021 | `apps/web` y `apps/realtime` como deployables separados       |
| ADR-022 | paquetes internos solo para reutilización real entre runtimes |
| ADR-023 | organización feature-first + core/infrastructure/shared       |
| ADR-024 | rutas estables para documentación y ADRs                      |

---

# 92. Próxima fase

Según el roadmap acordado:

**Fase 5 — Configuración base de OpenCode.**

A partir de esta estructura podremos diseñar:

```text
AGENTS.md
opencode.jsonc
instructions
permissions
```

sin ambigüedad sobre las fronteras del repositorio.

Después:

```text
Fase 6 — agentes
Fase 7 — skills
Fase 8 — MCP
Fase 9 — commands
Fase 10 — bootstrap
```

---

# 93. Referencias técnicas verificadas

- Next.js — Project Structure:
  https://nextjs.org/docs/app/getting-started/project-structure

- Next.js — `src` directory:
  https://nextjs.org/docs/app/api-reference/file-conventions/src-folder

- Next.js — Route Groups:
  https://nextjs.org/docs/app/api-reference/file-conventions/route-groups

- pnpm — Workspaces:
  https://pnpm.io/workspaces

- Cloudflare — Developing with multiple Workers:
  https://developers.cloudflare.com/workers/local-development/multi-workers/

- Cloudflare — Service Bindings:
  https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/

- Cloudflare — Wrangler configuration:
  https://developers.cloudflare.com/workers/wrangler/configuration/

Estas fuentes deben revisarse nuevamente durante el bootstrap si se han publicado cambios incompatibles.
