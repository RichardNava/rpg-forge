# Stack tecnológico definitivo — Proyecto OpenCode RPG

**Fase:** 2 — Stack tecnológico  
**Estado:** Aprobado para bootstrap  
**Versión:** 0.1  
**Fecha:** 12 de agosto de 2026

---

## 1. Objetivo

Cerrar las tecnologías concretas con las que se construirá el MVP, respetando las decisiones de arquitectura de Fase 1:

- coste inicial cero o free tier;
- Cloudflare-first;
- Next.js full-stack;
- monolito modular;
- generadores individuales;
- La Mesa como único módulo multiusuario/realtime del MVP;
- IA desacoplada del proveedor;
- persistencia mínima;
- código preparado para evolución premium.

Esta fase define herramientas y librerías. La estructura final de carpetas y convenciones de OpenCode se cerrarán en fases posteriores.

---

# 2. Política de versiones

Las versiones no se dejarán abiertas de forma indiscriminada.

## Regla

En el bootstrap:

1. se comprobará la última versión estable compatible;
2. se instalará una versión exacta;
3. `pnpm-lock.yaml` se versionará;
4. el campo `packageManager` fijará la versión de pnpm;
5. las dependencias críticas no se actualizarán automáticamente sin tests.

La documentación usa rangos de major/minor porque puede haber nuevos parches entre esta fase y el bootstrap.

---

# 3. Runtime y package manager

| Elemento           | Decisión                                                          |
| ------------------ | ----------------------------------------------------------------- |
| Node.js local      | **Node.js 24 LTS**                                                |
| Package manager    | **pnpm 11.x**                                                     |
| Runtime producción | **Cloudflare workerd**                                            |
| CLI Cloudflare     | **Wrangler latest compatible, fijado al bootstrap**               |
| Adaptador Next.js  | **@opennextjs/cloudflare latest compatible, fijado al bootstrap** |

## Motivos

Node.js 24 es LTS y tendrá soporte hasta 2028.

pnpm ofrece instalaciones deterministas, lockfile y buen control de dependencias.

Producción no ejecutará Node.js como servidor tradicional: el objetivo real es Cloudflare Workers/workerd.

## Regla de compatibilidad

El hecho de que una dependencia funcione con `next dev` no implica que esté aprobada.

Toda dependencia de servidor debe ser compatible con:

```text
Next.js
+
OpenNext
+
Cloudflare Workers
+
workerd
```

---

# 4. Framework web

| Elemento           | Decisión                                 |
| ------------------ | ---------------------------------------- |
| Framework          | **Next.js 16.x**                         |
| Router             | **App Router**                           |
| React              | versión estable requerida por Next.js 16 |
| Lenguaje           | **TypeScript**                           |
| Bundler desarrollo | **Turbopack**                            |
| Hosting            | **Cloudflare Workers**                   |
| Adapter            | **OpenNext Cloudflare**                  |

Next.js 16 es la línea principal que utilizaremos mientras OpenNext mantenga soporte completo.

No se utilizará Pages Router.

---

# 5. TypeScript

TypeScript será estricto.

Configuración objetivo:

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
  },
}
```

Se evitará:

```ts
any;
```

salvo aislamiento explícito de una API externa imposible de tipar, acompañado de comentario y validación.

## Regla

Los tipos obtenidos desde datos externos no se consideran confiables hasta pasar por validación runtime.

---

# 6. UI y diseño

| Elemento            | Decisión                                   |
| ------------------- | ------------------------------------------ |
| CSS                 | **Tailwind CSS 4.x**                       |
| Componentes         | **shadcn/ui CLI v4**                       |
| Base de componentes | **Base UI**                                |
| Iconos              | **Lucide React**                           |
| Tema                | variables CSS + design tokens              |
| Tipografía          | fuentes web/locales de licencia compatible |

## Motivo

shadcn/ui entrega el código de los componentes al proyecto, lo que permite adaptar de forma profunda la estética RPG sin quedar encerrados en una librería visual cerrada.

Base UI será la base inicial para los nuevos componentes de shadcn.

## Diseño

No se construirá el aspecto visual utilizando cientos de valores Tailwind arbitrarios.

Se definirán tokens:

```text
--color-wood-*
--color-parchment-*
--color-ink-*
--color-leather-*
--color-sepia-*
--color-charcoal-*

--radius-*
--shadow-*
--space-*
```

Los componentes temáticos deberán componerse sobre los componentes UI base.

Ejemplo:

```text
Button
Card
Dialog
Input
Textarea
Select

        ↓

