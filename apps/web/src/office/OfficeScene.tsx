import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Application, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import type { Agent, AgentState } from "@ai-office/core";
import { CHARACTER_KEYS, loadOfficeTextures, type AssetKey } from "./assets.js";
import { useLanguage } from "../i18n/language-context.js";
import type { Translations } from "../i18n/translations.js";

// World is authored on a tile grid (Kenney's Tiny Dungeon tiles are 16x16)
// and only converted to screen pixels at draw time via tileToScreen(). ZOOM
// is an integer multiplier baked into each sprite's own scale — not a CSS
// stretch on the canvas element — so nearest-neighbor sampling stays crisp
// at any window size instead of being bilinear-blurred by a non-integer
// browser resize of the canvas.
const TILE = 16;
const ZOOM = 3;
const SCREEN_TILE = TILE * ZOOM;

// The larger 16:9 floor gives the agents enough real walking room instead of
// making the old 25x15 room look larger with CSS alone. The Pixi buffer keeps
// the authored integer zoom, so resizing the panel still preserves crisp
// nearest-neighbour pixels.
const COLS = 32;
const ROWS = 18;
const WIDTH = COLS * SCREEN_TILE;
const HEIGHT = ROWS * SCREEN_TILE;
const DEFAULT_OFFICE_WIDTH = 1280;
const MIN_OFFICE_WIDTH = 520;
const OFFICE_WIDTH_STORAGE_KEY = "ai-office-scene-width";

type TilePoint = readonly [number, number];

const DESK_COLUMNS = [7, 11, 15, 19, 23] as const;

// Three full rows leave two spare desks beyond today's 13-agent roster and,
// importantly, never modulo two active agents onto the same chair.
const WORKSTATIONS = [
  ...DESK_COLUMNS.map((x) => ({ desk: [x, 2] as TilePoint, seat: [x + 0.5, 3.5] as TilePoint })),
  ...DESK_COLUMNS.map((x) => ({ desk: [x, 6] as TilePoint, seat: [x + 0.5, 7.5] as TilePoint })),
  ...DESK_COLUMNS.map((x) => ({ desk: [x, 10] as TilePoint, seat: [x + 0.5, 11.5] as TilePoint })),
] as const;

// Safe, distinct initial positions in the lower common area. They are only
// spawn points now; available agents subsequently roam the whole office.
const PUBLIC_HOMES: readonly TilePoint[] = [
  [6.5, 14.5], [8.5, 14.5], [6.5, 16.5], [8.5, 16.5],
  [17.5, 14.5], [19.5, 14.5], [17.5, 16.5], [19.5, 16.5],
  [28.5, 14.5], [30.5, 14.5], [28.5, 16.5], [30.5, 16.5],
  [12.5, 14.5],
] as const;
const HORIZONTAL_DIVIDER_ROW = 12;
const HORIZONTAL_GAPS = new Set([3, 4, 8, 9, 14, 15, 20, 21, 27, 28]);
const VERTICAL_PARTITION_COLUMNS = [5, 26] as const;
const MEETING_PARTITION_COLUMNS = [10, 21] as const;
const VERTICAL_GAP_ROWS = new Set([6, 7]);

// v0.22 Part D: Master's own fixed desk, in the reception zone's otherwise
// clear lower-left corner — deliberately near the front of the office rather
// than lined up with the ordinary worker desks, so it reads as a distinct
// "corner office" spot rather than one more workstation.
const MASTER_DESK: TilePoint = [2, 9];
const MASTER_SEAT: TilePoint = [2.5, 10.5];

const PLANT_CELLS: readonly TilePoint[] = [[0, 10], [27, 9], [31, 10]];
const MEETING_ROOMS = [
  {
    anchor: [7.5, 14.5] as TilePoint,
    slots: [[6.5, 14.5], [8.5, 14.5], [6.5, 16.5], [8.5, 16.5]] as readonly TilePoint[],
    furniture: [[3, 15], [4, 15], [2, 15], [5, 15], [3, 16], [4, 16]] as readonly TilePoint[],
  },
  {
    anchor: [18.5, 14.5] as TilePoint,
    slots: [[17.5, 14.5], [19.5, 14.5], [17.5, 16.5], [19.5, 16.5]] as readonly TilePoint[],
    furniture: [[14, 15], [15, 15], [13, 15], [16, 15], [14, 16], [15, 16]] as readonly TilePoint[],
  },
  {
    anchor: [29.5, 14.5] as TilePoint,
    slots: [[28.5, 14.5], [30.5, 14.5], [28.5, 16.5], [30.5, 16.5]] as readonly TilePoint[],
    furniture: [[25, 15], [26, 15], [24, 15], [27, 15], [25, 16], [26, 16]] as readonly TilePoint[],
  },
] as const;
const BLOCKING_DECOR_CELLS: readonly TilePoint[] = [
  // Reception.
  [2, 4], [2, 5], [0, 6], MASTER_DESK,
  // Pantry / records.
  [27, 2], [31, 2], [29, 5], [28, 5], [30, 5], [31, 7],
  ...MEETING_ROOMS.flatMap((room) => room.furniture),
];

