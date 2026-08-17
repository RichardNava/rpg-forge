# Alcance del MVP — Proyecto OpenCode RPG

**Estado:** Conceptual / Fase 0  
**Versión:** 0.2  
**Fecha:** 12 de agosto de 2026

## 1. Objetivo

Validar una experiencia útil alrededor de cinco capacidades principales:

1. generación de aventuras;
2. generación de mapas;
3. La Mesa;
4. lanzador de dados;
5. generación de NPC y hojas de personaje.

El MVP no incluirá todavía monetización, campañas persistentes ni memoria contextual avanzada.

## 2. Hipótesis a validar

- La IA produce recursos de rol suficientemente útiles como para editarlos y descargarlos.
- La estética de escriba/cartógrafo aporta personalidad sin empeorar la UX.
- Existe valor en una Mesa ligera centrada en mapa, tokens, dibujo y dados.
- Las herramientas independientes son útiles sin campaña.
- La persistencia y campañas pueden constituir valor premium en el futuro.

## 3. Acceso

### Invitado

Puede usar Aventuras, Mapas, NPC/Hojas y Dados. Puede editar y descargar.

### Registrado gratuito

Puede hacer lo anterior y además crear o unirse a La Mesa.

**La Mesa es la única funcionalidad multiusuario y sincronizada en tiempo real del MVP.** Los generadores y el lanzador de dados independiente no son colaborativos.

No existe cuenta de pago en el MVP.

## 4. Aventuras

### Incluido

- _one shots_;
- parámetros guiados;
- ambientación genérica;
- generación IA;
- salida estructurada;
- edición;
- regeneración;
- exportación Markdown;
- exportación PDF.

### Estructura mínima

```text
Título
Premisa
Contexto
Gancho inicial
Escenarios
NPC relevantes
Conflicto
Escenas / encuentros
Clímax
Posibles desenlaces
Notas para el DJ
```

### Fuera del MVP

- memoria;
- contexto de campaña;
- RAG;
- historial persistente;
- campañas largas;
- colaboración sobre el documento.

## 5. Mapas

### Incluido

- prompt;
- parámetros guiados;
- generación IA;
- estilo visual coherente;
- previsualización;
- regeneración;
- descarga JPG.

### Estilo inicial

Pergamino, sepia, trazos negros, tinta/lápiz/carboncillo y aspecto cartográfico artesanal.

### Fuera del MVP

- almacenamiento permanente;
- biblioteca;
- editor gráfico;
- capas;
- cuadrícula incrustada;
- fog of war en la imagen.

## 6. NPC y hojas

### NPC

- nombre;
- apariencia;
- personalidad;
- motivación;
- historia breve;
- rasgos;
- notas;
- edición;
- exportación.

### Hoja de personaje

- plantilla genérica;
- campos sin completar;
- aspecto imprimible;
- PDF;
- opcionalmente JPG.

### Fuera del MVP

- reglas completas de sistemas concretos;
- progresión;
- inventario persistente;
- sincronización con campañas.

## 7. Dados

### Incluido

Dados habituales y expresiones básicas:

```text
d4 d6 d8 d10 d12 d20 d100
1d20
2d6
2d6+3
```

El motor deberá ser independiente de la UI.

La ruta pública `/dice` ofrece d4, d6, d8, d10, d12, d20 y d100, notación
limitada (`d20`, `2d6`, `2d6+3`, con espacios opcionales), modificadores y
ventaja/desventaja de d20 mediante keep highest/lowest. Las tiradas son locales,
temporales y no requieren autenticación, campaña ni persistencia. El máximo es
20 dados por tirada y la aleatoriedad usa Web Crypto.

Un success threshold opcional evalúa cada dado efectivo (`kept`) de forma
individual: `resultado del dado + modificador >= threshold`. Los dados
descartados por ventaja/desventaja no cuentan éxitos. No se usa el total
acumulado para esta evaluación.

### Fuera del MVP

- historial persistente;
- macros;
- estadísticas;
- reglas específicas por sistema.

En La Mesa, las tiradas sí deberán notificarse a los participantes en tiempo real.

## 8. La Mesa

### Requisito

Todos los participantes deben estar autenticados.

### Flujo

```text
Login
  ↓
Crear Mesa
  ↓
Obtener código/enlace
  ↓
Otros usuarios se unen
  ↓
Host carga mapa
  ↓
Todos ven la misma Mesa
  ↓
Interactúan en tiempo real
```

### Incluido

- host;
- participantes;
- carga de mapa local;
- cuadrícula superpuesta;
- tokens;
- nombre/color de token;
- movimiento;
- líneas;
- flechas;
- formas básicas;
- dados;
- sincronización en tiempo real.

### Persistencia

No habrá persistencia de producto para la Mesa gratuita: el usuario no podrá guardar una Mesa para recuperarla posteriormente como recurso permanente.

