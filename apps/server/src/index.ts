import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import {
  Orchestrator,
  GoalCoordinator,
  KNOWN_CAPABILITIES,
  type Agent,
  type BackendProfileRegistry,
  type OfficeEvent,
} from "@ai-office/core";
import { GitRepoGuard, createDefaultCredentialRouter } from "@ai-office/core/node";
import { ClaudeCodeAdapter } from "@ai-office/adapter-claude-code";
import { OpenCodeAdapter } from "@ai-office/adapter-opencode";
import { AnthropicMasterBrain } from "@ai-office/adapter-master-anthropic";
import { startFormatTranslationProxy } from "./proxy-server.js";
import { AgentBackendAssignmentStore } from "./agent-backend-assignments.js";
import { BackendProfileStore, BackendProfileValidationError } from "./backend-profile-store.js";

const DEFAULT_SERVER_PORT = 43117;
const PORT = Number(process.env.AI_OFFICE_SERVER_PORT ?? process.env.PORT ?? DEFAULT_SERVER_PORT);
// v0.9: one after the default web port (43118) — see scripts/dev.mjs for
// that numbering. Falls back to the next free port via selectAvailablePort
// (packages/core/src/runtime/port-select.ts), same "try preferred, then
// walk upward" behavior as v0.7.3's server/web port selection.
const DEFAULT_PROXY_PORT = 43119;
const PROXY_PORT = Number(process.env.AI_OFFICE_PROXY_PORT ?? DEFAULT_PROXY_PORT);

// Layer-1 safety net (see SECURITY.md): this project's own checkout must
// never be modified by worker execution, regardless of what workspacePath a
// task actually targets. apps/server/src/index.ts -> apps/server/src -> up
// 3 levels lands at the repo root (independent of npm workspaces' own cwd,
// which is apps/server, not the repo root).
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

// v0.10: this server's local, single-operator persisted state — backend
// profile definitions and per-agent profile assignments added/edited
// through the management UI (BackendProfileStore / AgentBackendAssignmentStore
// below). Deliberately plain JSON files, not a database: see the v0.10 build
// prompt's explicit "not an enterprise config management system" scope note.
const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));

// v0.8: per-agent API backend for claude-code agents, resolved to per-process
// env overrides by ClaudeCodeAdapter (packages/adapters/claude-code) via
// resolveBackendEnv — never through cc-switch itself; see
// docs/cc-switch-research.md for why. "official" isn't listed here: it's the
// implicit default meaning "resolve the shared CredentialRouter pool below,
// unchanged since v0.7". Each entry's actual secret lives only in this
// server's own process env (the two var names below), set by the operator —
// never hardcoded in source, never read from cc-switch's local store at
// runtime.
//
// v0.10: this is now only the first-run *seed* for BackendProfileStore
// below, not the live registry — once apps/server/data/backend-profiles.json
// exists (created on first startup, or as soon as the management UI adds or
// edits a profile), that file is authoritative and this constant is never
// consulted again. Renamed from BACKEND_PROFILES to make that explicit.
const DEFAULT_BACKEND_PROFILES: BackendProfileRegistry = {
  nvidia: {
    id: "nvidia",
    label: "NVIDIA API",
    baseUrlEnvVar: "AI_OFFICE_BACKEND_NVIDIA_BASE_URL",
    authTokenEnvVar: "AI_OFFICE_BACKEND_NVIDIA_AUTH_TOKEN",
    // v0.8's assumption, made explicit by v0.9's apiFormat field: NVIDIA's
    // endpoint speaks the Anthropic Messages API shape already, so this
    // profile passes through the local proxy unmodified (see
    // proxy-server.ts) — byte-identical behavior to v0.8's direct routing.
    apiFormat: "anthropic",
  },
  // v0.9 demo/test profile: a backend that only speaks OpenAI Chat
  // Completions, proving the proxy's translation path (not just
  // passthrough) end to end. Start apps/server/src/dev/mock-openai-backend.ts
  // and point AI_OFFICE_BACKEND_MOCK_OPENAI_BASE_URL at it to exercise this —
  // see docs/api-format-translation.md "Testing the translation path".
  "mock-openai": {
    id: "mock-openai",
    label: "Mock OpenAI Backend (dev/test)",
    baseUrlEnvVar: "AI_OFFICE_BACKEND_MOCK_OPENAI_BASE_URL",
    authTokenEnvVar: "AI_OFFICE_BACKEND_MOCK_OPENAI_AUTH_TOKEN",
    apiFormat: "openai-chat-completions",
  },
};