const ROAM_DESTINATIONS: readonly TilePoint[] = [
  [1.5, 3.5], [3.5, 3.5], [1.5, 8.5], [3.5, 9.5],
  [6.5, 4.5], [9.5, 4.5], [13.5, 4.5], [17.5, 4.5], [21.5, 4.5], [24.5, 4.5],
  [6.5, 8.5], [9.5, 8.5], [13.5, 8.5], [17.5, 8.5], [21.5, 8.5], [24.5, 8.5],
  [27.5, 3.5], [29.5, 3.5], [28.5, 8.5], [30.5, 10.5],
  [6.5, 13.5], [8.5, 16.5], [17.5, 13.5], [19.5, 16.5], [28.5, 13.5], [30.5, 16.5],
];

const BLOCKED_CELLS = buildBlockedCells();

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
  return ["assigned", "starting", "working", "waiting", "blocked", "releasing"].includes(state);
}

function tileToScreen(tx: number, ty: number): { x: number; y: number } {
  return { x: Math.round(tx * SCREEN_TILE), y: Math.round(ty * SCREEN_TILE) };
}

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function buildBlockedCells(): Set<string> {
  const blocked = new Set<string>();

  // The top trim and all physical partition segments are walls. Door gaps are
  // deliberately omitted so path finding can move through them.
  for (let x = 0; x < COLS; x += 1) blocked.add(cellKey(x, 0));
  for (let x = 0; x < COLS; x += 1) {
    if (!HORIZONTAL_GAPS.has(x)) blocked.add(cellKey(x, HORIZONTAL_DIVIDER_ROW));
  }
  for (const x of VERTICAL_PARTITION_COLUMNS) {
    for (let y = 1; y <= 11; y += 1) {
      if (!VERTICAL_GAP_ROWS.has(y)) blocked.add(cellKey(x, y));
    }
  }
  // Three lower meeting rooms have a single doorway each at y=14.
  for (const x of MEETING_PARTITION_COLUMNS) {
    for (let y = 13; y < ROWS; y += 1) {
      if (y !== 14) blocked.add(cellKey(x, y));
    }
  }

  for (const { desk } of WORKSTATIONS) blocked.add(cellKey(Math.floor(desk[0]), Math.floor(desk[1])));
  for (const [x, y] of [...BLOCKING_DECOR_CELLS, ...PLANT_CELLS]) {
    blocked.add(cellKey(Math.floor(x), Math.floor(y)));
  }
  return blocked;
}

function isWalkableCell(x: number, y: number, temporarilyBlocked?: Set<string>): boolean {
  return (
    x >= 0 &&
    x < COLS &&
    y >= 1 &&
    y < ROWS &&
    !BLOCKED_CELLS.has(cellKey(x, y)) &&
    !temporarilyBlocked?.has(cellKey(x, y))
  );
}

function screenToCell(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(COLS - 1, Math.floor(x / SCREEN_TILE))),
    y: Math.max(1, Math.min(ROWS - 1, Math.floor(y / SCREEN_TILE))),
  };
}

function findNavigationPath(
  startX: number,
  startY: number,
  destination: TilePoint,
  temporarilyBlocked?: Set<string>
): Array<{ x: number; y: number }> {
  const start = screenToCell(startX, startY);
  const goal = { x: Math.floor(destination[0]), y: Math.floor(destination[1]) };
  const goalKey = cellKey(goal.x, goal.y);
  const queue = [start];
  let cursor = 0;
  const previous = new Map<string, string | null>([[cellKey(start.x, start.y), null]]);
  const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;

  while (cursor < queue.length) {
    const current = queue[cursor++];
    if (current.x === goal.x && current.y === goal.y) break;
    for (const [dx, dy] of directions) {
      const next = { x: current.x + dx, y: current.y + dy };
      const nextKey = cellKey(next.x, next.y);
      if (previous.has(nextKey)) continue;
      // A destination remains reachable even if another moving agent happens
      // to occupy that cell during route calculation.
      if (nextKey !== goalKey && !isWalkableCell(next.x, next.y, temporarilyBlocked)) continue;
      if (nextKey === goalKey && !isWalkableCell(next.x, next.y)) continue;
      previous.set(nextKey, cellKey(current.x, current.y));
      queue.push(next);
    }
  }

  if (!previous.has(goalKey)) return [];
  const cells: Array<{ x: number; y: number }> = [];
  let key: string | null = goalKey;
  while (key) {
    const [x, y] = key.split(",").map(Number);
    cells.push({ x, y });
    key = previous.get(key) ?? null;
  }
  cells.reverse();

  // The first cell contains the agent already. Every remaining point is the
  // centre of a cardinally adjacent safe tile, so no segment cuts a corner.
  const path = cells.slice(1).map(({ x, y }) => tileToScreen(x + 0.5, y + 0.5));
  if (path.length === 0) {
    const exactTarget = tileToScreen(destination[0], destination[1]);
    if (Math.hypot(exactTarget.x - startX, exactTarget.y - startY) > 0.5) path.push(exactTarget);
  }
  return path;
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
  destination: { x: number; y: number };
  path: Array<{ x: number; y: number }>;
  pathIndex: number;
  navigationMode: "desk" | "meeting" | "wander";
  wanderWait: number;
  blockedFor: number;
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
  /** Active collaboration groups keyed by agent id and assigned to one of the three meeting rooms. */
  collaborationRoomByAgent?: Record<string, number>;
  /** v0.22 Part C: whether each of the 3 fixed meeting rooms is currently in session — drives the busy/idle indicator by its sign. */
  roomBusy?: boolean[];
  selectedId: string | null;
  onSelect: (agentId: string) => void;
  selectedMaster?: boolean;
  onSelectMaster?: () => void;
  /** v0.22 Part C: which meeting room's table (if any) is currently selected, for the click-to-view transcript panel. */
  selectedRoom?: number | null;
  onSelectRoom?: (room: number) => void;
  /** v0.22 Part D: whether the Master character should show its planning state right now (v0.5's existing goal "planning" status) vs. idle standby. */
  masterPlanning?: boolean;
  /** Agent ids with a just-happened workspace isolation violation — rendered as a distinct alert, not the normal error badge. */
  securityAlertAgentIds?: Set<string>;
}

