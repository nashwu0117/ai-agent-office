import { useEffect, useRef } from "react";
import { Application, Container, Graphics, Text } from "pixi.js";
import type { Agent, AgentState } from "@ai-office/core";

const WIDTH = 900;
const HEIGHT = 560;

const WORKSTATION_Y = 150;
const PUBLIC_Y_MIN = 380;
const PUBLIC_Y_MAX = 500;

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

interface SpriteBundle {
  container: Container;
  body: Graphics;
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
      await app.init({ width: WIDTH, height: HEIGHT, background: 0x111827, antialias: true });
      if (destroyed || !hostRef.current) return;
      hostRef.current.appendChild(app.canvas);
      appRef.current = app;

      drawZones(app.stage);

      app.ticker.add((ticker) => {
        syncSprites(app.stage, spritesRef.current, agentsRef.current, onSelectRef.current);
        tick(spritesRef.current, agentsRef.current, progressRef.current, selectedRef.current, ticker.deltaTime);
      });
    })();

    return () => {
      destroyed = true;
      appRef.current?.destroy(true, { children: true });
      appRef.current = null;
      spritesRef.current.clear();
    };
  }, []);

  return <div ref={hostRef} className="office-canvas" />;
}

function drawZones(stage: Container): void {
  const workLabel = new Text({
    text: "Workstations",
    style: { fill: 0x9ca3af, fontSize: 14, fontFamily: "monospace" },
  });
  workLabel.position.set(16, 16);
  stage.addChild(workLabel);

  const publicZone = new Graphics()
    .rect(0, PUBLIC_Y_MIN - 20, WIDTH, PUBLIC_Y_MAX - PUBLIC_Y_MIN + 60)
    .fill({ color: 0x1f2937, alpha: 0.6 });
  stage.addChild(publicZone);

  const publicLabel = new Text({
    text: "Public / Talent Area",
    style: { fill: 0x9ca3af, fontSize: 14, fontFamily: "monospace" },
  });
  publicLabel.position.set(16, PUBLIC_Y_MIN - 16);
  stage.addChild(publicLabel);
}

function seatX(index: number, total: number): number {
  const margin = 90;
  const span = WIDTH - margin * 2;
  return margin + (span * (index + 0.5)) / total;
}

function homeX(index: number, total: number): number {
  return seatX(index, total);
}

function syncSprites(
  stage: Container,
  sprites: Map<string, SpriteBundle>,
  agents: Agent[],
  onSelect: (id: string) => void
): void {
  for (const agent of agents) {
    if (sprites.has(agent.id)) continue;

    const container = new Container();
    container.eventMode = "static";
    container.cursor = "pointer";
    container.on("pointerdown", () => onSelect(agent.id));

    const body = new Graphics();
    container.addChild(body);

    const label = new Text({
      text: agent.id,
      style: { fill: 0xffffff, fontSize: 11, fontFamily: "monospace" },
      anchor: 0.5,
    });
    label.position.set(0, 28);
    container.addChild(label);

    const bubble = new Text({
      text: "",
      style: {
        fill: 0xf9fafb,
        fontSize: 11,
        fontFamily: "monospace",
        wordWrap: true,
        wordWrapWidth: 160,
        align: "center",
      },
    });
    bubble.anchor.set(0.5, 1);
    bubble.position.set(0, -26);
    container.addChild(bubble);

    stage.addChild(container);

    const idx = Number(agent.id.split("-")[1] ?? "1") - 1;
    const startX = homeX(idx, 5);
    container.position.set(startX, PUBLIC_Y_MIN + 30);

    sprites.set(agent.id, {
      container,
      body,
      label,
      bubble,
      target: { x: startX, y: PUBLIC_Y_MIN + 30 },
      wanderPhase: Math.random() * 1000,
    });
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
  const byId = new Map(agents.map((a) => [a.id, a]));

  agents.forEach((agent, i) => {
    const bundle = sprites.get(agent.id);
    if (!bundle) return;

    const atDesk = isAtDesk(agent.state);
    if (atDesk) {
      bundle.target.x = seatX(i, agents.length);
      bundle.target.y = WORKSTATION_Y;
    } else {
      bundle.wanderPhase += dt;
      const wanderRange = 60;
      bundle.target.x = homeX(i, agents.length) + Math.sin(bundle.wanderPhase * 0.5) * wanderRange;
      bundle.target.y = PUBLIC_Y_MIN + 30 + Math.cos(bundle.wanderPhase * 0.3) * 20;
    }

    const speed = atDesk ? 0.06 : 0.02;
    bundle.container.x += (bundle.target.x - bundle.container.x) * Math.min(1, speed * (1 + dt));
    bundle.container.y += (bundle.target.y - bundle.container.y) * Math.min(1, speed * (1 + dt));

    const color = STATE_COLOR[agent.state] ?? 0x9ca3af;
    const isSelected = agent.id === selectedId;
    const seated = agent.state === "working" || agent.state === "waiting" || agent.state === "blocked";

    bundle.body.clear();
    if (isSelected) {
      bundle.body.circle(0, 0, 22).fill({ color: 0xffffff, alpha: 0.15 });
    }
    if (seated) {
      bundle.body.roundRect(-16, 4, 32, 14, 4).fill({ color: 0x4b5563 });
    }
    bundle.body.circle(0, seated ? -2 : 0, 16).fill({ color });
    bundle.body.circle(-5, seated ? -6 : -4, 2.5).fill({ color: 0x111827 });
    bundle.body.circle(5, seated ? -6 : -4, 2.5).fill({ color: 0x111827 });

    const message = progressByAgent[agent.id];
    if (agent.state === "working" && message) {
      bundle.bubble.text = truncate(message, 90);
      bundle.bubble.visible = true;
    } else if (agent.state === "error") {
      bundle.bubble.text = "error";
      bundle.bubble.visible = true;
    } else {
      bundle.bubble.visible = false;
    }
  });

  for (const [id, bundle] of sprites) {
    if (!byId.has(id)) {
      bundle.container.destroy({ children: true });
      sprites.delete(id);
    }
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