ParchmentPanel
WoodToolbar
MapFrame
ScrollCard
DiceButton
```

---

# 7. Formularios

| Elemento                 | Decisión                |
| ------------------------ | ----------------------- |
| Formularios interactivos | **React Hook Form**     |
| Validación               | **Zod 4.x**             |
| Integración              | **@hookform/resolvers** |

## Regla

Un mismo schema Zod se reutilizará siempre que sea posible:

```text
UI validation
      ↓
Zod schema
      ↓
Server validation
      ↓
Use case
```

Nunca se confiará únicamente en la validación de React Hook Form.

Todos los datos externos se validan nuevamente en servidor.

---

# 8. Validación runtime y contratos

**Zod 4** será la librería estándar del proyecto para:

- formularios;
- endpoints HTTP;
- eventos WebSocket;
- configuración;
- resultados estructurados de IA;
- metadatos de recursos;
- inputs de upload.

También se utilizará para derivar tipos TypeScript mediante inferencia.

No se mantendrán manualmente un tipo y un schema duplicados si pueden derivarse de una única definición.

---

# 9. Base de datos

| Elemento          | Decisión                                        |
| ----------------- | ----------------------------------------------- |
| Base de datos     | **Cloudflare D1**                               |
| ORM/query builder | **Drizzle ORM — última versión estable, no RC** |
| Migraciones       | **Drizzle Kit — última versión estable**        |
| Dialecto          | SQLite/D1                                       |

## Regla importante

En agosto de 2026 Drizzle está publicitando una futura línea 1.0 RC.

No utilizaremos una release candidate en el bootstrap salvo que antes de comenzar haya pasado a GA estable y supere las pruebas de compatibilidad.

## Uso

Drizzle se utilizará para:

- schemas;
- consultas de aplicación;
- índices;
- migraciones;
- seeds.

No se introducirá Prisma.

---

# 10. Autenticación

| Elemento       | Decisión                     |
| -------------- | ---------------------------- |
| Auth           | **Better Auth 1.5+ estable** |
| Persistencia   | D1                           |
| Integración DB | **Drizzle adapter**          |
| Framework      | integración Next.js          |

## Motivo del Drizzle adapter

Aunque Better Auth puede trabajar directamente con D1, utilizaremos el adaptador Drizzle para mantener una estrategia coherente de schema/migraciones en el proyecto.

Better Auth puede generar su schema para Drizzle.

## Login durante beta

El motor queda decidido, pero el método exacto de entrada no bloquea el stack.

La opción preferida para la beta será:

```text
Google OAuth
```

porque evita necesitar inicialmente un proveedor de correo para:

- verificación;
- recuperación de contraseña;
- emails transaccionales.

El soporte de email/password podrá añadirse posteriormente sin cambiar el motor de autenticación.

---

# 11. IA

| Elemento            | Decisión                      |
| ------------------- | ----------------------------- |
| Proveedor MVP       | **Cloudflare Workers AI**     |
| Integración inicial | **Workers AI binding nativo** |
| Abstracción propia  | Sí                            |
| Vercel AI SDK       | **No obligatorio en MVP**     |

## Motivo

La abstracción principal será nuestra:

```text
TextGenerationPort
ImageGenerationPort
```

Por tanto, no necesitamos introducir una segunda abstracción obligatoria para comenzar.

Cloudflare se invocará desde el adapter mediante:

```ts
env.AI.run(...)
```

Si posteriormente Vercel AI SDK aporta valor real en:

- streaming;
- tool calling;
- structured output;
- routing multi-provider;

podrá utilizarse **dentro de los adaptadores**, sin cambiar las features.

---

# 12. Modelos IA iniciales

Los nombres de modelo **no se codificarán directamente dentro de las features**.

Configuración:

```text
AI_TEXT_MODEL
AI_IMAGE_MODEL
```

## Texto inicial recomendado

```text
@cf/meta/llama-3.1-8b-instruct-fast
```

Motivo: modelo relativamente ligero y adecuado para pruebas dentro de la cuota gratuita.

Para comparar calidad manualmente se podrá probar:

```text
@cf/meta/llama-3.3-70b-instruct-fp8-fast
```

pero no será el modelo por defecto debido a su mayor consumo.

## Imagen inicial recomendada

```text
@cf/black-forest-labs/flux-1-schnell
```

Será el punto de partida para:

- mapas;
- estilo pergamino;
- sepia;
- tinta;
- lápiz;
- cartografía fantástica.

## Regla

Cambiar el modelo no debe requerir modificar:

```text
Adventure Generator
Map Generator
NPC Generator
```

---

# 13. Estado cliente

## Aplicación general

No habrá store global por defecto.

Orden:

```text
React local state
     ↓
