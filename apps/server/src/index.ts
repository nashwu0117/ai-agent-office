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
import { ClineAdapter } from "@ai-office/adapter-cline";
import { CodexAdapter } from "@ai-office/adapter-codex";
import { AnthropicMasterBrain } from "@ai-office/adapter-master-anthropic";
import { startFormatTranslationProxy } from "./proxy-server.js";
import { AgentBackendAssignmentStore } from "./agent-backend-assignments.js";
import { BackendProfileStore, BackendProfileValidationError } from "./backend-profile-store.js";
import { DefaultBackendStore } from "./default-backend-store.js";

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
// v0.15: where BackendProfileStore auto-provisions a real value pasted into
// the management UI instead of an env var name — see backend-profile-store
// .ts's resolveEnvVarField and env-file-store.ts. Same file `tsx
// --env-file-if-exists=.env.local` (see package.json's start script) loads
// at process boot, so anything written here on a later edit takes effect
// immediately in-process and also survives the next restart.
const ENV_LOCAL_PATH = fileURLToPath(new URL("../.env.local", import.meta.url));

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
  // v0.15: the original v0.8 single-key "nvidia" profile was deleted at the
  // operator's request — they only want the three-key nvidia-1/2/3 spread
  // below, not this plus three more. Removed from here too (not just via
  // the DELETE API) so BackendProfileStore's mergeMissingDefaults doesn't
  // resurrect it as a "new default" on the next restart, the way it
  // correctly does for an id added by a genuinely newer version of this file.
  //
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

  // v0.13: three independent NVIDIA NIM backends (each its own API key, so
  // usage/quota is tracked separately per agent). Same apiFormat as the
  // hand-added "nvidia-real" profile in backend-profiles.json — see
  // docs/runtime-research-v0.13.md for why NVIDIA NIM speaks
  // openai-chat-completions, not Anthropic's own format, and needs
  // modelOverrideEnvVar (v0.11) for the same reason "nvidia-real" does.
  // See docs/backend-profiles-v0.13.md for exactly which env vars to set.
  "nvidia-1": {
    id: "nvidia-1",
    label: "NVIDIA API #1",
    baseUrlEnvVar: "AI_OFFICE_BACKEND_NVIDIA_1_BASE_URL",
    authTokenEnvVar: "AI_OFFICE_BACKEND_NVIDIA_1_AUTH_TOKEN",
    apiFormat: "openai-chat-completions",
    modelOverrideEnvVar: "AI_OFFICE_BACKEND_NVIDIA_1_MODEL",
  },
  "nvidia-2": {
    id: "nvidia-2",
    label: "NVIDIA API #2",
    baseUrlEnvVar: "AI_OFFICE_BACKEND_NVIDIA_2_BASE_URL",
    authTokenEnvVar: "AI_OFFICE_BACKEND_NVIDIA_2_AUTH_TOKEN",
    apiFormat: "openai-chat-completions",
    modelOverrideEnvVar: "AI_OFFICE_BACKEND_NVIDIA_2_MODEL",
  },
  "nvidia-3": {
    id: "nvidia-3",
    label: "NVIDIA API #3",
    baseUrlEnvVar: "AI_OFFICE_BACKEND_NVIDIA_3_BASE_URL",
    authTokenEnvVar: "AI_OFFICE_BACKEND_NVIDIA_3_AUTH_TOKEN",
    apiFormat: "openai-chat-completions",
    modelOverrideEnvVar: "AI_OFFICE_BACKEND_NVIDIA_3_MODEL",
  },

  // v0.13: three independent b.ai backends. b.ai's Messages endpoint
  // (docs.b.ai/llmservice/api) is the real Anthropic Messages protocol —
  // see docs/runtime-research-v0.13.md — so these are byte-passthrough
  // "anthropic" profiles, same wire behavior as the "nvidia" profile above.
  // v0.15: modelOverrideEnvVar now works for this apiFormat too (rewrites
  // the request body's `model` field in the proxy) — none hardcoded here
  // since none are set by default; the management UI's "Fetch models" +
  // click-to-set assigns one per profile on demand instead.
  "bai-1": {
    id: "bai-1",
    label: "b.ai API #1",
    baseUrlEnvVar: "AI_OFFICE_BACKEND_BAI_1_BASE_URL",
    authTokenEnvVar: "AI_OFFICE_BACKEND_BAI_1_AUTH_TOKEN",
    apiFormat: "anthropic",
  },
  "bai-2": {
    id: "bai-2",
    label: "b.ai API #2",
    baseUrlEnvVar: "AI_OFFICE_BACKEND_BAI_2_BASE_URL",
    authTokenEnvVar: "AI_OFFICE_BACKEND_BAI_2_AUTH_TOKEN",
    apiFormat: "anthropic",
  },
  "bai-3": {
    id: "bai-3",
    label: "b.ai API #3",
    baseUrlEnvVar: "AI_OFFICE_BACKEND_BAI_3_BASE_URL",
    authTokenEnvVar: "AI_OFFICE_BACKEND_BAI_3_AUTH_TOKEN",
    apiFormat: "anthropic",
  },

  // v0.13: platform.experientiallabs.ai. Its coding-agent setup doc has
  // Claude Code talk to /v1/messages — the real Anthropic Messages
  // protocol, not the OpenAI-shaped endpoints the same gateway also
  // exposes at other paths — see docs/runtime-research-v0.13.md. Same
  // byte-passthrough "anthropic" apiFormat as the b.ai profiles above.
  "experientiallabs-1": {
    id: "experientiallabs-1",
    label: "Experiential Labs API",
    baseUrlEnvVar: "AI_OFFICE_BACKEND_EXPERIENTIALLABS_1_BASE_URL",
    authTokenEnvVar: "AI_OFFICE_BACKEND_EXPERIENTIALLABS_1_AUTH_TOKEN",
    apiFormat: "anthropic",
  },
};

