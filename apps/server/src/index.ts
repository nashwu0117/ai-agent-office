import { createServer } from "node:http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { Orchestrator, type Agent, type OfficeEvent } from "@ai-office/core";
import { ClaudeCodeAdapter } from "@ai-office/adapter-claude-code";

const PORT = Number(process.env.PORT ?? 4500);
const AGENT_COUNT = 5;

const app = express();
app.use(express.json());

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const clients = new Set<WebSocket>();

function broadcast(event: OfficeEvent): void {
  const payload = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

const orchestrator = new Orchestrator({
  adapter: new ClaudeCodeAdapter(),
  broadcast,
});

function makeAgent(id: string): Agent {
  const now = new Date().toISOString();
  return {
    id,
    state: "available",
    runtime: "claude-code",
    capabilities: [],
    createdAt: now,
    updatedAt: now,
  };
}

for (let i = 1; i <= AGENT_COUNT; i += 1) {
  orchestrator.registerAgent(makeAgent(`agent-${String(i).padStart(2, "0")}`));
}

wss.on("connection", (socket) => {
  clients.add(socket);
  socket.send(JSON.stringify({ type: "snapshot", agents: orchestrator.listAgents() }));
  socket.on("close", () => clients.delete(socket));
});

app.get("/api/agents", (_req, res) => {
  res.json(orchestrator.listAgents());
});

app.get("/api/tasks", (_req, res) => {
  res.json(orchestrator.listTasks());
});

app.post("/api/tasks", async (req, res) => {
  const { description, workspacePath, title } = req.body ?? {};
  if (typeof description !== "string" || !description.trim()) {
    res.status(400).json({ error: "description is required" });
    return;
  }
  if (typeof workspacePath !== "string" || !workspacePath.trim()) {
    res.status(400).json({ error: "workspacePath is required" });
    return;
  }

  try {
    const task = await orchestrator.submitTask({ description, workspacePath, title });
    res.status(202).json(task);
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

httpServer.listen(PORT, () => {
  console.log(`[ai-office] server listening on http://localhost:${PORT}`);
});