URL state
     ↓
Server state
     ↓
global store only if justified
```

No se utilizará Redux.

## La Mesa

Se utilizará:

```text
Zustand
```

exclusivamente para el estado interactivo del cliente de La Mesa.

Ejemplos:

- viewport;
- tool activa;
- selección;
- estado local optimista;
- tokens renderizados;
- drawings;
- conexión;
- snapshot recibido.

El servidor seguirá siendo la fuente de verdad del estado compartido.

---

# 14. Canvas de La Mesa

| Elemento          | Decisión        |
| ----------------- | --------------- |
| Canvas            | **Konva**       |
| Integración React | **react-konva** |

## Motivo

El MVP necesita:

- imagen de fondo;
- grid;
- layers;
- tokens;
- drag & drop;
- líneas;
- flechas;
- formas;
- eventos de ratón/touch;
- exportación de canvas futura.

Konva cubre directamente estos elementos y dispone de bindings React.

## Regla Next.js

La Mesa será un módulo cliente.

`react-konva` no se cargará en rutas que no utilicen La Mesa.

Se utilizará carga dinámica/client-only cuando resulte necesario.

---

# 15. Tiempo real

| Elemento             | Decisión             |
| -------------------- | -------------------- |
| Transporte           | **WebSocket nativo** |
| Servidor             | Cloudflare Worker    |
| Coordinador          | Durable Object       |
| Validación protocolo | Zod 4                |
| Cliente state        | Zustand              |

No se utilizará:

```text
Socket.IO
Pusher
Ably
Firebase Realtime
Supabase Realtime
```

porque Durable Objects + WebSocket nativo ya cubren la necesidad del MVP.

## Regla de alcance

**La Mesa es el único módulo realtime del MVP.**

---

# 16. Protocolo de La Mesa

Se definirá un paquete/módulo de contratos compartidos.

Ejemplo:

```ts
const TokenMoved = z.object({
  type: z.literal("token.moved"),
  version: z.literal(1),
  payload: z.object({
    tokenId: z.string(),
    x: z.number(),
    y: z.number(),
  }),
});
```

El protocolo no dependerá de Konva.

Correcto:

```text
WebSocket event
    ↓
domain data
    ↓
Zustand
    ↓
Konva rendering
```

Incorrecto:

```text
WebSocket
    ↓
serialized Konva node
```

Esto evita acoplar el protocolo realtime al canvas.

---

# 17. PDFs y exportación

Existirán dos necesidades distintas.

## Documentos de texto

Para aventuras, NPC y otros documentos maquetados:

```text
@react-pdf/renderer
```

Ventajas:

- PDF generado desde componentes React específicos;
- layout multipágina;
- estilos;
- imágenes;
- generación en navegador;
- componentes reutilizables.

## Hojas de personaje

Para PDFs potencialmente rellenables:

```text
pdf-lib
```

`pdf-lib` permite crear/modificar PDFs y trabajar con formularios PDF/AcroForms.

Esto permite evolucionar la hoja hacia campos rellenables desde Acrobat y programas compatibles.

## Markdown

No requiere librería de generación.

Se construirá a partir del modelo de dominio y se descargará como Blob.

---

# 18. JPG

## Mapas generados

Workers AI devuelve la imagen y el navegador la descarga como JPG.

## Hojas

La exportación JPG no es prioritaria frente al PDF.

Si se mantiene en el MVP, se realizará desde un render/canvas específico en cliente.

No se añadirá una librería pesada exclusivamente para esta función hasta implementarla.

---

# 19. Editor de contenido generado

No se instalará inicialmente un editor WYSIWYG.

Los recursos generados tendrán datos estructurados:

```text
AdventureDraft
NpcDraft
ScenarioDraft
```

La edición se realizará mediante:

- Input;
- Textarea;
- secciones;
- listas;
- controles específicos.

Esto facilita:

- validación;
- regeneración parcial futura;
- Markdown;
- PDF;
- persistencia.

No se almacenará el documento como un gran HTML opaco.

---

# 20. Testing

El stack de tests será:

| Nivel             | Tecnología                          |
| ----------------- | ----------------------------------- |
| Unit/domain       | **Vitest 4.1+**                     |
| Componentes React | **React Testing Library**           |
| Workers/D1        | **@cloudflare/vitest-pool-workers** |
| Durable Objects   | **@cloudflare/vitest-pool-workers** |
| E2E               | **Playwright**                      |

Cloudflare recomienda actualmente su integración oficial de Vitest para Workers.

## Separación de suites

```text
test:unit
test:component
test:workers
test:e2e
```

## IA

Los tests normales utilizarán:

```text
FakeTextGenerationProvider
FakeImageGenerationProvider
```

No consumirán Workers AI.

La integración real con modelos será una suite explícita/manual.

---

# 21. Playwright

Playwright cubrirá flujos críticos completos.

Ejemplos:

```text
guest → generate adventure → edit → download
guest → generate map → download
guest → roll dice

