import { Assets, Texture, TextureSource } from "pixi.js";

import charOne from "../assets/kenney/char_1.png";
import charTwo from "../assets/kenney/char_2.png";
import charThree from "../assets/kenney/char_3.png";
import charFour from "../assets/kenney/char_4.png";
import charFive from "../assets/kenney/char_5.png";
import floorDark from "../assets/kenney/floor_dark.png";
import floorLight from "../assets/kenney/floor_light.png";
import wallTrim from "../assets/kenney/wall_trim.png";
import dividerFence from "../assets/kenney/divider_fence.png";
import deskMonitor from "../assets/kenney/desk_monitor.png";
import table from "../assets/kenney/table.png";
import stool from "../assets/kenney/stool.png";
import bookshelf from "../assets/kenney/bookshelf.png";
import waterCooler from "../assets/kenney/water_cooler.png";
import noticeboard from "../assets/kenney/noticeboard.png";
import wallPlaque from "../assets/kenney/wall_plaque.png";

// Nearest-neighbor sampling for every texture loaded from here on — the
// single global switch that keeps 16x16 pixel-art crisp at any zoom instead
// of getting smoothed into a blur by Pixi's bilinear default.
TextureSource.defaultOptions.scaleMode = "nearest";

const MANIFEST = {
  char_1: charOne,
  char_2: charTwo,
  char_3: charThree,
  char_4: charFour,
  char_5: charFive,
  floor_dark: floorDark,
  floor_light: floorLight,
  wall_trim: wallTrim,
  divider_fence: dividerFence,
  desk_monitor: deskMonitor,
  table,
  stool,
  bookshelf,
  water_cooler: waterCooler,
  noticeboard,
  wall_plaque: wallPlaque,
} as const;

export type AssetKey = keyof typeof MANIFEST;

export const CHARACTER_KEYS: AssetKey[] = ["char_1", "char_2", "char_3", "char_4", "char_5"];

export async function loadOfficeTextures(): Promise<Record<AssetKey, Texture>> {
  const entries = await Promise.all(
    (Object.keys(MANIFEST) as AssetKey[]).map(async (key) => {
      const texture = await Assets.load<Texture>(MANIFEST[key]);
      texture.source.scaleMode = "nearest";
      return [key, texture] as const;
    })
  );
  return Object.fromEntries(entries) as Record<AssetKey, Texture>;
}
