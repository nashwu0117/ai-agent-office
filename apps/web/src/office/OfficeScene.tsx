import { useEffect, useRef } from "react";
import { Application, Container, Graphics, Sprite, type Texture } from "pixi.js";
import type { Agent, AgentState } from "@ai-office/core";
import { CHARACTER_KEYS, loadOfficeTextures, type AssetKey } from "./assets.js";
import { useLanguage } from "../i18n/language-context.js";

// World is authored on a tile grid (Kenney's Tiny Dungeon tiles are 16x16)
// and only converted to screen pixels at draw time via tileToScreen(). ZOOM
// is an integer multiplier baked into each sprite's own scale — not a CSS
// stretch on the canvas element — so nearest-neighbor sampling stays crisp
// at any window size instead of being bilinear-blurred by a non-integer
// browser resize of the canvas.
const TILE = 16;
const ZOOM = 3;
const SCREEN_TILE = TILE * ZOOM;

// v0.15: grown from 20x12 to 25x15 (same 5:3 aspect ratio the CSS
// `.office-canvas canvas` rule assumes) to fit a third desk row and a wider
// walkway — AGENT_ROSTER grew to 14 agents in v0.13 but this scene still
// only had 6 desk/home slots, so agents 7-14 landed exactly on top of
// agents 1-6 (same modulo'd slot) and their labels visibly overlapped.
const COLS = 25;
const ROWS = 15;
const WIDTH = COLS * SCREEN_TILE;
const HEIGHT = ROWS * SCREEN_TILE;

// Three rows of desks (5 + 5 + 4 = 14) inside the widened open-office block
// (tx 4-19, ty 1-9), same desk/seat spacing pattern as the original 6-desk
// layout, just repeated for a third row.
const WORKSTATIONS = [
  { desk: [6, 2], seat: [6.5, 3] },
  { desk: [9, 2], seat: [9.5, 3] },
  { desk: [12, 2], seat: [12.5, 3] },
  { desk: [15, 2], seat: [15.5, 3] },
  { desk: [18, 2], seat: [18.5, 3] },
  { desk: [6, 5], seat: [6.5, 6] },
  { desk: [9, 5], seat: [9.5, 6] },
  { desk: [12, 5], seat: [12.5, 6] },
  { desk: [15, 5], seat: [15.5, 6] },
  { desk: [18, 5], seat: [18.5, 6] },
  { desk: [6, 8], seat: [6.5, 9] },
  { desk: [9, 8], seat: [9.5, 9] },
  { desk: [12, 8], seat: [12.5, 9] },
  { desk: [15, 8], seat: [15.5, 9] },
] as const;

// Two rows of 7 in the central walkway between the meeting room (tx <= 6)
// and the lounge (tx >= 18), spaced 1.5 tiles (72px) apart — comfortably
// wider than an agent-id label (~62px) so 14 labels never collide.
const PUBLIC_HOMES = [
  [7.5, 12.3],
  [9.0, 12.3],
  [10.5, 12.3],
  [12.0, 12.3],
  [13.5, 12.3],
  [15.0, 12.3],
  [16.5, 12.3],
  [7.5, 13.8],
  [9.0, 13.8],
  [10.5, 13.8],
  [12.0, 13.8],
  [13.5, 13.8],
  [15.0, 13.8],
  [16.5, 13.8],
] as const;
const HORIZONTAL_DIVIDER_ROW = 10;
const HORIZONTAL_GAPS = new Set([3, 4, 9, 10, 15, 16, 20, 21]);
const VERTICAL_GAP_ROWS = new Set([5]);

const STATE_COLOR: Record<AgentState, number> = {
  created: 0x9ca3af,
  available: 0x60a5fa,
  assigned: 0xfbbf24,
  starting: 0xfbbf24,
  working: 0x34d399,
  waiting: 0xf59e0b,
  blocked: 0xf87171,
  error: 0xef4444,
  done: 0xa78bfa,
  releasing: 0x93c5fd,
};

function isAtDesk(state: AgentState): boolean {
  return state !== "available" && state !== "created";
}