user A → create Table
user B → join Table
user A → move token
user B → sees token move
user B → rolls dice
user A → sees roll
```

Para La Mesa se utilizarán contextos/navegadores independientes representando varios usuarios.

---

# 22. Lint y formato

## Lint

```text
ESLint
eslint-config-next
```

Se utilizará la configuración Flat Config correspondiente a Next.js 16.

## Formato

```text
Prettier
prettier-plugin-tailwindcss
eslint-config-prettier
```

El plugin oficial de Tailwind ordenará las clases de forma consistente.

## Comprobación de tipos

```text
tsc --noEmit
```

Será una comprobación independiente.

---

# 23. Quality gates

Antes de considerar una feature terminada deberá pasar:

```text
format check
   ↓
lint
   ↓
typecheck
   ↓
unit tests
   ↓
relevant integration tests
   ↓
build
```

Para cambios críticos:

```text
Playwright E2E
Cloudflare preview
```

No bastará con que `next dev` funcione.

---

# 24. Scripts objetivo

El `package.json` terminará exponiendo como mínimo algo parecido a:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview",
    "deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  }
}
```

Los comandos exactos se validarán contra la versión de OpenNext instalada durante el bootstrap.

---

# 25. Desarrollo Cloudflare

Herramientas:

```text
Wrangler
OpenNext Cloudflare
wrangler types
```

Se mantendrán bindings tipados para:

```text
D1
AI
Durable Objects
R2 [future]
```

La configuración Cloudflare vivirá en:

```text
wrangler.jsonc
```

y se versionará.

Los secretos nunca se versionarán.

---

# 26. CI/CD

## Repositorio

GitHub privado.

## CI

GitHub Actions ejecutará:

```text
install
format:check
lint
typecheck
tests
build
```

en pull requests y/o pushes relevantes.

## Deploy

Para la primera beta se podrá utilizar **Cloudflare Workers Builds conectado a GitHub** para desplegar automáticamente la rama de producción.

Separaremos conceptualmente:

```text
CI quality gates
        ↓
deploy
```

No se permitirá desplegar una rama que no haya superado las comprobaciones definidas.

---

# 27. Imágenes y assets de interfaz

Los assets decorativos propios se servirán como archivos estáticos siempre que sea posible.

No utilizaremos R2 para:

- backgrounds pequeños;
- iconos;
- texturas del producto;
- elementos de interfaz versionables.

R2 se reserva para contenido generado/subido por usuarios cuando llegue esa fase.

---

# 28. Markdown

El formato interno de aventuras no será Markdown.

El dominio se mantendrá estructurado.

Ejemplo:

```ts
AdventureDraft;
```

y un exporter realizará:

```text
AdventureDraft
     ↓
MarkdownExporter
     ↓
.md
```

Esto evita convertir Markdown en la base de datos lógica del producto.

---

# 29. Seguridad del frontend

No se utilizará `dangerouslySetInnerHTML` para mostrar contenido IA salvo un caso explícitamente justificado y sanitizado.

Los resultados generados se renderizarán desde estructuras tipadas.

Los recursos externos no podrán ejecutar scripts.

SVG subido por usuarios quedará fuera del MVP inicialmente.

---

# 30. Dependencias que NO se utilizarán inicialmente

```text
Redux
TanStack Query
Socket.IO
Prisma
Supabase SDK
Firebase
GraphQL
tRPC
Redis
RabbitMQ
TipTap
Lexical
Slate
Three.js
PixiJS
Fabric.js
Vercel AI SDK como dependencia obligatoria
Sentry
Stripe
Vector database
RAG framework
```

Que una herramienta esté excluida ahora no significa que esté prohibida para siempre.

Solo se incorporará si aparece un caso de uso que justifique su coste cognitivo y técnico.

---

# 31. Stack consolidado

