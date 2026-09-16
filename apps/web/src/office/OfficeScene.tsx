import { useEffect, useRef } from "react";
import { Application, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import type { Agent, AgentState } from "@ai-office/core";
import { CHARACTER_KEYS, loadOfficeTextures, type AssetKey } from "./assets.js";

// World is authored on a tile grid (Kenney's Tiny Dungeon tiles are 16x16)
// and only converted to screen pixels at draw time via tileToScreen(). ZOOM
// is an integer multiplier baked into each sprite's own scale — not a CSS
// stretch on the canvas element — so nearest-neighbor sampling stays crisp
// at any window size instead of being bilinear-blurred by a non-integer
// browser resize of the canvas.
const TILE = 16;
const ZOOM = 3;
const SCREEN_TILE = TILE * ZOOM;

const COLS = 20;
const ROWS = 12;
const WIDTH = COLS * SCREEN_TILE;
const HEIGHT = ROWS * SCREEN_TILE;

const WORKSTATION_ROW = 2;
const DIVIDER_ROW = 5;
const DIVIDER_GAP_COLS = new Set([9, 10]);
const PUBLIC_HOME_ROW = 8;
const PUBLIC_ROW_MIN = 6;
const PUBLIC_ROW_MAX = 11;

const SEAT_COLS = [2, 6, 10, 14, 18];

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
  badge: Text;
  label: Text;
  bubble: Text;
  target: { x: number; y: number };
  wanderPhase: number;
}

export interface OfficeSceneProps {
  agents: Agent[];
  progressByAgent: Record<string, string>;
  selectedId: string | null;
  onSelect: (agentId: string) => void;
}

