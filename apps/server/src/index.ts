import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { Orchestrator, GoalCoordinator, KNOWN_CAPABILITIES, type Agent, type OfficeEvent } from "@ai-office/core";
import { GitRepoGuard, createDefaultCredentialRouter } from "@ai-office/core/node";
import { ClaudeCodeAdapter } from "@ai-office/adapter-claude-code";
import { OpenCodeAdapter } from "@ai-office/adapter-opencode";
import { AnthropicMasterBrain } from "@ai-office/adapter-master-anthropic";

const DEFAULT_SERVER_PORT = 43117;
const PORT = Number(process.env.AI_OFFICE_SERVER_PORT ?? process.env.PORT ?? DEFAULT_SERVER_PORT);

// Layer-1 safety net (see SECURITY.md): this project's own checkout must
// never be modified by worker execution, regardless of what workspacePath a
// task actually targets. apps/server/src/index.ts -> apps/server/src -> up
// 3 levels lands at the repo root (independent of npm workspaces' own cwd,
// which is apps/server, not the repo root).
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

// Fixed roster for this phase: a stand-in for a future "what can this agent
// do" profile. Master LLM capability inference would populate this
// differently later, but the Orchestrator's matching logic wouldn't change.
// agent-04/05 also double as the mixed-runtime demo: same capability
// class as v0.3, now backed by a different CLI underneath.
const AGENT_ROSTER: Record<string, { eligibleCapabilities: string[]; runtime: string }> = {
  "agent-01": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code" },
  "agent-02": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code" },
  "agent-03": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code" },
  "agent-04": { eligibleCapabilities: ["frontend", "docs"], runtime: "opencode" },
  "agent-05": { eligibleCapabilities: ["frontend", "docs"], runtime: "opencode" },
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

// GoalCoordinator observes every event the Orchestrator broadcasts (in
// addition to the events reaching clients as usual) so it can tell when all
// subtasks of one Master-planned goal have settled. Declared with `let` and
// assigned after `orchestrator` because the two reference each other; by the
// time any event actually fires, both are constructed.
let goalCoordinator: GoalCoordinator;

// v0.7: one router shared by every provider-authenticated piece of this
// server (both CLI adapters + MasterBrain) so a credential added/failed in
// one place is visible everywhere that resolves the same provider. See
// packages/core/src/credentials.
const credentialRouter = createDefaultCredentialRouter((statuses) => {
  broadcast({ type: "credential_status_changed", sources: statuses });
});

const orchestrator = new Orchestrator({
  adapters: {
    "claude-code": new ClaudeCodeAdapter(credentialRouter),
    opencode: new OpenCodeAdapter(credentialRouter),
  },
  workspaceGuard: new GitRepoGuard(REPO_ROOT),
  broadcast: (event) => {
    broadcast(event);
    goalCoordinator.observe(event);
  },
});

// Constructing this never throws even without ANTHROPIC_API_KEY set — see
// AnthropicMasterBrain's constructor. The v0.1-v0.4 manual task path below
// must keep working regardless of whether Master planning is configured.
const master = new AnthropicMasterBrain(credentialRouter);
goalCoordinator = new GoalCoordinator({ orchestrator, master, broadcast });

function makeAgent(id: string, runtime: string, eligibleCapabilities: string[]): Agent {
  const now = new Date().toISOString();
  return {
    id,
    state: "available",
    runtime,
    eligibleCapabilities,
    capabilities: [],
    createdAt: now,
    updatedAt: now,
  };
}

for (const [id, { runtime, eligibleCapabilities }] of Object.entries(AGENT_ROSTER)) {
  orchestrator.registerAgent(makeAgent(id, runtime, eligibleCapabilities));
}

wss.on("connection", (socket) => {
  clients.add(socket);
  socket.send(
    JSON.stringify({
      type: "snapshot",
      agents: orchestrator.listAgents(),
      tasks: orchestrator.listTasks(),
      credentials: credentialRouter.listStatuses(),
    })
  );
  socket.on("close", () => clients.delete(socket));
});

app.get("/api/credentials", (_req, res) => {
  res.json(credentialRouter.listStatuses());
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

// Separate from POST /api/tasks above: the manual "user picks capabilities"
// path is unchanged and stays fully available. This path hands the whole
// decomposition + capability judgment to the Master instead.
app.post("/api/goals", (req, res) => {
  const { goal, workspacePath } = req.body ?? {};
  if (typeof goal !== "string" || !goal.trim()) {
    res.status(400).json({ error: "goal is required" });
    return;
  }
  if (typeof workspacePath !== "string" || !workspacePath.trim()) {
    res.status(400).json({ error: "workspacePath is required" });
    return;
  }

  const { goalId } = goalCoordinator.submitGoal(goal, workspacePath);
  res.status(202).json({ goalId });
});

httpServer.listen(PORT, () => {
  console.log(`[ai-office] server listening on http://localhost:${PORT}`);
  // v0.7: surfaced at startup instead of only discovered when a live call
  // fails (that's exactly what v0.6.1's smoke test hit) — id/provider/
  // available only, never the secret value itself.
  console.log("[ai-office] credential sources:");
  for (const s of credentialRouter.listStatuses()) {
    console.log(`  - ${s.provider}/${s.id}: ${s.available ? "available" : "unavailable"}`);
  }
  if (!credentialRouter.resolve("anthropic")) {
    console.warn(
      "[ai-office] warning: no usable Anthropic credential detected — POST /api/goals (Master planning) " +
        "will fail with a clear authFailure until ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is set. " +
        "See README 'Setting up the Master'."
    );
  }
});