```text
DEVELOPMENT
Node.js 24 LTS
pnpm 11
TypeScript strict

WEB
Next.js 16
React
App Router
Turbopack

UI
Tailwind CSS 4
shadcn/ui v4
Base UI
Lucide

FORMS / CONTRACTS
React Hook Form
Zod 4

DATABASE
Cloudflare D1
Drizzle ORM
Drizzle Kit

AUTH
Better Auth

AI
Workers AI
own AI ports/adapters

TEXT PDF
@react-pdf/renderer

FILLABLE PDF
pdf-lib

TABLE CLIENT
react-konva
Konva
Zustand

REALTIME
Native WebSocket
Cloudflare Durable Objects

TEST
Vitest 4
React Testing Library
Cloudflare Vitest Pool
Playwright

QUALITY
ESLint
Prettier
Tailwind Prettier plugin
tsc

DEPLOY
OpenNext Cloudflare
Wrangler
Cloudflare Workers
GitHub
```

---

# 32. Dependencias diferidas

Se instalarán cuando llegue su feature, no durante el bootstrap inicial.

## Fase La Mesa

```text
konva
react-konva
zustand
```

## Fase PDF

```text
@react-pdf/renderer
pdf-lib
```

## Fase Auth/DB

```text
better-auth
@better-auth/drizzle-adapter
drizzle-orm
drizzle-kit
```

## Motivo

No queremos un `package.json` lleno de dependencias que todavía no se utilizan.

---

# 33. ADR resultantes

| ADR     | Decisión                                              |
| ------- | ----------------------------------------------------- |
| ADR-008 | Node.js 24 LTS + pnpm                                 |
| ADR-009 | Next.js 16 + Tailwind 4 + shadcn/Base UI              |
| ADR-010 | React Hook Form + Zod 4                               |
| ADR-011 | D1 + Drizzle + Better Auth                            |
| ADR-012 | Workers AI binding + abstracción propia               |
| ADR-013 | react-konva + Zustand + WebSocket nativo para La Mesa |
| ADR-014 | Vitest + Cloudflare Vitest + RTL + Playwright         |
| ADR-015 | React PDF + pdf-lib para exportación                  |

---

# 34. Puntos que quedan deliberadamente abiertos

No bloquean la siguiente fase:

### Nombre del producto

Todavía provisional.

### Login definitivo

Better Auth está decidido; Google OAuth es la primera opción de beta, pero podremos decidir la UX exacta al implementar autenticación.

### Modelo IA definitivo

Los modelos se configurarán externamente y podrán cambiar durante pruebas de calidad/coste.

### Fuente tipográfica y assets

Se decidirán al crear el sistema visual.

### JPG de hoja de personaje

Se confirmará cuando diseñemos la primera plantilla.

---

# 35. Próxima fase

La siguiente fase del roadmap es:

**Fase 3 — Modelo de datos.**

Antes de escribir el schema D1 definitivo habrá que separar claramente:

```text
datos persistentes del MVP
vs.
datos efímeros
vs.
datos premium futuros
```

y modelar:

```text
User
Account
Session
TableSession metadata
Entitlements
```

dejando preparados, pero sin implementar todavía:

```text
Campaign
Resource
Generation
SavedTable
```

---

# 36. Referencias verificadas

## Next.js / Cloudflare

- https://nextjs.org/docs/app/getting-started/installation
- https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/
- https://opennext.js.org/cloudflare
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/

## Node / pnpm

- https://nodejs.org/en/about/previous-releases
- https://pnpm.io/installation

## UI

- https://tailwindcss.com/docs/guides/nextjs
- https://ui.shadcn.com/docs/installation/next
- https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default
- https://tailwindcss.com/docs/editor-setup

## DB / Auth

- https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1
- https://better-auth.com/docs/adapters/drizzle
- https://better-auth.com/blog/1-5

## IA

- https://developers.cloudflare.com/workers-ai/configuration/bindings/
- https://developers.cloudflare.com/workers-ai/models/
- https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/

## Canvas

- https://konvajs.org/docs/react/index.html
- https://konvajs.org/docs/react/Free_Drawing.html
- https://zustand.docs.pmnd.rs/

## PDF

- https://react-pdf.org/
- https://pdf-lib.js.org/
- https://pdf-lib.js.org/docs/api/classes/pdfform

## Testing

- https://vitest.dev/guide/
- https://developers.cloudflare.com/workers/testing/vitest-integration/
- https://developers.cloudflare.com/durable-objects/examples/testing-with-durable-objects/
- https://testing-library.com/docs/react-testing-library/intro/
- https://playwright.dev/docs/intro

## CI/CD

- https://developers.cloudflare.com/workers/ci-cd/builds/
- https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/