export function OfficeScene({
  agents,
  progressByAgent,
  collaborationRoomByAgent,
  roomBusy,
  selectedId,
  onSelect,
  selectedMaster,
  onSelectMaster,
  selectedRoom,
  onSelectRoom,
  masterPlanning,
  securityAlertAgentIds,
}: OfficeSceneProps) {
  const { t } = useLanguage();
  const [officeWidth, setOfficeWidth] = useState(() => {
    try {
      const stored = Number.parseInt(localStorage.getItem(OFFICE_WIDTH_STORAGE_KEY) ?? "", 10);
      return Number.isFinite(stored) ? Math.max(MIN_OFFICE_WIDTH, stored) : DEFAULT_OFFICE_WIDTH;
    } catch {
      return DEFAULT_OFFICE_WIDTH;
    }
  });
  const hostRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startWidth: number;
    maxWidth: number;
  } | null>(null);
  const appRef = useRef<Application | null>(null);
  const spritesRef = useRef<Map<string, SpriteBundle>>(new Map());
  const agentLayerRef = useRef<Container | null>(null);
  const texturesRef = useRef<Record<AssetKey, Texture> | null>(null);
  const agentsRef = useRef<Agent[]>(agents);
  const progressRef = useRef(progressByAgent);
  const collaborationRef = useRef(collaborationRoomByAgent ?? {});
  const roomBusyRef = useRef<boolean[]>(roomBusy ?? [false, false, false]);
  const selectedRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  const onSelectMasterRef = useRef(onSelectMaster);
  const selectedRoomRef = useRef<number | null>(selectedRoom ?? null);
  const onSelectRoomRef = useRef(onSelectRoom);
  const securityAlertRef = useRef<Set<string>>(securityAlertAgentIds ?? new Set());
  const roomOverlaysRef = useRef<RoomOverlay[]>([]);
  const masterPlanningRef = useRef(masterPlanning ?? false);
  const masterBundleRef = useRef<MasterBundle | null>(null);

  agentsRef.current = agents;
  progressRef.current = progressByAgent;
  collaborationRef.current = collaborationRoomByAgent ?? {};
  roomBusyRef.current = roomBusy ?? [false, false, false];
  selectedRef.current = selectedId;
  onSelectRef.current = onSelect;
  onSelectMasterRef.current = onSelectMaster;
  selectedRoomRef.current = selectedRoom ?? null;
  onSelectRoomRef.current = onSelectRoom;
  securityAlertRef.current = securityAlertAgentIds ?? new Set();
  masterPlanningRef.current = masterPlanning ?? false;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        localStorage.setItem(OFFICE_WIDTH_STORAGE_KEY, String(Math.round(officeWidth)));
      } catch {
        // Resizing remains available when storage is disabled.
      }
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [officeWidth]);

  function availableOfficeWidth(): number {
    return hostRef.current?.parentElement?.clientWidth ?? DEFAULT_OFFICE_WIDTH;
  }

  function clampOfficeWidth(width: number, maxWidth = availableOfficeWidth()): number {
    return Math.round(Math.max(Math.min(MIN_OFFICE_WIDTH, maxWidth), Math.min(width, maxWidth)));
  }

  function startResize(event: ReactPointerEvent<HTMLButtonElement>): void {
    const actualWidth = hostRef.current?.getBoundingClientRect().width ?? officeWidth;
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: actualWidth,
      maxWidth: availableOfficeWidth(),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function continueResize(event: ReactPointerEvent<HTMLButtonElement>): void {
    const drag = resizeRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const horizontalDelta = event.clientX - drag.startX;
    const verticalDelta = (event.clientY - drag.startY) * (WIDTH / HEIGHT);
    const delta = Math.abs(horizontalDelta) >= Math.abs(verticalDelta) ? horizontalDelta : verticalDelta;
    setOfficeWidth(clampOfficeWidth(drag.startWidth + delta, drag.maxWidth));
  }

  function finishResize(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    const step = event.shiftKey ? 160 : 64;
    const currentWidth = hostRef.current?.getBoundingClientRect().width ?? officeWidth;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setOfficeWidth(clampOfficeWidth(currentWidth - step));
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setOfficeWidth(clampOfficeWidth(currentWidth + step));
    } else if (event.key === "Home") {
      event.preventDefault();
      setOfficeWidth(clampOfficeWidth(MIN_OFFICE_WIDTH));
    } else if (event.key === "End") {
      event.preventDefault();
      setOfficeWidth(availableOfficeWidth());
    }
  }

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
      buildDecor(worldLayer, textures, t);
      roomOverlaysRef.current = buildMeetingRoomOverlays(worldLayer, (room) => onSelectRoomRef.current?.(room));

      const agentLayer = new Container();
      app.stage.addChild(agentLayer);
      agentLayerRef.current = agentLayer;

      // v0.22 Part D: built once, independent of the `agents` array/
      // syncSprites — Master isn't a roster Agent, just a fixed, always-
      // rendered character at its own desk (see MASTER_SEAT).
      masterBundleRef.current = buildMasterSprite(agentLayer, textures, () => onSelectMasterRef.current?.());

      app.ticker.add((ticker) => {
        syncSprites(agentLayer, spritesRef.current, agentsRef.current, textures, onSelectRef.current);
        tick(
          spritesRef.current,
          agentsRef.current,
          progressRef.current,
          selectedRef.current,
          securityAlertRef.current,
          collaborationRef.current,
          t,
          ticker.deltaTime
        );
        updateMeetingRoomOverlays(roomOverlaysRef.current, roomBusyRef.current, selectedRoomRef.current);
        if (masterBundleRef.current) {
          updateMasterSprite(masterBundleRef.current, masterPlanningRef.current, performance.now() / 1000, t);
        }
      });
    })();

    return () => {
      destroyed = true;
      appRef.current?.destroy(true, { children: true });
      appRef.current = null;
      agentLayerRef.current = null;
      texturesRef.current = null;
      spritesRef.current.clear();
      roomOverlaysRef.current = [];
      masterBundleRef.current = null;
    };
  }, [t.lang]);

  return (
    <>
      <section
        ref={hostRef}
        className="office-canvas"
        style={{
          "--office-width": `${officeWidth}px`,
          "--office-title": JSON.stringify(t.officeCanvasTitle),
        } as CSSProperties}
        aria-labelledby="office-scene-heading"
        aria-describedby="office-scene-summary"
      >
        <h2 id="office-scene-heading" className="sr-only">
          {t.officeSceneHeading}
        </h2>
        <p id="office-scene-summary" className="sr-only">
          {t.officeSceneSummary}
        </p>
        <button
          type="button"
          className="office-resize-handle"
          aria-label={`${t.officeResizeHandle}. ${t.officeResizeHint}`}
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End"
          title={t.officeResizeHint}
          onPointerDown={startResize}
          onPointerMove={continueResize}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          onKeyDown={resizeWithKeyboard}
          onDoubleClick={() => setOfficeWidth(DEFAULT_OFFICE_WIDTH)}
        >
          <span aria-hidden="true">↘</span>
        </button>
      </section>
      {/*
       * v0.24 hotfix: these used to be an absolutely-positioned, invisible-
       * until-focused overlay directly on top of the canvas above — see
       * index.css's .agent-access-list comment for why that broke every
       * activation path except sequential keyboard Tab travel, and why a
       * normal always-visible row below the canvas (matching what
       * officeSceneSummary already tells users to expect) is the fix.
       */}
      <ul className="agent-access-list" aria-label={t.officeAgentsListLabel}>
        <li>
          <button
            type="button"
            aria-pressed={Boolean(selectedMaster)}
            aria-label={t.masterCharacterLabel}
            onClick={() => onSelectMaster?.()}
          >
            <span aria-hidden="true" className="agent-access-state agent-access-state-working">●</span>
            {t.masterCharacterLabel}
          </button>
        </li>
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
      <ul className="agent-access-list room-access-list" aria-label={t.officeSceneHeading}>
        {[0, 1, 2].map((roomIndex) => {
          const busy = roomBusy?.[roomIndex] ?? false;
          return (
            <li key={roomIndex}>
              <button
                type="button"
                aria-pressed={selectedRoom === roomIndex}
                aria-label={t.meetingRoomTableAriaLabel(roomIndex + 1, busy)}
                onClick={() => onSelectRoom?.(roomIndex)}
              >
                <span aria-hidden="true" className={`agent-access-state ${busy ? "agent-access-state-working" : "agent-access-state-available"}`}>
                  ●
                </span>
                {t.officeZoneMeetingRoom(roomIndex + 1)} · {busy ? t.meetingRoomStatusBusy : t.meetingRoomStatusIdle}
              </button>
            </li>
          );
        })}
      </ul>
    </>
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
        (tx >= 5 && tx <= 26 && ty >= 1 && ty <= 11) ||
        ty >= 13
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

  for (const tx of VERTICAL_PARTITION_COLUMNS) {
    for (let ty = 1; ty <= 11; ty += 1) {
      if (VERTICAL_GAP_ROWS.has(ty)) continue;
      layer.addChild(drawOfficePartition(tx, ty, "vertical"));
    }
  }

  for (const tx of MEETING_PARTITION_COLUMNS) {
    for (let ty = 13; ty < ROWS; ty += 1) {
      if (ty === 14) continue;
      layer.addChild(drawOfficePartition(tx, ty, "vertical"));
    }
  }
}