function tileToScreen(tx: number, ty: number): { x: number; y: number } {
  return { x: Math.round(tx * SCREEN_TILE), y: Math.round(ty * SCREEN_TILE) };
}

interface SpriteBundle {
  container: Container;
  body: Sprite;
  statusDot: Graphics;
  badge: Graphics;
  label: Graphics;
  bubble: Graphics;
  bubbleText: string;
  target: { x: number; y: number };
  wanderPhase: number;
}

// A compact 3x5 bitmap alphabet. Scene labels and task bubbles are drawn as
// integer-aligned rectangles instead of browser-font glyphs, so every piece
// of UI inside the canvas follows the same hard pixel grid as the Kenney art.
const PIXEL_GLYPHS: Record<string, string> = {
  A: "010101111101101", B: "110101110101110", C: "011100100100011",
  D: "110101101101110", E: "111100110100111", F: "111100110100100",
  G: "011100101101011", H: "101101111101101", I: "111010010010111",
  J: "001001001101010", K: "101101110101101", L: "100100100100111",
  M: "101111111101101", N: "101111111111101", O: "010101101101010",
  P: "110101110100100", Q: "010101101111011", R: "110101110101101",
  S: "011100010001110", T: "111010010010010", U: "101101101101111",
  V: "101101101101010", W: "101101111111101", X: "101101010101101",
  Y: "101101010010010", Z: "111001010100111",
  0: "111101101101111", 1: "010110010010111", 2: "110001111100111",
  3: "110001011001110", 4: "101101111001001", 5: "111100110001110",
  6: "011100111101111", 7: "111001010010010", 8: "111101111101111",
  9: "111101111001110", "-": "000000111000000", ".": "000000000000010",
  ":": "000010000010000", "/": "001001010100100", "!": "010010010000010",
  "?": "110001010000010", " ": "000000000000000",
};

function drawPixelText(
  target: Graphics,
  text: string,
  { color = 0xf4e4cb, unit = 2, align = "center" }: { color?: number; unit?: number; align?: "left" | "center" } = {}
): { width: number; height: number } {
  const value = text.toUpperCase();
  const glyphWidth = 3 * unit;
  const advance = 4 * unit;
  const width = Math.max(0, value.length * advance - unit);
  const startX = align === "center" ? -Math.floor(width / 2) : 0;
  for (let index = 0; index < value.length; index += 1) {
    const glyph = PIXEL_GLYPHS[value[index]] ?? PIXEL_GLYPHS["?"];
    for (let pixel = 0; pixel < glyph.length; pixel += 1) {
      if (glyph[pixel] !== "1") continue;
      const gx = pixel % 3;
      const gy = Math.floor(pixel / 3);
      target.rect(startX + index * advance + gx * unit, gy * unit, unit, unit).fill({ color });
    }
  }
  return { width: Math.max(width, glyphWidth), height: 5 * unit };
}

function drawAgentLabel(target: Graphics, agentId: string): void {
  target.clear();
  const width = agentId.length * 8 - 2;
  target.rect(-Math.floor(width / 2) - 4, -3, width + 8, 17).fill({ color: 0x181724, alpha: 0.86 });
  target.rect(-Math.floor(width / 2) - 4, -3, width + 8, 2).fill({ color: 0x4c2b33 });
  drawPixelText(target, agentId, { color: 0xf4e4cb, unit: 2 });
}

function drawStatusMarker(target: Graphics, color: number, selected: boolean): void {
  target.clear();
  if (selected) {
    target.rect(-7, -3, 14, 2).fill({ color: 0xf4e4cb });
    target.rect(-7, 7, 14, 2).fill({ color: 0xf4e4cb });
    target.rect(-7, -3, 2, 12).fill({ color: 0xf4e4cb });
    target.rect(5, -3, 2, 12).fill({ color: 0xf4e4cb });
  }
  target.rect(-4, 0, 8, 6).fill({ color: 0x181724 });
  target.rect(-2, 2, 4, 2).fill({ color });
}