Sí podrá existir **estado técnico temporal de sesión** en el servidor para mantener la sincronización, soportar reconexiones y recuperar el estado mientras la Mesa siga vigente. Ese estado deberá expirar automáticamente y no se considerará persistencia premium.

### Criterio crítico

Dos navegadores conectados a la **misma Mesa** deben observar, sin refrescar manualmente, los cambios relevantes producidos dentro de esa Mesa: mapa, tokens, dibujos y tiradas compartidas.

Esta sincronización no se aplica a Aventuras, Mapas, NPC/Hojas ni al lanzador de dados utilizado fuera de La Mesa.

### Fuera del MVP

- guardar/recuperar Mesa;
- fog of war avanzado;
- iluminación dinámica;
- audio/vídeo;
- chat complejo;
- permisos avanzados;
- mapas multicapa;
- replay.

## 9. Autenticación

Obligatoria únicamente para La Mesa durante el MVP.

Los generadores y el lanzador de dados independiente deben funcionar sin login y sin colaboración en tiempo real.

## 10. Persistencia

### MVP

Solo la estrictamente necesaria para:

- autenticación;
- identidad de participantes;
- metadatos técnicos indispensables.

Los recursos generados no necesitan guardarse.

El estado técnico temporal utilizado por La Mesa para sincronización y reconexiones no se considera una biblioteca ni persistencia de usuario.

### Futuro

- biblioteca;
- campañas;
- mapas;
- aventuras;
- NPC;
- personajes;
- historial;
- mesas;
- generaciones IA.

## 11. IA

### Proveedor inicial previsto

Cloudflare Workers AI mediante una capa de abstracción propia.

### Texto

- aventuras;
- escenarios;
- NPC.

### Imagen

- mapas.

### No incluido

- embeddings;
- vector DB;
- RAG;
- memoria de campaña;
- fuentes del usuario;
- agentes de lore en producción.

## 12. Sistemas y lore

El MVP será agnóstico. La publicación de paquetes basados en libros comerciales queda fuera del MVP hasta verificar derechos/licencias.

La arquitectura futura deberá permitir:

```text
Generic
Lore Pack
User Source
```

## 13. Exportaciones

| Recurso  | Formato                     |
| -------- | --------------------------- |
| Aventura | Markdown + PDF              |
| NPC      | Markdown/PDF                |
| Hoja     | PDF + opcional JPG          |
| Mapa     | JPG                         |
| Tiradas  | Sin exportación obligatoria |
| Mesa     | Sin exportación obligatoria |

## 14. Fuera del MVP global

- pagos y suscripciones;
- campañas persistentes;
- biblioteca persistente;
- RAG de libros;
- memoria de campaña;
- roles DJ/PJ complejos;
- reglas específicas por sistema;
- marketplace;
- app móvil nativa;
- integraciones externas;
- iluminación dinámica;
- editor de mapas avanzado;
- edición colaborativa o sincronización en tiempo real de aventuras, mapas generados, NPC o hojas de personaje.

## 15. Orden recomendado

```text
MVP-0   Shell visual + navegación
   ↓
MVP-1   Dados
   ↓
MVP-2   NPC
   ↓
MVP-3   Aventuras
   ↓
MVP-4   Mapas IA
   ↓
MVP-5   Autenticación
   ↓
MVP-6   Mesa local
   ↓
MVP-7   Mesa tiempo real
   ↓
MVP-8   Exportaciones
   ↓
MVP-9   Beta privada
```

## 16. Criterios de aceptación de beta

La beta se considera funcional cuando:

### Herramientas individuales

- un invitado genera, edita y descarga una aventura;
- genera, edita y descarga un mapa;
- genera, edita y descarga un NPC;
- obtiene y descarga una hoja de personaje;
- realiza tiradas mediante el lanzador independiente.

### La Mesa

- un usuario inicia sesión y crea una Mesa;
- otro usuario autenticado se une a esa misma Mesa;
- ambos ven el mismo mapa de la Mesa;
- el movimiento de tokens y los dibujos básicos se sincronizan entre participantes de esa Mesa;
- las tiradas realizadas dentro de La Mesa se muestran en tiempo real a sus participantes;
- una reconexión durante la vigencia de la sesión puede recuperar el estado técnico necesario;
- no existe obligación de guardar permanentemente la Mesa.

### Regla transversal

- los errores de IA se gestionan sin romper la interfaz;
- **ninguna herramienta de generación individual requiere colaboración o sincronización en tiempo real.**

## 17. Feedback prioritario

Durante la beta interesa conocer:

- qué generadores se usan más;
- cuánto se edita lo generado;
- si La Mesa es suficientemente cómoda;
- qué herramienta se echa en falta;
- qué función justificaría guardar recursos/campañas;
- qué función podría justificar pagar en el futuro.