// Fixed roster for this phase: a stand-in for a future "what can this agent
// do" profile. Master LLM capability inference would populate this
// differently later, but the Orchestrator's matching logic wouldn't change.
// agent-04/05 also double as the mixed-runtime demo: same capability
// class as v0.3, now backed by a different CLI underneath. agent-02 doubles
// as the mixed-backend demo (v0.8): same runtime as agent-01/03, routed
// through a different API backend so it doesn't spend the official
// Anthropic quota those two use.
//
// v0.10: each entry's backendProfile is only the *default* now — the
// management UI's per-agent reassignment (PUT /api/agents/:id/backend-profile)
// persists an override in AgentBackendAssignmentStore that takes priority;
// see the `resolve()` calls below where agents are actually registered.
const AGENT_ROSTER: Record<string, { eligibleCapabilities: string[]; runtime: string; backendProfile?: string }> = {
  "agent-01": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code" },
  "agent-02": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code", backendProfile: "nvidia" },
  "agent-03": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code" },
  "agent-04": { eligibleCapabilities: ["frontend", "docs"], runtime: "opencode" },
  "agent-05": { eligibleCapabilities: ["frontend", "docs"], runtime: "opencode" },
  // v0.9 demo: same runtime/capabilities as agent-01/03, routed through the
  // openai-chat-completions mock profile above instead of Anthropic's own
  // format, to keep an always-registered example of the translated path
  // (not just passthrough) alongside agent-02's anthropic-format one.
  "agent-06": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code", backendProfile: "mock-openai" },
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

// One router shared by CLI adapters and MasterBrain for non-secret status.
// MasterBrain resolves only the single `claude-code-cli-session` source; it
// deliberately never resolves the Anthropic API-key pool used by workers.
const credentialRouter = createDefaultCredentialRouter((statuses) => {
  broadcast({ type: "credential_status_changed", sources: statuses });
});

// v0.10: persisted backend-profile definitions and per-agent overrides —
// see backend-profile-store.ts and agent-backend-assignments.ts. Constructed
// before the proxy/orchestrator below so both are handed
// backendProfileStore.registry itself (not a copy), and agents are
// registered with their resolved (persisted-override-or-default) profile.
const backendProfileStore = new BackendProfileStore(DEFAULT_BACKEND_PROFILES, `${DATA_DIR}backend-profiles.json`);
const agentAssignments = new AgentBackendAssignmentStore(`${DATA_DIR}agent-backend-assignments.json`);

// v0.9: started before any adapter so ClaudeCodeAdapter always has a real
// proxy port to point backendProfile-routed agents at. Only agents with a
// backendProfile set ever talk to it — an "official" agent's ANTHROPIC_BASE_URL
// is unchanged from v0.7/v0.8, see ClaudeCodeAdapter's constructor comment.
const proxy = await startFormatTranslationProxy(backendProfileStore.registry, PROXY_PORT);
const proxyBaseUrl = `http://127.0.0.1:${proxy.port}`;

const orchestrator = new Orchestrator({
  adapters: {
    "claude-code": new ClaudeCodeAdapter(credentialRouter, backendProfileStore.registry, proxyBaseUrl),
    opencode: new OpenCodeAdapter(credentialRouter),
  },
  workspaceGuard: new GitRepoGuard(REPO_ROOT),
  broadcast: (event) => {
    broadcast(event);
    goalCoordinator.observe(event);
  },
});

// Constructing this never throws without ANTHROPIC_API_KEY: Master uses the
// logged-in Claude Code CLI subscription session, and the manual task path
// remains independent of Master planning.
const master = new AnthropicMasterBrain(credentialRouter);
goalCoordinator = new GoalCoordinator({ orchestrator, master, broadcast });

function makeAgent(id: string, runtime: string, eligibleCapabilities: string[], backendProfile?: string): Agent {
  const now = new Date().toISOString();
  return {
    id,
    state: "available",
    runtime,
    backendProfile,
    eligibleCapabilities,
    capabilities: [],
    createdAt: now,
    updatedAt: now,
  };
}

for (const [id, { runtime, eligibleCapabilities, backendProfile }] of Object.entries(AGENT_ROSTER)) {
  const resolvedBackendProfile = agentAssignments.resolve(id, backendProfile);
  orchestrator.registerAgent(makeAgent(id, runtime, eligibleCapabilities, resolvedBackendProfile));
}

wss.on("connection", (socket) => {
  clients.add(socket);
  socket.send(
    JSON.stringify({
      type: "snapshot",
      agents: orchestrator.listAgents(),
      tasks: orchestrator.listTasks(),
      credentials: credentialRouter.listStatuses(),
      // v0.10: full management-UI-ready info (id/label/apiFormat/env var
      // *names*/available) — computed fresh per connection since env-var
      // availability and the registry itself can both change at runtime.
      // Never baseUrlEnvVar/authTokenEnvVar *values*.
      backendProfiles: backendProfileStore.list(),
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

// v0.10: Credential/Backend Profile management UI — see
// apps/web/src/BackendProfilesPanel.tsx. Every response here is
// BackendProfileClientInfo shaped: id/label/apiFormat/env-var-*names*/
// available, never an env var's actual value.
app.get("/api/backend-profiles", (_req, res) => {
  res.json(backendProfileStore.list());
});

app.post("/api/backend-profiles", (req, res) => {
  const { id, label, apiFormat, baseUrlEnvVar, authTokenEnvVar, modelOverrideEnvVar } = req.body ?? {};
  if (
    typeof id !== "string" ||
    typeof label !== "string" ||
    typeof apiFormat !== "string" ||
    typeof baseUrlEnvVar !== "string" ||
    typeof authTokenEnvVar !== "string" ||
    (modelOverrideEnvVar !== undefined && typeof modelOverrideEnvVar !== "string")
  ) {
    res.status(400).json({ error: "id, label, apiFormat, baseUrlEnvVar, and authTokenEnvVar (all strings) are required; modelOverrideEnvVar is an optional string" });
    return;
  }
  try {
    backendProfileStore.create({ id, label, apiFormat, baseUrlEnvVar, authTokenEnvVar, modelOverrideEnvVar });
    broadcast({ type: "backend_profiles_changed", profiles: backendProfileStore.list() });
    res.status(201).json(backendProfileStore.list().find((p) => p.id === id));
  } catch (err) {
    if (err instanceof BackendProfileValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

app.put("/api/backend-profiles/:id", (req, res) => {
  const { label, apiFormat, baseUrlEnvVar, authTokenEnvVar, modelOverrideEnvVar } = req.body ?? {};
  try {
    backendProfileStore.update(req.params.id, { label, apiFormat, baseUrlEnvVar, authTokenEnvVar, modelOverrideEnvVar });
    broadcast({ type: "backend_profiles_changed", profiles: backendProfileStore.list() });
    res.json(backendProfileStore.list().find((p) => p.id === req.params.id));
  } catch (err) {
    if (err instanceof BackendProfileValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// v0.10: repoints an already-registered agent at a different backend
// profile (or "official"/null to clear it), persisted so it survives a
// restart — see agent-backend-assignments.ts. Takes effect starting with
// that agent's next dispatched task, no restart required (see
// Orchestrator.setAgentBackendProfile).
app.put("/api/agents/:id/backend-profile", (req, res) => {
  const agent = orchestrator.getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: `Unknown agent "${req.params.id}"` });
    return;
  }
  if (agent.runtime !== "claude-code") {
    res.status(400).json({
      error: `Agent "${agent.id}" runs on "${agent.runtime}", which never reads backendProfile — only claude-code agents can be reassigned.`,
    });
    return;
  }

  const raw = req.body?.backendProfile;
  if (raw !== null && raw !== undefined && typeof raw !== "string") {
    res.status(400).json({ error: "backendProfile must be a string profile id, or null/undefined for official" });
    return;
  }
  const backendProfile = raw === null || raw === undefined || raw === "official" ? undefined : raw;
  if (backendProfile !== undefined && !backendProfileStore.registry[backendProfile]) {
    res.status(400).json({ error: `Unknown backend profile "${backendProfile}"` });
    return;
  }

  orchestrator.setAgentBackendProfile(agent.id, backendProfile);
  agentAssignments.set(agent.id, backendProfile);
  res.json(orchestrator.getAgent(agent.id));
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
  const apiKeyState = process.env.ANTHROPIC_API_KEY?.trim() ? "set" : "unset";
  const authTokenState = process.env.ANTHROPIC_AUTH_TOKEN?.trim() ? "set" : "unset";
  const baseUrlState = process.env.ANTHROPIC_BASE_URL?.trim() ? "set" : "unset";
  console.log("[ai-office] Master Brain: Claude Code CLI headless (`claude -p --output-format json`)");
  console.log("[ai-office] Master Brain auth: Claude.ai Pro/Max subscription login; Console API keys are not used");
  console.log(
    `[ai-office] Master Brain parent API env: ANTHROPIC_API_KEY=${apiKeyState}, ANTHROPIC_AUTH_TOKEN=${authTokenState}, ANTHROPIC_BASE_URL=${baseUrlState}; all are stripped from the Master subprocess`
  );

  // v0.8: same "surface at startup, not only on first dispatch" reasoning as
  // the credential-source logging above — id/label/which env vars only,
  // never the values. Agents pinned to a profile missing its env var(s)
  // will still register and appear "available", but every task dispatched
  // to them fails fast with backendProfileError instead of silently using
  // the official credential — see BackendProfileError.
  //
  // v0.10: reads resolved agent state (roster default + any persisted
  // management-UI override), not the AGENT_ROSTER constant directly.
  const usedProfiles = new Set(
    orchestrator
      .listAgents()
      .map((a) => a.backendProfile)
      .filter((p): p is string => Boolean(p))
  );
  if (usedProfiles.size > 0) {
    console.log("[ai-office] backend profiles in use:");
    for (const id of usedProfiles) {
      const profile = backendProfileStore.registry[id];
      if (!profile) {
        console.warn(`  - "${id}": not registered in backend-profiles.json — every agent using it will fail fast.`);
        continue;
      }
      const ready = Boolean(process.env[profile.baseUrlEnvVar]) && Boolean(process.env[profile.authTokenEnvVar]);
      console.log(
        `  - ${id} (${profile.label}): ${ready ? "ready" : `missing ${profile.baseUrlEnvVar} and/or ${profile.authTokenEnvVar}`}`
      );
    }
  }
  console.log(
    `[ai-office] backend profile / agent-assignment data persisted under ${DATA_DIR} — edit via the "Backend & Credentials" panel in the web UI, not by hand.`
  );
});