function buildDecor(layer: Container, textures: Record<AssetKey, Texture>, t: Translations): void {
  // Reception: a staffed welcome desk, company plaque, noticeboard and files.
  addZoneSign(layer, t.officeZoneReception, 2.5, 1.25, 0xf3c66b, t.lang);
  placeTile(layer, textures.wall_plaque, 1, 2);
  placeTile(layer, textures.noticeboard, 3, 2);
  placeTile(layer, textures.desk_monitor, 2, 4);
  placeTile(layer, textures.stool, 2, 5);
  placeTile(layer, textures.bookshelf, 0, 6);
  // v0.22 Part D: Master's own desk — see MASTER_DESK/buildMasterSprite. A
  // second desk_monitor tile here (not a special texture, since this asset
  // pack has none reserved for a "boss desk") plus the character itself
  // (gold tint, larger scale, permanent nameplate/status bubble) is what
  // actually distinguishes Master from an ordinary workstation.
  placeTile(layer, textures.desk_monitor, MASTER_DESK[0], MASTER_DESK[1]);

  // Main office: 15 spacious workstations across three rows.
  addZoneSign(layer, t.officeZoneOpenOffice, 15.5, 1.25, 0x5fc98f, t.lang);
  for (const workstation of WORKSTATIONS) {
    placeTile(layer, textures.desk_monitor, workstation.desk[0], workstation.desk[1]);
  }

  // Pantry / records: refreshment point plus storage along the right wall.
  addZoneSign(layer, t.officeZonePantry, 29, 1.25, 0x8da9d6, t.lang);
  placeTile(layer, textures.bookshelf, 27, 2);
  placeTile(layer, textures.water_cooler, 31, 2);
  placeTile(layer, textures.table, 29, 5);
  placeTile(layer, textures.stool, 28, 5);
  placeTile(layer, textures.stool, 30, 5);
  layer.addChild(drawPixelBin(31, 7));

  // Three independent meeting rooms. Their slots are also the destinations
  // used when a collaboration group is actively exchanging progress.
  MEETING_ROOMS.forEach((room, roomIndex) => {
    addZoneSign(layer, t.officeZoneMeetingRoom(roomIndex + 1), room.anchor[0], 13.25, 0xf3c66b, t.lang);
    room.furniture.forEach(([tx, ty], furnitureIndex) => {
      placeTile(layer, furnitureIndex < 2 ? textures.table : textures.stool, tx, ty);
    });
  });

  for (const [tx, ty] of PLANT_CELLS) {
    layer.addChild(drawPottedPlant(tx, ty));
  }
}

