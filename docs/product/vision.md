# Visión de Producto — Proyecto OpenCode RPG

**Estado:** Conceptual / Fase 0  
**Versión:** 0.2  
**Fecha:** 12 de agosto de 2026

## 1. Propósito

Crear una aplicación web de apoyo a partidas de rol de mesa que permita a cualquier usuario, sea Director de Juego (DJ) o jugador (PJ), generar y utilizar recursos de forma independiente, sin obligarle a crear una campaña ni a mantener una cuenta de pago.

La aplicación combinará generación asistida por IA, utilidades tradicionales de rol y una mesa virtual ligera, con una identidad visual inspirada en el escritorio de trabajo de un cartógrafo o escriba medieval.

El proyecto comenzará como beta privada y gratuita, pero su diseño deberá permitir evolucionar hacia persistencia, campañas, colaboración y servicios premium sin rehacer el núcleo.

## 2. Principio central

> **Usar primero; guardar y organizar después.**

El usuario debe poder crear un recurso útil sin campaña, sin onboarding complejo y, salvo para La Mesa, sin iniciar sesión.

Ejemplos:

- generar una aventura y descargarla;
- generar un mapa y descargarlo;
- crear un NPC;
- obtener una hoja de personaje imprimible;
- lanzar dados.

La persistencia, organización e historial serán una capa adicional del producto.

## 3. Tipos de usuario

### Invitado

Puede usar generadores y dados, editar resultados y descargarlos. No dispone de persistencia ni de campañas y no puede acceder a La Mesa.

### Usuario registrado gratuito

Incluye todo lo anterior y además puede crear o unirse a una sesión de **La Mesa**, que es la única funcionalidad multiusuario y sincronizada en tiempo real del MVP. La Mesa gratuita será efímera y no ofrecerá guardado permanente.

### Usuario premium — futuro

Añadirá progresivamente:

- biblioteca personal;
- campañas;
- recursos persistentes;
- guardado de La Mesa;
- historial;
- contexto de campaña para IA;
- colaboración persistente;
- posibles fuentes propias para aportar contexto.

## 4. Propuesta de valor

El producto no será únicamente un generador de IA ni únicamente una VTT. Su valor será reunir en una experiencia coherente:

1. generación creativa asistida por IA;
2. recursos visuales y descargables;
3. utilidades rápidas durante la partida;
4. una Mesa virtual ligera y compartida;
5. organización persistente de campañas en una evolución posterior.

## 5. Núcleos funcionales

### Aventuras

Generación de _one shots_ (aventura corta diseñada para comenzar y terminar en una única sesión de juego) a partir de parámetros como tono, género, duración, número de jugadores, tipo de conflicto o ambientación. El resultado será editable y exportable.

### Mapas

Generación de imágenes mediante IA. Dirección artística inicial: pergamino, sepia, negro, lápiz/carboncillo y aspecto de cartografía fantástica artesanal. La imagen no incluirá cuadrícula funcional; esta se añadirá en La Mesa.

### NPC y hojas

Los NPC podrán generarse completos y editarse. Las hojas de personaje serán inicialmente genéricas y descargables en PDF/JPG para imprimir o rellenar digitalmente.

### Dados

Herramienta independiente y siempre accesible. El MVP no necesita historial persistente.

### La Mesa

Espacio compartido en tiempo real para usuarios autenticados:

- host y participantes;
- carga de mapa;
- cuadrícula;
- tokens con nombre y color;
- movimiento de tokens;
- dados;
- líneas, flechas y formas simples;
- sincronización en tiempo real de esos elementos entre los participantes de la misma Mesa.

**Alcance del tiempo real:** en el MVP, La Mesa es la única funcionalidad multiusuario, colaborativa y sincronizada en tiempo real. Los generadores de aventuras, mapas, NPC y hojas de personaje son herramientas individuales y no comparten ni sincronizan su contenido con otros usuarios.