// Fixed roster for this phase: a stand-in for a future "what can this agent
// do" profile. Master LLM capability inference would populate this
// differently later, but the Orchestrator's matching logic wouldn't change.
// agent-04/05 also double as the mixed-runtime demo: same capability
// class as v0.3, now backed by a different CLI underneath. agent-08/09/10
// below now double as the mixed-backend demo agent-02 originally was (v0.8)
// — routed through a different API backend so they don't spend the official
// Anthropic quota agent-01/03 use; see v0.15's removal of agent-02's own
// backendProfile default.
//
// v0.10: each entry's backendProfile is only the *default* now — the
// management UI's per-agent reassignment (PUT /api/agents/:id/backend-profile)
// persists an override in AgentBackendAssignmentStore that takes priority;
// see the `resolve()` calls below where agents are actually registered.
const AGENT_ROSTER: Record<string, { eligibleCapabilities: string[]; runtime: string; backendProfile?: string }> = {
  "agent-01": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code" },
  // v0.15: was backendProfile: "nvidia" — that profile (a lone, pre-v0.13
  // leftover, separate from the nvidia-1/2/3 the operator actually wants)
  // has been deleted at their request; agent-02's own persisted override was
  // already "official" regardless, so this was dead weight, not a live change.
  "agent-02": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code" },
  "agent-03": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code" },
  "agent-04": { eligibleCapabilities: ["frontend", "docs"], runtime: "opencode" },
  "agent-05": { eligibleCapabilities: ["frontend", "docs"], runtime: "opencode" },
  // v0.15: was runtime: "claude-code", backendProfile: "mock-openai" (a
  // v0.9 demo of the translated-backend path that only does anything when
  // apps/server/src/dev/mock-openai-backend.ts is separately started by
  // hand — not useful day to day). Reassigned to a real, distinct runtime
  // instead, at the operator's request: CodexAdapter (OpenAI's Codex CLI,
  // its own `codex exec` process — not a claude-code backendProfile, an
  // entirely different adapter, see packages/adapters/codex). The
  // "mock-openai" BackendProfile itself is untouched for anyone who wants
  // to exercise the proxy's translation path directly.
  "agent-06": { eligibleCapabilities: ["backend", "testing"], runtime: "codex" },
  // v0.13: Cline CLI (free-quota runtime) — see
  // packages/adapters/cline and docs/runtime-research-v0.13.md.
  "agent-07": { eligibleCapabilities: ["frontend", "docs"], runtime: "cline" },
  // v0.13 Part D: agent-01/agent-03 above already cover the "2 official"
  // requirement; these seven are the new backend-profile-routed agents —
  // one per newly-registered profile (see DEFAULT_BACKEND_PROFILES above
  // and docs/backend-profiles-v0.13.md for their env vars).
  "agent-08": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code", backendProfile: "nvidia-1" },
  "agent-09": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code", backendProfile: "nvidia-2" },
  "agent-10": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code", backendProfile: "nvidia-3" },
  "agent-11": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code", backendProfile: "bai-1" },
  "agent-12": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code", backendProfile: "bai-2" },
  "agent-13": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code", backendProfile: "bai-3" },
  "agent-14": {
    eligibleCapabilities: ["backend", "testing"],
    runtime: "claude-code",
    backendProfile: "experientiallabs-1",
  },
};

