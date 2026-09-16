import { createServer } from "node:http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { Orchestrator, KNOWN_CAPABILITIES, type Agent, type OfficeEvent } from "@ai-office/core";
import { ClaudeCodeAdapter } from "@ai-office/adapter-claude-code";

const PORT = Number(process.env.PORT ?? 4500);

// Fixed roster for this phase: a stand-in for a future "what can this agent
// do" profile. Master LLM capability inference would populate this
// differently later, but the Orchestrator's matching logic wouldn't change.
const AGENT_ELIGIBILITY: Record<string, string[]> = {
  "agent-01": ["backend", "testing"],
  "agent-02": ["backend", "testing"],
  "agent-03": ["backend", "testing"],
  "agent-04": ["frontend", "docs"],
  "agent-05": ["frontend", "docs"],
};

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

function makeAgent(id: string, eligibleCapabilities: string[]): Agent {
  const now = new Date().toISOString();
  return {
    id,
    state: "available",
    runtime: "claude-code",
    eligibleCapabilities,
    capabilities: [],
    createdAt: now,
    updatedAt: now,
  };
}

for (const [id, eligibleCapabilities] of Object.entries(AGENT_ELIGIBILITY)) {
  orchestrator.registerAgent(makeAgent(id, eligibleCapabilities));
}

wss.on("connection", (socket) => {
  clients.add(socket);
  socket.send(
    JSON.stringify({ type: "snapshot", agents: orchestrator.listAgents(), tasks: orchestrator.listTasks() })
  );
  socket.on("close", () => clients.delete(socket));
});

app.get("/api/agents", (_req, res) => {
  res.json(orchestrator.listAgents());
});

app.get("/api/tasks", (_req, res) => {
  res.json(orchestrator.listTasks());
});

app.post("/api/tasks", async (req, res) => {
  const { description, workspacePath, title, requiredCapabilities } = req.body ?? {};
  if (typeof description !== "string" || !description.trim()) {
    res.status(400).json({ error: "description is required" });
    return;
  }
  if (typeof workspacePath !== "string" || !workspacePath.trim()) {
    res.status(400).json({ error: "workspacePath is required" });
    return;
  }
  let capabilities: string[] = [];
  if (requiredCapabilities !== undefined) {
    if (!Array.isArray(requiredCapabilities) || !requiredCapabilities.every((c) => typeof c === "string")) {
      res.status(400).json({ error: "requiredCapabilities must be an array of strings" });
      return;
    }
    const unknown = requiredCapabilities.filter((c) => !(KNOWN_CAPABILITIES as readonly string[]).includes(c));
    if (unknown.length > 0) {
      res.status(400).json({ error: `unknown capabilities: ${unknown.join(", ")}` });
      return;
    }
    capabilities = requiredCapabilities;
  }

  try {
    const task = await orchestrator.submitTask({
      description,
      workspacePath,
      title,
      requiredCapabilities: capabilities,
    });
    res.status(202).json(task);
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

httpServer.listen(PORT, () => {
  console.log(`[ai-office] server listening on http://localhost:${PORT}`);
});