La versión gratuita no ofrecerá guardado permanente de la Mesa. Podrá existir estado técnico temporal durante la sesión para permitir sincronización y reconexiones, pero ese estado expirará y no constituirá persistencia de usuario.

## 6. Campañas

Las campañas no serán necesarias para usar las herramientas básicas. Serán la principal capa de organización de una futura modalidad premium.

```text
Campaign
├── Adventures
├── Maps
├── NPCs
├── Characters
├── Locations
├── Resources
├── Table Sessions
└── Generation History
```

Una campaña podrá convertirse posteriormente en contexto para la IA.

## 7. IA y universos de rol

El núcleo será **agnóstico al sistema y al universo**.

Se contemplan tres modos futuros:

### Genérico

Contenido sin dependencia de un universo concreto.

### Lore Pack

Conjunto de contexto disponible en la plataforma para orientar la generación hacia una ambientación concreta.

### Fuente del usuario

Documentos aportados por el usuario como contexto adicional. Queda fuera del MVP y es candidata a función premium.

Los paquetes basados en propiedades intelectuales comerciales deberán incorporarse únicamente cuando exista una base de uso/licencia adecuada. Antes de utilizar libros comerciales como corpus permanente será necesaria una revisión específica de derechos y condiciones de uso.

## 8. Portabilidad de IA

Ninguna feature dependerá directamente de un proveedor concreto.

```text
Feature
   ↓
AI Service
   ↓
AI Provider
   ├── Cloudflare Workers AI
   ├── OpenAI
   ├── Gemini
   └── Future Providers
```

Cloudflare Workers AI será el candidato inicial durante la fase gratuita de pruebas.

## 9. Identidad visual

La interfaz debe evocar una gran mesa de trabajo de un cartógrafo, escriba o aventurero.

### Paleta

- madera;
- marrón;
- beige;
- pergamino;
- sepia;
- carbón;
- cuero.

### Elementos visuales

- papiros;
- mapas;
- plumas;
- tinta;
- carboncillo;
- reglas;
- brújulas;
- sellos;
- libros;
- pequeñas piezas de juego.

La ambientación nunca debe perjudicar legibilidad, accesibilidad, responsive o rendimiento.

## 10. Exportación

### Texto

- PDF;
- Markdown.

### Imagen

- JPG.

### Hojas

- PDF;
- JPG cuando sea útil.

## 11. Restricciones iniciales

Durante desarrollo y beta:

- prioridad a servicios gratuitos/free tier;
- sin monetización real;
- repositorio privado;
- despliegue accesible a un grupo reducido;
- IA inicial gratuita;
- evitar infraestructura innecesaria;
- preparar la arquitectura para funciones premium sin construirlas aún.

## 12. Visión de evolución

```text
Herramientas independientes
          ↓
Beta con La Mesa colaborativa
          ↓
Biblioteca personal
          ↓
Campañas persistentes
          ↓
IA contextual de campaña
          ↓
Mesa persistente
          ↓
Colaboración persistente en campañas y Mesa
```

## 13. Criterio de éxito inicial

La primera beta será satisfactoria si un grupo pequeño puede:

### Herramientas individuales

1. generar, editar y descargar una aventura;
2. generar, editar y descargar un mapa;
3. generar, editar y descargar un NPC o una hoja de personaje;
4. utilizar el lanzador de dados sin depender de una campaña.

### La Mesa

5. iniciar sesión y crear una sesión de La Mesa;
6. permitir que otros usuarios autenticados se unan a esa misma Mesa mediante un código o enlace;
7. dentro de esa Mesa, visualizar el mismo mapa y sincronizar en tiempo real el movimiento de tokens, las herramientas de dibujo y las tiradas compartidas;
8. finalizar la sesión sin requerir guardado permanente.

**Regla de alcance:** la colaboración y la sincronización en tiempo real del MVP se limitan exclusivamente a La Mesa. Ningún generador individual comparte ni sincroniza su contenido entre usuarios.

Todo ello debe poder realizarse sin necesidad de crear una campaña ni contratar un servicio de pago.