interface RoomOverlay {
  /** Invisible, precisely over the two "table" furniture tiles — clicking anywhere else in the room does nothing, matching the build prompt's "click the room's table" (Part C.4). */
  hitArea: Graphics;
  /** The visible busy/idle light next to that room's own zone sign. */
  statusDot: Graphics;
}

/**
 * v0.22 Part C: one clickable hit-region + status light per fixed meeting
 * room, built once (independent of the agent sprite pool, which changes
 * shape every reconnect) and then only ever re-drawn per frame in
 * updateMeetingRoomOverlays — never rebuilt, so a click handler registered
 * here is never silently dropped by a later syncSprites pass.
 */
function buildMeetingRoomOverlays(layer: Container, onSelectRoom: (room: number) => void): RoomOverlay[] {
  return MEETING_ROOMS.map((room, roomIndex) => {
    const tableCells = room.furniture.slice(0, 2);
    const minX = Math.min(...tableCells.map(([x]) => x));
    const maxX = Math.max(...tableCells.map(([x]) => x)) + 1;
    const minY = Math.min(...tableCells.map(([, y]) => y));
    const maxY = Math.max(...tableCells.map(([, y]) => y)) + 1;
    const topLeft = tileToScreen(minX, minY);
    const bottomRight = tileToScreen(maxX, maxY);

    const hitArea = new Graphics();
    hitArea.rect(0, 0, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y).fill({ color: 0xffffff, alpha: 0.001 });
    hitArea.position.set(topLeft.x, topLeft.y);
    hitArea.eventMode = "static";
    hitArea.cursor = "pointer";
    hitArea.on("pointerdown", () => onSelectRoom(roomIndex));
    layer.addChild(hitArea);

    const statusDot = new Graphics();
    const signPos = tileToScreen(room.anchor[0], 13.25);
    statusDot.position.set(signPos.x + 58, signPos.y + 6);
    layer.addChild(statusDot);

    return { hitArea, statusDot };
  });
}

/** Green when idle, pulsing amber when a handoff is in session, plus a bracket highlight when this room's transcript panel is open. */
function drawRoomStatusDot(target: Graphics, busy: boolean, selected: boolean, phase: number): void {
  target.clear();
  if (selected) {
    target.rect(-6, -6, 12, 2).fill({ color: 0xf4e4cb });
    target.rect(-6, 4, 12, 2).fill({ color: 0xf4e4cb });
    target.rect(-6, -6, 2, 12).fill({ color: 0xf4e4cb });
    target.rect(4, -6, 2, 12).fill({ color: 0xf4e4cb });
  }
  const color = busy ? 0xf3c66b : 0x5fc98f;
  const size = busy ? 6 + Math.round(Math.abs(Math.sin(phase * 5)) * 2) : 6;
  target.rect(-size / 2, -size / 2, size, size).fill({ color: 0x181724 });
  target.rect(-size / 2 + 1, -size / 2 + 1, size - 2, size - 2).fill({ color });
}

function updateMeetingRoomOverlays(overlays: RoomOverlay[], roomBusy: boolean[], selectedRoom: number | null): void {
  const phase = performance.now() / 1000;
  overlays.forEach((overlay, roomIndex) => {
    drawRoomStatusDot(overlay.statusDot, roomBusy[roomIndex] ?? false, selectedRoom === roomIndex, phase);
  });
}

interface MasterBundle {
  container: Container;
  body: Sprite;
  bubble: Graphics;
  bubbleText: string;
  glow: Graphics;
}

