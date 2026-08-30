# VARDA-LABS Presentation System

## Palette

| Role       | Color     | Use                                    |
| ---------- | --------- | -------------------------------------- |
| Paper      | `#F6F4EF` | Warm off-white page canvas             |
| Surface    | `#FDFCF9` | Dialogs, tooltips, selected controls   |
| Ink        | `#191B20` | Type, actual historical series         |
| Cobalt     | `#315BB5` | Primary action, focus, selected series |
| Muted      | `#696C72` | Supporting labels                      |
| Rule       | `#DCDCD7` | Fine dividers                          |
| Terracotta | `#A55248` | Negative changes, downside             |
| Amber      | `#84652E` | Missing evidence and warnings          |

Canonical CSS tokens live in `src/app/presentation.css`. Colors communicate
meaning; missing observations remain distinct from a zero change.

## Composition

- An unframed primary visualization, with generous surrounding space.
- Controls remain beside the relevant data; no scroll snapping or slide paging.
- One compact account/group selector and one primary navigation system.
- Thin rules, restrained 4-8px control corners, no floating section cards.
- Detailed calculations remain accessible through tabs, disclosures and dialogs.
- Fixed type scales; no viewport-width font sizing. Respect reduced motion.
- Stored observations, units, comparisons and confidence definitions are unchanged.

## Brand Mark

`public/varda-mark.png` is shown at 24px beside `VARDA-LABS`. It was generated
with the built-in image generation tool, preserving the transparent background.

Prompt: An original minimalist symbol for VARDA-LABS, an elegant abstract flowing
V formed from three bold tapered ribbon-like shapes with one small incision of
negative space; modern Swiss editorial cut-paper silhouette, flat muted cobalt
blue #315BB5, square silhouette legible at 22px, transparent background, no text,
mockup, border, shadows, tiny details, texture or gradients.

## Screen Anchors

Home: total assets and a clear historical line. Today: movement and contribution.
Contribution: an editable amount followed by the allocation flow. Structure:
interactive allocation ring with an alternative treemap. History: performance
and date rail. Investment Lab: actual-versus-scenario comparison. Simulation:
probability paths and their interpretation. Secondary forms use the same brand,
canvas, controls and unframed sections without changing their write semantics.
