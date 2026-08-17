# Mapa de Funcionalidades — Proyecto OpenCode RPG

**Estado:** Conceptual / Fase 0  
**Versión:** 0.2  
**Fecha:** 12 de agosto de 2026

## 1. Mapa global

```text
OpenCode RPG
│
├── Generators
│   ├── Adventures
│   ├── Maps
│   ├── NPCs
│   └── Character Sheets
│
├── Tools
│   ├── Dice Roller
│   └── Table
│
├── Identity
│   ├── Guest
│   ├── Registered Free
│   └── Premium [future]
│
├── Library [future]
│   ├── Adventures
│   ├── Maps
│   ├── NPCs
│   ├── Characters
│   └── Resources
│
├── Campaigns [future]
│   ├── Resources
│   ├── Lore / Context
│   ├── Sessions
│   ├── Participants
│   └── History
│
└── AI
    ├── Text Generation
    ├── Image Generation
    ├── Provider Abstraction
    ├── Lore Packs [future]
    ├── User Sources [future]
    └── Campaign Context [future]
```

## 2. Matriz de acceso

| Funcionalidad                                   | Invitado | Registrado gratis |    Premium futuro |
| ----------------------------------------------- | -------: | ----------------: | ----------------: |
| Generar aventura                                |       Sí |                Sí |                Sí |
| Editar/descargar                                |       Sí |                Sí |                Sí |
| Generar mapa                                    |       Sí |                Sí |                Sí |
| Generar NPC/hoja                                |       Sí |                Sí |                Sí |
| Dados                                           |       Sí |                Sí |                Sí |
| Crear/Unirse a Mesa                             |       No |                Sí |                Sí |
| Sincronización en tiempo real dentro de La Mesa |       No |                Sí |                Sí |
| Guardar recursos                                |       No |                No |                Sí |
| Biblioteca                                      |       No |                No |                Sí |
| Campañas                                        |       No |                No |                Sí |
| Guardar Mesa                                    |       No |                No |                Sí |
| Contexto IA de campaña                          |       No |                No |                Sí |
| Fuente propia para IA [futuro]                  |       No |                No | Candidato premium |
| Historial                                       |       No |                No |                Sí |

## 2.1 Regla de alcance del tiempo real

**En el MVP, únicamente La Mesa es multiusuario y utiliza sincronización en tiempo real.**

```text
Aventuras ────────── individual
Mapas ────────────── individual
NPC/Hojas ────────── individual
Dados standalone ─── individual

La Mesa ───────────── multiusuario + realtime
                     ├── mapa compartido
                     ├── tokens
                     ├── dibujos
                     └── tiradas compartidas
```

El término `Realtime` en este proyecto no debe interpretarse como una capacidad transversal de todos los módulos.

## 3. Generators

### Adventures

```text
Input
├── idea
├── genre
├── tone
├── duration
├── party size
└── lore mode
   ↓
Text AI
   ↓
Editor
   ↓
Markdown / PDF
```

### Maps

```text
Prompt + Parameters
       ↓
    Image AI
       ↓
     Preview
       ↓
      JPG
```

### NPC

```text
Identity
Appearance
Personality
Motivation
Background
Traits
   ↓
Editable Output
   ↓
Export
```

### Character Sheets

```text
Template
   ↓
Preview
   ↓
PDF / JPG
```

## 4. Tools

### Dice Roller

```text
d4 d6 d8 d10 d12 d20 d100
         +
1d20 / 2d6 / 2d6+3
```

Implementado como `/dice`, público y sin persistencia. `@repo/dice-engine` es
TypeScript puro, usa Web Crypto y limita cada tirada a 20 dados. Soporta
keepHighest/keepLowest como primitivas de dominio; ventaja y desventaja son
respectivamente `2d20` conservando el mayor o el menor. La futura Mesa podrá
reutilizarlo para tiradas autoritativas en servidor.

Futuro: macros, historial y reglas por sistema.

### Table

```text
Table
│
├── Session
│   ├── Host
│   ├── Join code/link
│   └── Participants
│
├── Board
│   ├── Background map
│   └── Grid
│
├── Tokens
│   ├── create
│   ├── move
│   ├── color
│   └── name
│
├── Drawing
│   ├── line
│   ├── arrow
│   └── simple shapes
│
├── Dice
└── Realtime Sync
```

Premium futuro: guardar/cargar estado, enlazar a campaña e historial de sesiones.

La sincronización en tiempo real descrita en esta sección pertenece exclusivamente a `Table`.

## 5. Library — futuro

```text
Library
├── Adventures
├── Maps
├── NPCs
├── Characters
├── Documents
└── Other Resources
```

Operaciones previstas:

- guardar;
- editar;
- duplicar;
- etiquetar;
- buscar;
- descargar;
- eliminar;
- asociar a campaña.

## 6. Campaigns — futuro

```text
Campaign
├── Metadata
├── Lore
├── Adventures
├── Maps
├── NPCs
├── Characters
├── Sessions
├── Resources
└── AI Context
```

La campaña convertirá recursos independientes en un espacio persistente relacionado.

## 7. Lore Layer — futuro

```text
Content Context
├── Generic
├── Lore Pack
│   ├── setting
│   ├── vocabulary
│   ├── factions
│   ├── locations
│   └── constraints
└── User Source
    └── uploaded documents
```

