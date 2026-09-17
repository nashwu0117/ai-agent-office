# Asset license

## Pixelify Sans (`fonts/`)

- Source: https://github.com/google/fonts/tree/main/ofl/pixelifysans
- Copyright: 2021 The Pixelify Sans Project Authors
- License: SIL Open Font License 1.1; the complete license is included as
  [`fonts/OFL.txt`](./fonts/OFL.txt).
- The variable font is bundled locally so the interface keeps its pixel
  typography without relying on a network request.

## Kenney "Tiny Dungeon" (kenney/)

- Source: https://kenney.nl/assets/tiny-dungeon
- Author: Kenney (www.kenney.nl)
- License: CC0 1.0 Universal (public domain) — https://creativecommons.org/publicdomain/zero/1.0/
- No attribution is legally required; Kenney is credited here anyway, per
  their request in the pack's own `License.txt`.

Individual 16×16 tiles were cropped out of the pack's `Tiles/` folder and
renamed to describe how they're used in this project (the original pack has
no semantic file names, only sequential indices):

| File | Original tile |
| --- | --- |
| `char_1.png` … `char_5.png` | `tile_0085`, `tile_0086`, `tile_0087`, `tile_0096`, `tile_0099` — five distinct villager/knight sprites, one per agent |
| `floor_dark.png` / `floor_light.png` | `tile_0000`, `tile_0049` — contrasting floor tiles used to identify the open office, reception, pantry, meeting room, entrance and lounge zones |
| `wall_trim.png` | `tile_0036` — top-wall/window trim strip |
| `divider_fence.png` | `tile_0076` — retained source tile; the rendered office now uses project-original pixel cubicle partitions instead |
| `desk_monitor.png` | `tile_0054` — ordered workstation rows plus the reception desk |
| `table.png` / `stool.png` | `tile_0072`, `tile_0073` — conference, pantry, reception and lounge furniture |
| `bookshelf.png` | `tile_0063` — reception, pantry and lounge storage |
| `water_cooler.png` | `tile_0064` — pantry fixture |
| `noticeboard.png` | `tile_0041` — reception and meeting-room wall decoration |
| `wall_plaque.png` | `tile_0046` — reception company plaque |

All imported textures are loaded through `office/assets.ts`, which sets both
Pixi's global texture default and every loaded texture source to nearest-neighbor
sampling. The scene only applies integer 3× sprite scaling and 90° partition
rotation, preserving the pack's authored pixel grid.

## Project-original procedural pixel art (no external asset)

The following scene elements are drawn at runtime with integer-aligned PixiJS
rectangles in `apps/web/src/office/OfficeScene.tsx`; they do not use or derive
from a third-party image asset:

- block-built potted plants and waste bin;
- solid cubicle partitions with pixel-aligned panels, trim and posts;
- reception/open-office/pantry/meeting/lounge signs and the AI Office lobby sign;
- the 3×5 bitmap alphabet used for in-scene labels and task bubbles;
- square agent state markers, selection frame, and done/error/security badges.

These replace the previous smooth circles and system-font glyphs. Their colors
are limited to the existing application/Kenney-adjacent palette, and every
shape is aligned to the scene's integer pixel grid.