export function OfficeScene({ agents, progressByAgent, selectedId, onSelect }: OfficeSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const spritesRef = useRef<Map<string, SpriteBundle>>(new Map());
  const agentLayerRef = useRef<Container | null>(null);
  const texturesRef = useRef<Record<AssetKey, Texture> | null>(null);
  const agentsRef = useRef<Agent[]>(agents);
  const progressRef = useRef(progressByAgent);
  const selectedRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);

  agentsRef.current = agents;
  progressRef.current = progressByAgent;
  selectedRef.current = selectedId;
  onSelectRef.current = onSelect;

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
      hostRef.current.appendChild(app.canvas);
      appRef.current = app;

      const textures = await loadOfficeTextures();
      if (destroyed) return;
      texturesRef.current = textures;

      const worldLayer = new Container();
      app.stage.addChild(worldLayer);
      buildFloor(worldLayer, textures);
      buildDivider(worldLayer, textures);
      buildDecor(worldLayer, textures);

      const agentLayer = new Container();
      app.stage.addChild(agentLayer);
      agentLayerRef.current = agentLayer;

      app.ticker.add((ticker) => {
        syncSprites(agentLayer, spritesRef.current, agentsRef.current, textures, onSelectRef.current);
        tick(spritesRef.current, agentsRef.current, progressRef.current, selectedRef.current, ticker.deltaTime);
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

  return <div ref={hostRef} className="office-canvas" />;
}

function placeTile(layer: Container, texture: Texture, tx: number, ty: number): Sprite {
  const sprite = new Sprite(texture);
  sprite.scale.set(ZOOM);
  const pos = tileToScreen(tx, ty);
  sprite.position.set(pos.x, pos.y);
  layer.addChild(sprite);
  return sprite;
}

function buildFloor(layer: Container, textures: Record<AssetKey, Texture>): void {
  for (let ty = 0; ty < ROWS; ty += 1) {
    for (let tx = 0; tx < COLS; tx += 1) {
      if (ty === 0) {
        placeTile(layer, textures.wall_trim, tx, ty);
      } else if (ty >= 1 && ty <= WORKSTATION_ROW + 2) {
        placeTile(layer, textures.floor_dark, tx, ty);
      } else {
        placeTile(layer, textures.floor_light, tx, ty);
      }
    }
  }
}

function buildDivider(layer: Container, textures: Record<AssetKey, Texture>): void {
  for (let tx = 0; tx < COLS; tx += 1) {
    if (DIVIDER_GAP_COLS.has(tx)) continue;
    placeTile(layer, textures.divider_fence, tx, DIVIDER_ROW);
  }
}

function buildDecor(layer: Container, textures: Record<AssetKey, Texture>): void {
  for (const col of SEAT_COLS) {
    placeTile(layer, textures.desk_monitor, col, WORKSTATION_ROW);
  }

  placeTile(layer, textures.bookshelf, 0, PUBLIC_ROW_MIN);
  placeTile(layer, textures.water_cooler, COLS - 1, PUBLIC_ROW_MIN);
  placeTile(layer, textures.noticeboard, 0, PUBLIC_ROW_MAX);
  placeTile(layer, textures.wall_plaque, COLS - 1, PUBLIC_ROW_MAX);

  placeTile(layer, textures.table, 15, 9);
  placeTile(layer, textures.stool, 14, 9);
  placeTile(layer, textures.stool, 16, 9);

  for (const [tx, ty] of [
    [4, 9],
    [8, 6],
    [13, 10],
  ]) {
    layer.addChild(drawPottedPlant(tx, ty));
  }
}

function drawPottedPlant(tx: number, ty: number): Graphics {
  const g = new Graphics();
  const pos = tileToScreen(tx, ty + 1);
  g.position.set(pos.x, pos.y);
  const s = ZOOM;
  g.rect(-4 * s, -6 * s, 8 * s, 6 * s).fill({ color: 0x8b5a2b });
  g.circle(0, -10 * s, 6 * s).fill({ color: 0x2f855a });
  g.circle(-4 * s, -8 * s, 4 * s).fill({ color: 0x38a169 });
  g.circle(4 * s, -8 * s, 4 * s).fill({ color: 0x38a169 });
  return g;
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

    const label = new Text({
      text: agent.id,
      style: { fill: 0xffffff, fontSize: 11, fontFamily: "monospace" },
    });
    label.anchor.set(0.5, 0);
    label.position.set(0, 6);
    container.addChild(label);

    const badge = new Text({
      text: "",
      style: { fill: 0xffffff, fontSize: 16, fontFamily: "monospace" },
    });
    badge.anchor.set(0.5, 1);
    badge.position.set(16, -TILE * ZOOM);
    container.addChild(badge);

    const bubble = new Text({
      text: "",
      style: {
        fill: 0xf9fafb,
        fontSize: 11,
        fontFamily: "monospace",
        wordWrap: true,
        wordWrapWidth: 170,
        align: "center",
      },
    });
    bubble.anchor.set(0.5, 1);
    bubble.position.set(0, -TILE * ZOOM - 6);
    container.addChild(bubble);

    layer.addChild(container);

    const home = tileToScreen(SEAT_COLS[i % SEAT_COLS.length] + 0.5, PUBLIC_HOME_ROW);
    container.position.set(home.x, home.y);

    sprites.set(agent.id, {
      container,
      body,
      statusDot,
      badge,
      label,
      bubble,
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
  deltaFrames: number
): void {
  const dt = deltaFrames / 60;

  agents.forEach((agent, i) => {
    const bundle = sprites.get(agent.id);
    if (!bundle) return;

    const atDesk = isAtDesk(agent.state);
    const seatCol = SEAT_COLS[i % SEAT_COLS.length];

    if (atDesk) {
      const seat = tileToScreen(seatCol + 0.5, WORKSTATION_ROW + 1);
      bundle.target.x = seat.x;
      bundle.target.y = seat.y;
    } else {
      bundle.wanderPhase += dt;
      const wanderTileRange = 1.2;
      const wanderRowRange = PUBLIC_ROW_MAX - PUBLIC_ROW_MIN - 1;
      const wx = seatCol + 0.5 + Math.sin(bundle.wanderPhase * 0.5) * wanderTileRange;
      const wy = PUBLIC_HOME_ROW + Math.cos(bundle.wanderPhase * 0.3) * (wanderRowRange / 3);
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
    bundle.body.scale.set(seated ? ZOOM * 0.92 : ZOOM);

    const color = STATE_COLOR[agent.state] ?? 0x9ca3af;
    bundle.statusDot.clear();
    bundle.statusDot.circle(0, 4, 4).fill({ color });
    if (agent.id === selectedId) {
      bundle.statusDot.circle(0, 4, 7).stroke({ color: 0xffffff, width: 1 });
    }

    if (agent.state === "done") {
      bundle.badge.text = "✓";
      bundle.badge.style.fill = 0x34d399;
      bundle.badge.y = -TILE * ZOOM - Math.abs(Math.sin(bundle.wanderPhase * 4)) * 6;
    } else if (agent.state === "error") {
      bundle.badge.text = "!";
      bundle.badge.style.fill = 0xef4444;
      bundle.badge.y = -TILE * ZOOM;
    } else {
      bundle.badge.text = "";
    }

    const message = progressByAgent[agent.id];
    if (agent.state === "working" && message) {
      bundle.bubble.text = truncate(message, 90);
      bundle.bubble.visible = true;
    } else {
      bundle.bubble.visible = false;
    }
  });
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