const app = express();
app.use(express.json());

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

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
const backendProfileStore = new BackendProfileStore(DEFAULT_BACKEND_PROFILES, `${DATA_DIR}backend-profiles.json`, ENV_LOCAL_PATH);
const agentAssignments = new AgentBackendAssignmentStore(`${DATA_DIR}agent-backend-assignments.json`);
// v0.13 Part E: global "default backend profile" layer, applied only to
// agents with neither an explicit per-agent override nor an AGENT_ROSTER
// hardcoded default — see default-backend-store.ts's doc-comment for the
// full priority order.
const defaultBackendStore = new DefaultBackendStore(`${DATA_DIR}default-backend-profile.json`);

/** Priority: explicit per-agent override > AGENT_ROSTER's own default > global default > official (undefined). */
function resolveEffectiveBackendProfile(agentId: string, rosterDefault: string | undefined): string | undefined {
  if (agentAssignments.hasExplicitOverride(agentId)) return agentAssignments.resolve(agentId, rosterDefault);
  if (rosterDefault !== undefined) return rosterDefault;
  return defaultBackendStore.get() ?? undefined;
}

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
    cline: new ClineAdapter(credentialRouter),
    codex: new CodexAdapter(credentialRouter),
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
  const resolvedBackendProfile = resolveEffectiveBackendProfile(id, backendProfile);
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
      // v0.13 Part E: which profile id (or null for "official") every
      // not-otherwise-pinned claude-code agent currently falls back to.
      defaultBackendProfile: defaultBackendStore.get(),
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