function drawStatusBadge(target: Graphics, kind: "done" | "error" | "security" | null, phase: number): void {
  target.clear();
  if (!kind) return;
  const color = kind === "done" ? 0x5fc98f : kind === "security" ? 0xe66a62 : 0xf3c66b;
  const y = kind === "done" ? -Math.round(Math.abs(Math.sin(phase * 4)) * 6) : 0;
  target.rect(-7, y - 7, 14, 14).fill({ color: 0x181724 });
  target.rect(-5, y - 5, 10, 10).fill({ color: kind === "security" ? 0x792f3b : 0x202337 });
  if (kind === "done") {
    for (const [px, py] of [[-3, 0], [-1, 2], [1, 0], [3, -2]]) {
      target.rect(px, y + py, 2, 2).fill({ color });
    }
  } else {
    target.rect(-1, y - 3, 2, 5).fill({ color });
    target.rect(-1, y + 3, 2, 2).fill({ color });
  }
}

function wrapBubble(message: string): string[] {
  const clean = message.replace(/\s+/g, " ").trim().toUpperCase();
  const words = clean.split(" ");
  const lines = [""];
  for (const word of words) {
    const line = lines[lines.length - 1];
    if (`${line}${line ? " " : ""}${word}`.length <= 22) {
      lines[lines.length - 1] = `${line}${line ? " " : ""}${word}`;
    } else if (lines.length < 2) {
      lines.push(word.slice(0, 22));
    } else {
      lines[1] = `${lines[1].slice(0, 19)}...`;
      break;
    }
  }
  return lines.filter(Boolean);
}

function drawTaskBubble(target: Graphics, message: string): void {
  target.clear();
  const lines = wrapBubble(message);
  const maxLength = Math.max(...lines.map((line) => line.length), 1);
  const width = maxLength * 4 + 7;
  const height = lines.length * 7 + 7;
  target.rect(-Math.floor(width / 2), -height, width, height).fill({ color: 0x181724, alpha: 0.96 });
  target.rect(-Math.floor(width / 2) + 2, -height + 2, width - 4, height - 4).fill({ color: 0x202337 });
  target.rect(-2, 0, 4, 4).fill({ color: 0x181724 });
  lines.forEach((line, index) => {
    const lineLayer = new Graphics();
    drawPixelText(lineLayer, line, { color: 0xf4e4cb, unit: 1 });
    lineLayer.position.set(0, -height + 4 + index * 7);
    target.addChild(lineLayer);
  });
}

export interface OfficeSceneProps {
  agents: Agent[];
  progressByAgent: Record<string, string>;
  selectedId: string | null;
  onSelect: (agentId: string) => void;
  /** Agent ids with a just-happened workspace isolation violation — rendered as a distinct alert, not the normal error badge. */
  securityAlertAgentIds?: Set<string>;
}