/** A wide gold nameplate reading "MASTER" — deliberately not drawAgentLabel's narrower id-sized banner, and gold rather than that function's dark-red strip, so it doesn't read as just another agent id at a glance. */
function drawMasterLabel(target: Graphics, text: string): void {
  target.clear();
  const width = text.length * 8 + 10;
  target.rect(-Math.floor(width / 2) - 4, -3, width + 8, 17).fill({ color: 0x181724, alpha: 0.92 });
  target.rect(-Math.floor(width / 2) - 4, -3, width + 8, 2).fill({ color: 0xf3c66b });
  drawPixelText(target, text, { color: 0xf3c66b, unit: 2 });
}

/**
 * v0.22 Part D: Master's own always-rendered character — not a roster
 * Agent, so it never goes through syncSprites/tick's per-agent bookkeeping.
 * Built once at MASTER_SEAT and never navigates (see this function's own
 * scope note below on the one thing deliberately left out this round).
 */
function buildMasterSprite(layer: Container, textures: Record<AssetKey, Texture>, onSelect: () => void): MasterBundle {
  const container = new Container();
  container.eventMode = "static";
  container.cursor = "pointer";
  container.on("pointerdown", onSelect);

  const glow = new Graphics();
  container.addChild(glow);

  // Reuses an ordinary worker sprite sheet (this asset pack has no separate
  // "boss" character) but at a larger scale with a permanent gold tint —
  // together with the nameplate and status bubble below, this is what marks
  // it as Master rather than a 14th worker.
  const body = new Sprite(textures[CHARACTER_KEYS[CHARACTER_KEYS.length - 1]]);
  body.anchor.set(0.5, 1);
  body.scale.set(ZOOM + 1);
  body.tint = 0xf3c66b;
  container.addChild(body);

  const label = new Graphics();
  container.addChild(label);

  const bubble = new Graphics();
  bubble.position.set(0, -TILE * (ZOOM + 1) - 9);
  container.addChild(bubble);

  const pos = tileToScreen(MASTER_SEAT[0], MASTER_SEAT[1]);
  container.position.set(pos.x, pos.y);
  layer.addChild(container);

  drawMasterLabel(label, "MASTER");
  label.position.set(0, 11);

  return { container, body, bubble, bubbleText: "", glow };
}

/**
 * Idle standby is drawn every bit as deliberately as the planning state —
 * the build prompt explicitly calls out "must not go blank/disappear when
 * there's nothing to do" (Part D.2) — rather than only rendering a bubble
 * while planning and leaving Master silent the rest of the time.
 *
 * Scope note: Master does not walk to a meeting room even where Part C's
 * navigation engine could technically carry it there — the build prompt
 * marks that explicitly optional this round ("不強制要求"), and Master isn't
 * a member of the `sprites` map the pathfinding/collision system operates
 * on, so it also never yields to or blocks a worker's own path.
 */