// v0.15: refuses to delete a profile any currently-registered agent is
// actually pinned to (resolved effective backendProfile, not just AGENT_
// ROSTER's hardcoded default — an explicit override elsewhere could still
// point at it) so this can never silently strand an agent the way a
// hand-edited backend-profiles.json could.
app.delete("/api/backend-profiles/:id", (req, res) => {
  const inUseBy = orchestrator.listAgents().filter((a) => a.backendProfile === req.params.id);
  if (inUseBy.length > 0) {
    res.status(409).json({
      error: `Backend profile "${req.params.id}" is still assigned to ${inUseBy.map((a) => a.id).join(", ")} — reassign ${inUseBy.length === 1 ? "it" : "them"} first.`,
    });
    return;
  }
  try {
    backendProfileStore.delete(req.params.id);
    broadcast({ type: "backend_profiles_changed", profiles: backendProfileStore.list() });
    res.status(204).end();
  } catch (err) {
    if (err instanceof BackendProfileValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// v0.15: lets the management UI show which model ids a profile's own key
// actually has access to, instead of the operator guessing a string to paste
// into modelOverrideEnvVar's value in .env.local. Calls the provider's own
// GET {baseUrl}/models with that profile's real credential — never proxied
// through this server's stored state, never logged, never echoed back
// besides the model ids themselves (never secret). Both apiFormats this
// server supports happen to return the same `{ data: [{ id }] }` shape for
// their model-listing endpoint (OpenAI's convention, and Anthropic's own
// /v1/models — see Anthropic API docs), so one code path covers both.
app.get("/api/backend-profiles/:id/models", async (req, res) => {
  const profile = backendProfileStore.registry[req.params.id];
  if (!profile) {
    res.status(404).json({ error: `Backend profile "${req.params.id}" does not exist.` });
    return;
  }
  const baseUrl = process.env[profile.baseUrlEnvVar]?.trim();
  const authToken = process.env[profile.authTokenEnvVar]?.trim();
  if (!baseUrl || !authToken) {
    res.status(409).json({
      error: `Profile "${profile.id}" is missing ${profile.baseUrlEnvVar} and/or ${profile.authTokenEnvVar} on this server.`,
    });
    return;
  }

  const headers: Record<string, string> =
    profile.apiFormat === "anthropic"
      ? { "x-api-key": authToken, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${authToken}` };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, { headers, signal: controller.signal });
    if (!response.ok) {
      res.status(502).json({ error: `Provider returned ${response.status} ${response.statusText} for GET /models.` });
      return;
    }
    const body: unknown = await response.json();
    const data = (body as { data?: unknown })?.data;
    if (!Array.isArray(data)) {
      res.status(502).json({ error: "Provider's /models response didn't have the expected { data: [...] } shape." });
      return;
    }
    const models = data
      .map((entry) => (entry as { id?: unknown })?.id)
      .filter((id): id is string => typeof id === "string")
      .sort();
    res.json({ models });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: `Couldn't reach the provider's /models endpoint: ${message}` });
  } finally {
    clearTimeout(timeout);
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

// v0.13 Part E: the global default backend profile — see
// default-backend-store.ts and resolveEffectiveBackendProfile above. This
// is a separate layer *underneath* the per-agent override endpoint above,
// not a replacement for it.
app.get("/api/default-backend-profile", (_req, res) => {
  res.json({ backendProfile: defaultBackendStore.get() });
});

app.put("/api/default-backend-profile", (req, res) => {
  const raw = req.body?.backendProfile;
  if (raw !== null && raw !== undefined && typeof raw !== "string") {
    res.status(400).json({ error: "backendProfile must be a string profile id, or null/undefined for official" });
    return;
  }
  const backendProfile = raw === null || raw === undefined || raw === "official" ? null : raw;
  if (backendProfile !== null && !backendProfileStore.registry[backendProfile]) {
    res.status(400).json({ error: `Unknown backend profile "${backendProfile}"` });
    return;
  }

  defaultBackendStore.set(backendProfile);
  broadcast({ type: "default_backend_profile_changed", backendProfile });

  // Live-reapply to every claude-code agent that isn't individually pinned
  // (neither an explicit per-agent override nor an AGENT_ROSTER hardcoded
  // default) — each repointed agent also emits its own
  // agent_backend_profile_changed via Orchestrator.setAgentBackendProfile.
  for (const agent of orchestrator.listAgents()) {
    if (agent.runtime !== "claude-code") continue;
    if (agentAssignments.hasExplicitOverride(agent.id)) continue;
    if (AGENT_ROSTER[agent.id]?.backendProfile !== undefined) continue;
    orchestrator.setAgentBackendProfile(agent.id, backendProfile ?? undefined);
  }

  res.json({ backendProfile: defaultBackendStore.get() });
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
