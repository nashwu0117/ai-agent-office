# Asset license

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
| `floor_dark.png` / `floor_light.png` | `tile_0000`, `tile_0049` — plain floor tiles, one per office zone |
| `wall_trim.png` | `tile_0036` — horizontal wall trim strip |
| `divider_fence.png` | `tile_0076` — railing used as the Public Area / Workstation boundary |
| `desk_monitor.png` | `tile_0054` — desk + monitor prop at each workstation |
| `table.png` / `stool.png` | `tile_0072`, `tile_0073` — break-area furniture |
| `bookshelf.png` | `tile_0063` — decorative prop |
| `water_cooler.png` | `tile_0064` — decorative prop |
| `noticeboard.png` | `tile_0041` — wall decoration |
| `wall_plaque.png` | `tile_0046` — wall decoration |

## Not from Kenney

The potted plant and the floating checkmark/error badges drawn above agents
are small flat-color shapes drawn directly with PixiJS `Graphics` at render
time (see `apps/web/src/office/OfficeScene.tsx`) — there is no separate
image asset for them.