export function OfficeScene({
  agents,
  progressByAgent,
  selectedId,
  onSelect,
  securityAlertAgentIds,
}: OfficeSceneProps) {
  const { t } = useLanguage();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const spritesRef = useRef<Map<string, SpriteBundle>>(new Map());
  const agentLayerRef = useRef<Container | null>(null);
  const texturesRef = useRef<Record<AssetKey, Texture> | null>(null);
  const agentsRef = useRef<Agent[]>(agents);
  const progressRef = useRef(progressByAgent);
  const selectedRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  const securityAlertRef = useRef<Set<string>>(securityAlertAgentIds ?? new Set());

  agentsRef.current = agents;
  progressRef.current = progressByAgent;
  selectedRef.current = selectedId;
  onSelectRef.current = onSelect;
  securityAlertRef.current = securityAlertAgentIds ?? new Set();

  useEffect(() => {
    let destroyed = false;
    const app = new Application();

    (async () => {
      await app.init({
        width: WIDTH,
        height: HEIGHT,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        antialias: false,
        roundPixels: true,
        backgroundColor: 0x1a1a2e,
      });
      if (destroyed || !hostRef.current) return;

      app.canvas.style.imageRendering = "pixelated";
      app.canvas.setAttribute("aria-hidden", "true");
      app.canvas.setAttribute("role", "presentation");
      hostRef.current.appendChild(app.canvas);
      appRef.current = app;

      const textures = await loadOfficeTextures();
      if (destroyed) return;
      texturesRef.current = textures;

      const worldLayer = new Container();
      app.stage.addChild(worldLayer);
      buildFloor(worldLayer, textures);
      buildPartitions(worldLayer, textures);
      buildDecor(worldLayer, textures);

      const agentLayer = new Container();
      app.stage.addChild(agentLayer);
      agentLayerRef.current = agentLayer;

      app.ticker.add((ticker) => {
        syncSprites(agentLayer, spritesRef.current, agentsRef.current, textures, onSelectRef.current);
        tick(
          spritesRef.current,
          agentsRef.current,
          progressRef.current,
          selectedRef.current,
          securityAlertRef.current,
          ticker.deltaTime
        );
      });
    })();

    return () => {
      destroyed = true;
      appRef.current?.destroy(true, { children: true });
      appRef.current = null;
      agentLayerRef.current = null;
      texturesRef.current = null;
      spritesRef.current.clear();
    };
  }, []);

  return (
    <section
      ref={hostRef}
      className="office-canvas"
      aria-labelledby="office-scene-heading"
      aria-describedby="office-scene-summary"
    >
      <h2 id="office-scene-heading" className="sr-only">
        {t.officeSceneHeading}
      </h2>
      <p id="office-scene-summary" className="sr-only">
        {t.officeSceneSummary}
      </p>
      <ul className="agent-access-list" aria-label={t.officeAgentsListLabel}>
        {agents.map((agent) => {
          const progress = progressByAgent[agent.id];
          const state = t.agentStateLabel(agent.state);
          return (
            <li key={agent.id}>
              <button
                type="button"
                aria-pressed={selectedId === agent.id}
                aria-label={t.agentAccessLabel(agent.id, state, progress)}
                onClick={() => onSelect(agent.id)}
              >
                <span aria-hidden="true" className={`agent-access-state agent-access-state-${agent.state}`}>
                  ●
                </span>
                {agent.id} · {state}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function placeTile(layer: Container, texture: Texture, tx: number, ty: number): Sprite {
  const sprite = new Sprite(texture);
  sprite.scale.set(ZOOM);
  const pos = tileToScreen(tx, ty);
  sprite.position.set(pos.x, pos.y);
  layer.addChild(sprite);
  return sprite;
}

function placeRotatedTile(layer: Container, texture: Texture, tx: number, ty: number): Sprite {
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.scale.set(ZOOM);
  const pos = tileToScreen(tx + 0.5, ty + 0.5);
  sprite.position.set(pos.x, pos.y);
  sprite.angle = 90;
  layer.addChild(sprite);
  return sprite;
}

function drawOfficePartition(tx: number, ty: number, orientation: "horizontal" | "vertical"): Graphics {
  const partition = new Graphics();
  const pos = tileToScreen(tx, ty);
  partition.position.set(pos.x, pos.y);

  if (orientation === "horizontal") {
    partition.rect(0, 12, SCREEN_TILE, 18).fill({ color: 0x181724 });
    partition.rect(2, 14, SCREEN_TILE - 4, 12).fill({ color: 0x59627c });
    partition.rect(2, 14, SCREEN_TILE - 4, 4).fill({ color: 0xb3bad0 });
    partition.rect(5, 18, SCREEN_TILE - 10, 6).fill({ color: 0x747c96 });
    partition.rect(0, 10, SCREEN_TILE, 4).fill({ color: 0x202337 });
    partition.rect(0, 8, 5, 24).fill({ color: 0x181724 });
    partition.rect(SCREEN_TILE - 5, 8, 5, 24).fill({ color: 0x181724 });
  } else {
    partition.rect(12, 0, 18, SCREEN_TILE).fill({ color: 0x181724 });
    partition.rect(14, 2, 12, SCREEN_TILE - 4).fill({ color: 0x59627c });
    partition.rect(14, 2, 4, SCREEN_TILE - 4).fill({ color: 0xb3bad0 });
    partition.rect(18, 5, 6, SCREEN_TILE - 10).fill({ color: 0x747c96 });
    partition.rect(10, 0, 4, SCREEN_TILE).fill({ color: 0x202337 });
    partition.rect(8, 0, 24, 5).fill({ color: 0x181724 });
    partition.rect(8, SCREEN_TILE - 5, 24, 5).fill({ color: 0x181724 });
  }

  return partition;
}

function buildFloor(layer: Container, textures: Record<AssetKey, Texture>): void {
  for (let ty = 0; ty < ROWS; ty += 1) {
    for (let tx = 0; tx < COLS; tx += 1) {
      if (ty === 0) {
        placeTile(layer, textures.wall_trim, tx, ty);
      } else if (
        (tx >= 4 && tx <= 19 && ty >= 1 && ty <= 9) ||
        (tx <= 6 && ty >= 11) ||
        (tx >= 18 && ty >= 11)
      ) {
        placeTile(layer, textures.floor_dark, tx, ty);
      } else {
        placeTile(layer, textures.floor_light, tx, ty);
      }
    }
  }
}

function buildPartitions(layer: Container, textures: Record<AssetKey, Texture>): void {
  for (let tx = 0; tx < COLS; tx += 1) {
    if (HORIZONTAL_GAPS.has(tx)) continue;
    layer.addChild(drawOfficePartition(tx, HORIZONTAL_DIVIDER_ROW, "horizontal"));
  }

  for (const tx of [4, 20]) {
    for (let ty = 1; ty <= 9; ty += 1) {
      if (VERTICAL_GAP_ROWS.has(ty)) continue;
      layer.addChild(drawOfficePartition(tx, ty, "vertical"));
    }
  }
}

function buildDecor(layer: Container, textures: Record<AssetKey, Texture>): void {
  // Reception: a staffed welcome desk, company plaque, noticeboard and files.
  addZoneSign(layer, "RECEPTION", 2, 1.25, 0xf3c66b);
  placeTile(layer, textures.wall_plaque, 1, 2);
  placeTile(layer, textures.noticeboard, 3, 2);
  placeTile(layer, textures.desk_monitor, 2, 4);
  placeTile(layer, textures.stool, 2, 5);
  placeTile(layer, textures.bookshelf, 0, 5);

  // Main office: three complete desk rows, one workstation per registered
  // agent (14, matching AGENT_ROSTER — see WORKSTATIONS above).
  addZoneSign(layer, "OPEN OFFICE", 11.5, 1.25, 0x5fc98f);
  for (const workstation of WORKSTATIONS) {
    placeTile(layer, textures.desk_monitor, workstation.desk[0], workstation.desk[1]);
  }

  // Pantry / records: refreshment point plus storage along the right wall.
  addZoneSign(layer, "PANTRY", 22, 1.25, 0x8da9d6);
  placeTile(layer, textures.bookshelf, 20, 2);
  placeTile(layer, textures.water_cooler, 24, 2);
  placeTile(layer, textures.table, 22, 4);
  placeTile(layer, textures.stool, 21, 4);
  placeTile(layer, textures.stool, 23, 4);
  layer.addChild(drawPixelBin(24, 5));

  // Meeting corner: a three-tile conference table surrounded by seats.
  addZoneSign(layer, "MEETING", 3.5, 11.25, 0xf3c66b);
  for (const tx of [2, 3, 4]) placeTile(layer, textures.table, tx, 12);
  for (const [tx, ty] of [[1, 12], [5, 12], [2, 13], [4, 13]]) {
    placeTile(layer, textures.stool, tx, ty);
  }
  placeTile(layer, textures.noticeboard, 0, 12);

  // Lounge: softer spacing, a side table and the water-cooler conversation spot.
  addZoneSign(layer, "LOUNGE", 21, 11.25, 0xa78bfa);
  placeTile(layer, textures.table, 20, 13);
  placeTile(layer, textures.stool, 19, 13);
  placeTile(layer, textures.stool, 21, 13);
  placeTile(layer, textures.bookshelf, 24, 13);

  for (const [tx, ty] of [
    [0, 8],
    [20, 7],
    [24, 8],
    [0, 13],
    [17, 13],
  ]) {
    layer.addChild(drawPottedPlant(tx, ty));
  }
}

function drawPottedPlant(tx: number, ty: number): Graphics {
  const g = new Graphics();
  const pos = tileToScreen(tx, ty + 1);
  g.position.set(pos.x, pos.y);
  const s = ZOOM;
  // Deliberately block-built on the same 3x zoom grid as the 16px tiles.
  g.rect(-3 * s, -4 * s, 6 * s, 4 * s).fill({ color: 0x4c2b33 });
  g.rect(-2 * s, -5 * s, 4 * s, s).fill({ color: 0xefa46f });
  g.rect(-s, -10 * s, 2 * s, 5 * s).fill({ color: 0x286a53 });
  g.rect(-4 * s, -9 * s, 3 * s, 3 * s).fill({ color: 0x5fc98f });
  g.rect(s, -11 * s, 3 * s, 4 * s).fill({ color: 0x5fc98f });
  g.rect(-2 * s, -13 * s, 3 * s, 4 * s).fill({ color: 0x34a76f });
  return g;
}

function drawPixelBin(tx: number, ty: number): Graphics {
  const g = new Graphics();
  const pos = tileToScreen(tx + 0.5, ty + 0.9);
  g.position.set(pos.x, pos.y);
  const s = ZOOM;
  g.rect(-3 * s, -5 * s, 6 * s, 5 * s).fill({ color: 0x202337 });
  g.rect(-4 * s, -6 * s, 8 * s, s).fill({ color: 0x747c96 });
  g.rect(-2 * s, -4 * s, s, 3 * s).fill({ color: 0xb3bad0 });
  g.rect(s, -4 * s, s, 3 * s).fill({ color: 0xb3bad0 });
  return g;
}

function addZoneSign(layer: Container, label: string, tx: number, ty: number, accent: number): void {
  const sign = new Graphics();
  const width = label.length * 8 + 22;
  sign.rect(-Math.floor(width / 2), -8, width, 28).fill({ color: 0x181724, alpha: 0.94 });
  sign.rect(-Math.floor(width / 2) + 4, -4, 6, 20).fill({ color: accent });
  const textLayer = new Graphics();
  drawPixelText(textLayer, label, { color: 0xf4e4cb, unit: 2 });
  textLayer.x = 4;
  sign.addChild(textLayer);
  const pos = tileToScreen(tx, ty);
  sign.position.set(pos.x, pos.y);
  layer.addChild(sign);
}

function syncSprites(
  layer: Container,
  sprites: Map<string, SpriteBundle>,
  agents: Agent[],
  textures: Record<AssetKey, Texture>,
  onSelect: (id: string) => void
): void {
  agents.forEach((agent, i) => {
    if (sprites.has(agent.id)) return;

    const container = new Container();
    container.eventMode = "static";
    container.cursor = "pointer";
    container.on("pointerdown", () => onSelect(agent.id));

    const statusDot = new Graphics();
    container.addChild(statusDot);

    const textureKey = CHARACTER_KEYS[i % CHARACTER_KEYS.length];
    const body = new Sprite(textures[textureKey]);
    body.anchor.set(0.5, 1);
    body.scale.set(ZOOM);
    container.addChild(body);

    const label = new Graphics();
    drawAgentLabel(label, agent.id);
    label.position.set(0, 9);
    container.addChild(label);

    const badge = new Graphics();
    badge.position.set(18, -TILE * ZOOM - 4);
    container.addChild(badge);

    const bubble = new Graphics();
    bubble.position.set(0, -TILE * ZOOM - 9);
    container.addChild(bubble);

    layer.addChild(container);

    const [homeX, homeY] = PUBLIC_HOMES[i % PUBLIC_HOMES.length];
    const home = tileToScreen(homeX, homeY);
    container.position.set(home.x, home.y);

    sprites.set(agent.id, {
      container,
      body,
      statusDot,
      badge,
      label,
      bubble,
      bubbleText: "",
      target: { x: home.x, y: home.y },
      wanderPhase: Math.random() * 1000,
    });
  });

  const byId = new Set(agents.map((a) => a.id));
  for (const [id, bundle] of sprites) {
    if (!byId.has(id)) {
      bundle.container.destroy({ children: true });
      sprites.delete(id);
    }
  }
}

function tick(
  sprites: Map<string, SpriteBundle>,
  agents: Agent[],
  progressByAgent: Record<string, string>,
  selectedId: string | null,
  securityAlertAgentIds: Set<string>,
  deltaFrames: number
): void {
  const dt = deltaFrames / 60;

  agents.forEach((agent, i) => {
    const bundle = sprites.get(agent.id);
    if (!bundle) return;

    const atDesk = isAtDesk(agent.state);
    const workstation = WORKSTATIONS[i % WORKSTATIONS.length];

    if (atDesk) {
      const seat = tileToScreen(workstation.seat[0], workstation.seat[1]);
      bundle.target.x = seat.x;
      bundle.target.y = seat.y;
    } else {
      bundle.wanderPhase += dt;
      const [homeX, homeY] = PUBLIC_HOMES[i % PUBLIC_HOMES.length];
      const wx = homeX + Math.sin(bundle.wanderPhase * 0.5) * 0.3;
      const wy = homeY + Math.cos(bundle.wanderPhase * 0.3) * 0.25;
      const home = tileToScreen(wx, wy);
      bundle.target.x = home.x;
      bundle.target.y = home.y;
    }

    const speed = atDesk ? 0.07 : 0.025;
    bundle.container.x += (bundle.target.x - bundle.container.x) * Math.min(1, speed * (1 + dt));
    bundle.container.y += (bundle.target.y - bundle.container.y) * Math.min(1, speed * (1 + dt));
    bundle.container.x = Math.round(bundle.container.x);
    bundle.container.y = Math.round(bundle.container.y);

    const seated = agent.state === "working" || agent.state === "waiting" || agent.state === "blocked";
    const bobSpeed = seated ? 6 : 2.2;
    const bobAmount = seated ? 1 : 2;
    const bob = Math.round(Math.sin((bundle.wanderPhase + i) * bobSpeed) * bobAmount);
    bundle.body.y = seated ? bob - 3 : bob;
    // Character sprites always remain at the authored integer zoom. The old
    // 0.92 seated scale introduced fractional sampling and visibly softened
    // working agents compared with idle/done agents.
    bundle.body.scale.set(ZOOM);

    const color = STATE_COLOR[agent.state] ?? 0x9ca3af;
    drawStatusMarker(bundle.statusDot, color, agent.id === selectedId);

    const securityAlert = securityAlertAgentIds.has(agent.id);
    if (securityAlert) {
      // Deliberately distinct from the ordinary "!" error badge below — a
      // workspace isolation violation is a security event, not a routine
      // CLI failure, and must not look the same at a glance (see SECURITY.md).
      drawStatusBadge(bundle.badge, "security", bundle.wanderPhase);
      const alertSize = 14 + Math.round(Math.abs(Math.sin(bundle.wanderPhase * 8)) * 2) * 2;
      bundle.statusDot.rect(-alertSize / 2, -4, alertSize, 2).fill({ color: 0xe66a62 });
      bundle.statusDot.rect(-alertSize / 2, 8, alertSize, 2).fill({ color: 0xe66a62 });
    } else if (agent.state === "done") {
      drawStatusBadge(bundle.badge, "done", bundle.wanderPhase);
    } else if (agent.state === "error") {
      drawStatusBadge(bundle.badge, "error", bundle.wanderPhase);
    } else {
      drawStatusBadge(bundle.badge, null, bundle.wanderPhase);
    }

    const message = progressByAgent[agent.id];
    if (agent.state === "working" && message) {
      const nextBubbleText = truncate(message, 44);
      if (bundle.bubbleText !== nextBubbleText) {
        bundle.bubble.removeChildren().forEach((child) => child.destroy());
        drawTaskBubble(bundle.bubble, nextBubbleText);
        bundle.bubbleText = nextBubbleText;
      }
      bundle.bubble.visible = true;
    } else if (agent.state === "waiting") {
      const waiting = "WAITING FOR WORKSPACE...";
      if (bundle.bubbleText !== waiting) {
        bundle.bubble.removeChildren().forEach((child) => child.destroy());
        drawTaskBubble(bundle.bubble, waiting);
        bundle.bubbleText = waiting;
      }
      bundle.bubble.visible = true;
    } else {
      bundle.bubble.visible = false;
    }
  });
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