Un lore modificará el contexto de generación, pero no la arquitectura principal. Los paquetes preinstalados basados en obras comerciales deberán limitarse a material cuyo uso/licencia sea compatible.

## 8. AI Layer

```text
UI Feature
     ↓
Generation Use Case
     ↓
AI Service
     ↓
Provider Interface
     ├── Text Provider
     └── Image Provider
            ↓
       Concrete Providers
```

Proveedor inicial: Cloudflare Workers AI. El resto de la aplicación no debe conocer el proveedor concreto.

## 9. Export Layer

```text
Generated Resource
├── Text
│   ├── Markdown
│   └── PDF
└── Visual
    ├── JPG
    └── PDF when appropriate
```

La descarga es especialmente importante para usuarios sin persistencia.

## 10. Relaciones futuras

```text
User
├── Library
│   └── Resource
└── Campaign
    ├── Resource
    ├── Character
    ├── NPC
    ├── Adventure
    ├── Map
    └── TableSession
```

Un recurso podrá existir de forma temporal, en una biblioteca o asociado a una campaña.

## 11. Estados conceptuales de un recurso

### Gratis

```text
Generated
   ↓
Edited
   ↓
Downloaded
```

### Premium futuro

```text
Generated
   ↓
Edited
   ↓
Saved
   ↓
Associated to Campaign
   ↓
Reused / Regenerated
```

## 12. Releases funcionales

### Release 0 — Beta MVP

- Aventuras;
- Mapas;
- NPC;
- Hoja genérica;
- Dados;
- login gratuito para Mesa;
- Mesa en tiempo real;
- exportaciones.

### Release 1 — Personal Workspace

- biblioteca;
- historial;
- recursos guardados.

### Release 2 — Campaign Workspace

- campañas;
- asociación de recursos;
- mesas guardadas;
- historial de campaña.

### Release 3 — Contextual AI

- contexto de campaña;
- lore packs;
- fuentes del usuario;
- RAG;
- historial de generaciones.

### Release 4 — Collaboration

- miembros de campaña;
- permisos DJ/PJ;
- sesiones persistentes;
- Mesa avanzada.

## 13. Prioridades

### P0 — MVP

- aventuras;
- mapas;
- NPC;
- hoja;
- dados;
- login;
- Mesa con sincronización en tiempo real;
- exportación.

### P1

- biblioteca;
- persistencia;
- campañas;
- asociación de recursos.

### P2

- IA contextual;
- lore;
- fuentes propias;
- colaboración persistente en campañas y/o Mesa;
- Mesa persistente.

### P3

- sistemas concretos;
- automatización de reglas;
- integraciones externas;
- herramientas VTT avanzadas.

## 14. Dependencias funcionales

```text
Dice
  └── standalone
       └── reused by Table

NPC
  └── standalone
       └── future Campaign Resource

Adventure
  └── standalone
       └── future Campaign Resource

Map
  └── standalone
       ├── used by Table
       └── future Campaign Resource

Authentication
  └── required by Table

Realtime
  └── required ONLY by Table in the MVP

Persistence
  └── NOT required by MVP generators
       └── future Library + Campaigns
```

**Decisiones centrales:**

1. ningún generador debe depender de campañas, autenticación o persistencia para funcionar;
2. en el MVP, ningún generador utiliza colaboración ni sincronización en tiempo real;
3. La Mesa es el único módulo multiusuario/realtime del MVP.

## 15. Estado de fases

### Phase 12 — Campaigns

**Status:** DEFERRED
**Target:** future persistence/premium

### Phase 13 — Dice Engine + Standalone Dice Roller

**Status:** COMPLETE

La ruta pública `/dice` usa `@3d-dice/dice-box-threejs` para la presentación
física WebGL de tiradas locales. `packages/dice-engine` continúa siendo la
fuente autoritativa del resultado: el renderer recibe caras predeterminadas y
se verifica al finalizar la animación.

La única instancia de DiceBox por mesa serializa los cambios visuales y la
física. Antes de cada animación, el lanzador espera un frame para estabilizar
el cambio de dock y sincroniza dimensiones; los cambios de `ResizeObserver`
se difieren hasta que termina la física.

Si DiceBox no devuelve las caras esperadas, la presentación queda sin verificar
pero el resultado mostrado sigue siendo el del motor. El diagnóstico con las
caras esperadas y recibidas solo se expone durante desarrollo; producción
muestra un aviso accesible sin detalles técnicos.

Si la inicialización o la física no terminan dentro del límite operativo, el
lanzador completa con el fallback accesible del motor. Una física vencida se
detiene mediante `clearDice()` antes de liberar la opción de reroll.

El lanzador admite los dados estándar, notación limitada, modificadores y
ventaja/desventaja de d20, con un máximo de 20 dados. Incluye configuración
visual de colorset, textura y material, y sonidos locales opcionales. No hay
autenticación, persistencia ni historial.

Un success threshold opcional cuenta cada dado efectivo de la tirada después
de aplicar el modificador individual, sin usar el total acumulado.

WebGL es una mejora progresiva: reduced-motion y navegadores sin WebGL siguen
recibiendo resultados textuales accesibles fuera del canvas.