function updateMasterSprite(bundle: MasterBundle, planning: boolean, phase: number, t: Translations): void {
  const bob = Math.round(Math.sin(phase * 2.2) * 2);
  bundle.body.y = bob;

  bundle.glow.clear();
  if (planning) {
    const radius = 15 + Math.round(Math.abs(Math.sin(phase * 4)) * 4);
    bundle.glow.circle(0, -14, radius).fill({ color: 0xf3c66b, alpha: 0.22 });
  }

  const text = planning ? t.masterPlanningBubble : t.masterIdleBubble;
  if (bundle.bubbleText !== text) {
    bundle.bubble.removeChildren().forEach((child) => child.destroy());
    drawTaskBubble(bundle.bubble, text);
    bundle.bubbleText = text;
  }
  bundle.bubble.visible = true;
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

function addZoneSign(
  layer: Container,
  label: string,
  tx: number,
  ty: number,
  accent: number,
  lang: Translations["lang"]
): void {
  const sign = new Graphics();
  const width = (lang === "zh-TW" ? label.length * 16 : label.length * 8) + 22;
  sign.rect(-Math.floor(width / 2), -8, width, 28).fill({ color: 0x181724, alpha: 0.94 });
  sign.rect(-Math.floor(width / 2) + 4, -4, 6, 20).fill({ color: accent });
  const textLayer = new Graphics();
  if (lang === "zh-TW") {
    // The bitmap alphabet intentionally covers the Latin pixel set only.
    // Browser-rendered CJK here keeps the Chinese labels legible after the
    // language toggle without replacing the rest of the pixel-art scene.
    const cjkText = new Text({
      text: label,
      style: { fontFamily: "sans-serif", fontSize: 13, fill: 0xf4e4cb, fontWeight: "700" },
    });
    cjkText.anchor.set(0.5);
    cjkText.position.set(4, 2);
    sign.addChild(cjkText);
    const pos = tileToScreen(tx, ty);
    sign.position.set(pos.x, pos.y);
    layer.addChild(sign);
    return;
  }
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

    const [homeX, homeY] = chooseSpawnPoint(i, sprites);
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
      destination: { x: home.x, y: home.y },
      path: [],
      pathIndex: 0,
      navigationMode: "wander",
      wanderWait: i * 0.12,
      blockedFor: 0,
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

function chooseSpawnPoint(index: number, sprites: Map<string, SpriteBundle>): TilePoint {
  const candidates = [...PUBLIC_HOMES, ...ROAM_DESTINATIONS];
  for (let offset = 0; offset < candidates.length; offset += 1) {
    const candidate = candidates[(index + offset) % candidates.length];
    const point = tileToScreen(candidate[0], candidate[1]);
    const cell = screenToCell(point.x, point.y);
    if (!isWalkableCell(cell.x, cell.y)) continue;
    if (
      [...sprites.values()].every(
        (other) => Math.hypot(point.x - other.container.x, point.y - other.container.y) >= MIN_AGENT_SEPARATION
      )
    ) {
      return candidate;
    }
  }
  return PUBLIC_HOMES[index % PUBLIC_HOMES.length];
}

function meetingDestinationFor(
  agent: Agent,
  agents: Agent[],
  collaborationRoomByAgent: Record<string, number>
): TilePoint | null {
  const roomIndex = collaborationRoomByAgent[agent.id];
  const room = roomIndex === undefined ? undefined : MEETING_ROOMS[roomIndex];
  if (!room) return null;
  const group = agents.filter((candidate) => collaborationRoomByAgent[candidate.id] === roomIndex);
  const slot = Math.max(0, group.findIndex((candidate) => candidate.id === agent.id));
  return room.slots[slot % room.slots.length] ?? room.anchor;
}

function occupiedCells(sprites: Map<string, SpriteBundle>, bundle: SpriteBundle): Set<string> {
  const occupied = new Set<string>();
  for (const other of sprites.values()) {
    if (other === bundle) continue;
    const cell = screenToCell(other.container.x, other.container.y);
    occupied.add(cellKey(cell.x, cell.y));
  }
  return occupied;
}

function setRoute(bundle: SpriteBundle, destination: TilePoint, sprites: Map<string, SpriteBundle>): void {
  const target = tileToScreen(destination[0], destination[1]);
  bundle.destination = target;
  bundle.target = target;
  bundle.path = findNavigationPath(
    bundle.container.x,
    bundle.container.y,
    destination,
    occupiedCells(sprites, bundle)
  );
  // Temporary agent occupancy can occasionally close a doorway. Static
  // furniture is still respected in this fallback; another agent is handled
  // by the live separation check and triggers a later re-route if necessary.
  if (bundle.path.length === 0 && Math.hypot(target.x - bundle.container.x, target.y - bundle.container.y) > 2) {
    bundle.path = findNavigationPath(bundle.container.x, bundle.container.y, destination);
  }
  bundle.pathIndex = 0;
  bundle.blockedFor = 0;
}

function pickRoamDestination(bundle: SpriteBundle, sprites: Map<string, SpriteBundle>): void {
  const start = Math.floor(Math.random() * ROAM_DESTINATIONS.length);
  let fallback = ROAM_DESTINATIONS[start];

  for (let offset = 0; offset < ROAM_DESTINATIONS.length; offset += 1) {
    const candidate = ROAM_DESTINATIONS[(start + offset) % ROAM_DESTINATIONS.length];
    const target = tileToScreen(candidate[0], candidate[1]);
    if (Math.hypot(target.x - bundle.container.x, target.y - bundle.container.y) < SCREEN_TILE * 3) continue;

    const reserved = [...sprites.values()].some(
      (other) =>
        other !== bundle &&
        Math.hypot(target.x - other.destination.x, target.y - other.destination.y) < SCREEN_TILE * 1.5
    );
    if (!reserved) {
      fallback = candidate;
      break;
    }
  }
  setRoute(bundle, fallback, sprites);
}

function overlapsAnotherAgent(
  sprites: Map<string, SpriteBundle>,
  bundle: SpriteBundle,
  x: number,
  y: number
): boolean {
  for (const other of sprites.values()) {
    if (other === bundle) continue;
    if (Math.hypot(x - other.container.x, y - other.container.y) < SCREEN_TILE * 0.98) return true;
  }
  return false;
}

const MIN_AGENT_SEPARATION = SCREEN_TILE * 0.98;

function canPlaceAgent(
  candidate: SpriteBundle,
  x: number,
  y: number,
  sprites: SpriteBundle[]
): boolean {
  const cell = screenToCell(x, y);
  if (!isWalkableCell(cell.x, cell.y)) return false;
  return sprites.every(
    (other) =>
      other === candidate ||
      Math.hypot(x - other.container.x, y - other.container.y) >= MIN_AGENT_SEPARATION
  );
}

/**
 * A path can be clear at the start of a frame and still converge with a
 * second path in the same frame. Resolve that final continuous-space case
 * after movement so agents never visually collapse into one pile. Desk- and
 * meeting-bound agents have priority; a roaming agent yields and reroutes.
 */
function separateAgents(sprites: Map<string, SpriteBundle>): void {
  const bundles = [...sprites.values()];
  for (let first = 0; first < bundles.length; first += 1) {
    for (let second = first + 1; second < bundles.length; second += 1) {
      const a = bundles[first];
      const b = bundles[second];
      let dx = b.container.x - a.container.x;
      let dy = b.container.y - a.container.y;
      let distance = Math.hypot(dx, dy);
      if (distance >= MIN_AGENT_SEPARATION) continue;
      if (distance < 0.01) {
        const angle = ((first + second + 1) * Math.PI) / 3;
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        distance = 1;
      }

      const priority = (mode: SpriteBundle["navigationMode"]): number =>
        mode === "desk" ? 3 : mode === "meeting" ? 2 : 1;
      const mover = priority(a.navigationMode) < priority(b.navigationMode) ? a : b;
      const directionX = mover === a ? -dx / distance : dx / distance;
      const directionY = mover === a ? -dy / distance : dy / distance;
      const push = MIN_AGENT_SEPARATION - distance + 2;
      const baseAngle = Math.atan2(directionY, directionX);
      const candidateAngles = [0, 0.7, -0.7, 1.4, -1.4, Math.PI];
      const separationSpot = candidateAngles
        .map((offset) => baseAngle + offset)
        .map((angle) => ({
          x: mover.container.x + Math.cos(angle) * push,
          y: mover.container.y + Math.sin(angle) * push,
        }))
        .find(({ x, y }) => canPlaceAgent(mover, x, y, bundles));

      if (separationSpot) {
        mover.container.position.set(Math.round(separationSpot.x), Math.round(separationSpot.y));
      } else {
        // Leave the agent in place for this frame, then force a fresh route;
        // this breaks two-agent deadlocks at doors without teleporting either
        // one through a wall or piece of furniture.
        mover.path = [];
        mover.pathIndex = 0;
        mover.blockedFor = 1;
        mover.wanderWait = 0;
      }
    }
  }
}

function advanceAlongPath(
  bundle: SpriteBundle,
  sprites: Map<string, SpriteBundle>,
  speed: number,
  dt: number
): "idle" | "moving" | "blocked" | "arrived" {
  if (bundle.pathIndex >= bundle.path.length) return "idle";
  let remaining = speed * dt;

  while (remaining > 0 && bundle.pathIndex < bundle.path.length) {
    const waypoint = bundle.path[bundle.pathIndex];
    const dx = waypoint.x - bundle.container.x;
    const dy = waypoint.y - bundle.container.y;
    const distance = Math.hypot(dx, dy);
    const step = Math.min(remaining, distance);
    const nextX = distance === 0 ? waypoint.x : bundle.container.x + (dx / distance) * step;
    const nextY = distance === 0 ? waypoint.y : bundle.container.y + (dy / distance) * step;

    if (overlapsAnotherAgent(sprites, bundle, nextX, nextY)) return "blocked";
    bundle.container.x = Math.round(nextX);
    bundle.container.y = Math.round(nextY);
    remaining -= step;

    if (distance <= step + 0.5) {
      bundle.container.position.set(waypoint.x, waypoint.y);
      bundle.pathIndex += 1;
    } else {
      break;
    }
  }

  return bundle.pathIndex >= bundle.path.length ? "arrived" : "moving";
}

function tick(
  sprites: Map<string, SpriteBundle>,
  agents: Agent[],
  progressByAgent: Record<string, string>,
  selectedId: string | null,
  securityAlertAgentIds: Set<string>,
  collaborationRoomByAgent: Record<string, number>,
  t: Translations,
  deltaFrames: number
): void {
  // Cap long background-tab frames so an agent cannot visually teleport
  // through a room when the tab becomes active again.
  const dt = Math.min(deltaFrames / 60, 0.1);

  agents.forEach((agent, i) => {
    const bundle = sprites.get(agent.id);
    if (!bundle) return;

    bundle.wanderPhase += dt;
    const atDesk = isAtDesk(agent.state);
    const meetingDestination = meetingDestinationFor(agent, agents, collaborationRoomByAgent);
    const navigationMode = meetingDestination ? "meeting" : atDesk ? "desk" : "wander";
    const workstation = WORKSTATIONS[i % WORKSTATIONS.length];
    const navigationDestination = meetingDestination ?? workstation.seat;
    const desiredTarget = tileToScreen(navigationDestination[0], navigationDestination[1]);

    if (navigationMode !== bundle.navigationMode) {
      bundle.navigationMode = navigationMode;
      bundle.wanderWait = 0;
      if (navigationMode !== "wander") setRoute(bundle, navigationDestination, sprites);
    }

    if (
      navigationMode !== "wander" &&
      (Math.hypot(bundle.destination.x - desiredTarget.x, bundle.destination.y - desiredTarget.y) > 2 ||
        (bundle.pathIndex >= bundle.path.length &&
          Math.hypot(bundle.destination.x - bundle.container.x, bundle.destination.y - bundle.container.y) > 2))
    ) {
      setRoute(bundle, navigationDestination, sprites);
    }

    if (!atDesk && bundle.pathIndex >= bundle.path.length) {
      bundle.wanderWait -= dt;
      if (bundle.wanderWait <= 0) pickRoamDestination(bundle, sprites);
    }

    const movement = advanceAlongPath(bundle, sprites, navigationMode === "meeting" ? 72 : atDesk ? 86 : 48, dt);
    if (movement === "arrived" && navigationMode === "wander") {
      bundle.wanderWait = 1.5 + Math.random() * 3.5;
    } else if (movement === "blocked") {
      bundle.blockedFor += dt;
      if (bundle.blockedFor >= 0.8) {
        if (navigationMode !== "wander") {
          setRoute(bundle, navigationDestination, sprites);
        } else {
          pickRoamDestination(bundle, sprites);
        }
      }
    } else {
      bundle.blockedFor = 0;
    }

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
      const nextBubbleText = t.lang === "zh-TW" ? t.officeWorkingMessage : truncate(message, 44);
      if (bundle.bubbleText !== nextBubbleText) {
        bundle.bubble.removeChildren().forEach((child) => child.destroy());
        drawTaskBubble(bundle.bubble, nextBubbleText);
        bundle.bubbleText = nextBubbleText;
      }
      bundle.bubble.visible = true;
    } else if (agent.state === "waiting") {
      const waiting = t.officeWaitingMessage;
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

  separateAgents(sprites);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
