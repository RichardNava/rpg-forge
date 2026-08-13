---
name: rpg-frontend-style
description: Design and implement the project's distinctive tabletop-RPG interface using parchment, wood, ink, cartography, and scribe-worktable cues without sacrificing accessibility, hierarchy, responsiveness, or performance.
compatibility: opencode
metadata:
  project: rpg-project
  scope: visual-design
---

# RPG Frontend Style

Use this skill when creating or materially redesigning visible UI.

This skill defines the project's visual execution. Product and accessibility rules in `AGENTS.md` remain authoritative.

## 1. Design concept

The interface should feel like a functional medieval/fantasy creator's desk:

```text
cartographer
scribe
game master
field notebook
parchment map
wooden worktable
ink / charcoal / graphite
```

It should **not** feel like a themed amusement-park UI.

The visual metaphor supports the task; it must not obstruct it.

## 2. Visual hierarchy

Prefer:

```text
clean content canvas
+
strong section hierarchy
+
restrained decorative framing
```

The primary task must be obvious within a few seconds.

Use decorative elements mostly for:

- section framing;
- dividers;
- toolbars;
- resource previews;
- empty states;
- selected/active states.

Avoid covering every container with texture.

## 3. Color system

Use semantic design tokens rather than one-off colors.

Families:

```text
parchment
wood
leather
ink
charcoal
sepia
metal/accent
success
warning
danger
focus
```

Typical roles:

```text
page/background
→ light parchment/neutral

primary text
→ dark ink/charcoal

secondary text
→ softened ink

structural chrome
→ wood/leather

interactive accent
→ restrained metal/ink accent

danger
→ explicit semantic danger color
```

Never rely on brown-vs-brown differences for status.

## 4. Texture

Texture must be subtle.

Good:

- low-contrast paper grain;
- faint edge variation;
- restrained map-line ornament;
- occasional ink-stamp motif.

Bad:

- noisy photographic wood behind body text;
- repeated high-contrast parchment texture;
- fake torn edges on every card;
- heavy drop shadows on every component.

Text must remain crisp.

## 5. Typography

Use at most a small, deliberate type hierarchy.

Conceptually:

```text
display / section title
→ characterful serif or inscription-inspired face

body / form / data
→ highly readable serif or sans-serif

technical/dice expressions
→ monospace where useful
```

Do not use decorative display fonts for form labels, long descriptions, errors, tables, or small text.

Maintain comfortable line length and line height.

## 6. Components

Build visual language by composing approved primitives.

```text
Button
Input
Select
Dialog
Card
Tabs

      ↓

ParchmentPanel
WoodToolbar
ScrollCard
MapFrame
DiceControl
ToolPalette
```

A themed component should solve repeated visual semantics, not exist merely to wrap another `<div>`.

Before creating one, search `shared/components/themed`.

## 7. Forms

Generators are creation tools, so forms must feel fast and clear.

Recommended pattern:

```text
brief title/context
parameters grouped by meaning
sensible defaults
advanced options collapsed when appropriate
clear primary action
result/edit area
export action
```

Do not turn every option into a decorative card.

Errors must be obvious and readable.

## 8. Generated content editors

Generated content is editable.

The editor should distinguish:

```text
input controls
generated result
editing mode
export/download actions
generation/regeneration actions
```

Do not hide editing behind unclear icons.

Never render arbitrary AI HTML.

## 9. Map presentation

Generated maps should initially support the product's visual direction:

```text
sepia
black ink
charcoal
pencil
parchment
cartographic sketch
```

The application UI around the map should remain neutral enough that the generated image is the focal point.

## 10. The Table

The Table is a tool, not a decorative page.

Priorities:

1. board visibility;
2. token legibility;
3. direct manipulation;
4. clear active tool;
5. clear connection/session state;
6. usable controls at desktop and smaller widths.

Decorative framing belongs around the workspace, not over the board.

Do not make parchment/wood textures interfere with grid or token contrast.

## 11. Motion

Motion should communicate state.

Use for:

- opening/closing;
- selection;
- successful creation;
- tool activation;
- subtle panel transitions.

Avoid ambient floating particles, constant glow, excessive parallax, or ornamental animation that distracts from game preparation/play.

Respect reduced-motion preferences.

## 12. Accessibility

Always preserve:

- visible focus;
- keyboard operation;
- semantic labels;
- sufficient contrast;
- non-color status indicators;
- usable target sizes;
- responsive zoom/text;
- error association;
- reduced-motion support.

If visual theme conflicts with accessibility, accessibility wins.

## 13. Responsive behavior

Do not simply shrink the desktop desk metaphor.

At smaller widths:

- stack generators logically;
- keep primary actions reachable;
- collapse secondary decoration;
- preserve content width;
- turn side toolbars into drawers/bottom bars when needed;
- ensure The Table controls do not obscure the board.

## 14. Avoid generic AI design

Avoid habitual patterns that are not justified by this product:

- purple/blue SaaS gradients;
- glassmorphism everywhere;
- huge rounded cards;
- excessive pill buttons;
- centered marketing layouts inside productivity tools;
- decorative icons on every label;
- random fantasy glyphs without meaning.

The result should feel authored for tabletop RPG creation, not generated from a generic dashboard template.

## 15. Completion check

Before finishing a visible UI change, verify:

```text
Does the page hierarchy read clearly without the decoration?
Is the RPG identity recognizable without reducing legibility?
Are tokens/colors reusable rather than scattered?
Is the feature responsive?
Can it be used with keyboard/focus?
Did we reuse existing primitives/themed components?
Did we avoid unnecessary client components?
```
