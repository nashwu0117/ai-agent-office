import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import {
  Orchestrator,
  GoalCoordinator,
  HandoffCoordinator,
  KNOWN_CAPABILITIES,
  type Agent,
  type BackendProfile,
  type BackendProfileRegistry,
  type MasterBrain,
  type OfficeEvent,
} from "@ai-office/core";
import { GitRepoGuard, createDefaultCredentialRouter } from "@ai-office/core/node";
import { ClaudeCodeAdapter } from "@ai-office/adapter-claude-code";
import { OpenCodeAdapter } from "@ai-office/adapter-opencode";
import { ClineAdapter } from "@ai-office/adapter-cline";
import { CodexAdapter } from "@ai-office/adapter-codex";
import { AnthropicMasterBrain } from "@ai-office/adapter-master-anthropic";
import { CodexMasterBrain } from "@ai-office/adapter-master-codex";
import { startFormatTranslationProxy } from "./proxy-server.js";
import { AgentBackendAssignmentStore } from "./agent-backend-assignments.js";
import { BackendProfileStore, BackendProfileValidationError, type BackendProfileUpdate } from "./backend-profile-store.js";
import { DefaultBackendStore } from "./default-backend-store.js";
import { MasterBrainStore, type MasterBrainId } from "./master-brain-store.js";
import { requireAuth, registerAuthRoutes, isUpgradeRequestAuthenticated, logAuthStartupState } from "./auth.js";
import { dispatchLimiter, modelsLimiter, generalApiLimiter, revealSecretLimiter } from "./rate-limits.js";
import { removeEnvVars } from "./env-file-store.js";
import { loadAgentRoster, loadMaxConcurrentAgents, type AgentRoster } from "./agent-roster.js";

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
  // v0.21.1: the v0.9 "mock-openai" demo/test profile (a fake backend that
  // only spoke OpenAI Chat Completions, used to prove the proxy's
  // translation path itself works, end to end) was removed from this
  // operator-facing list at the operator's request — it kept showing up in
  // the Backend & Credentials panel with no clear explanation of what it
  // was, and it's not one of their real providers. The dev tool it pointed
  // at (apps/server/src/dev/mock-openai-backend.ts, `npm run mock-openai`)
  // and the translation-path test it enables are untouched — see
  // docs/api-format-translation.md "Testing the translation path" — this
  // just stops it from being permanently registered where every operator
  // session sees it.

  // v0.13: three independent NVIDIA NIM backends (each its own API key, so
  // usage/quota is tracked separately per agent). Same apiFormat as the
  // hand-added "nvidia-real" profile in backend-profiles.json — see
  // docs/runtime-research-v0.13.md for why NVIDIA NIM speaks
  // openai-chat-completions, not Anthropic's own format. NVIDIA NIM needs
  // its own model id rather than whatever Claude Code model string the CLI
  // sends — set that from the Backend & Credentials panel's per-role model
  // mapping / Fallback model fields (v0.21) once you have a key; see
  // docs/backend-profiles-v0.13.md for background.
  "nvidia-1": {
    id: "nvidia-1",
    label: "NVIDIA API #1",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    baseUrlEnvVar: "AI_OFFICE_BACKEND_NVIDIA_1_BASE_URL",
    authTokenEnvVar: "AI_OFFICE_BACKEND_NVIDIA_1_AUTH_TOKEN",
    apiFormat: "openai-chat-completions",
    fallbackModel: "openai/gpt-oss-20b",
  },
  "nvidia-2": {
    id: "nvidia-2",
    label: "NVIDIA API #2",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    baseUrlEnvVar: "AI_OFFICE_BACKEND_NVIDIA_2_BASE_URL",
    authTokenEnvVar: "AI_OFFICE_BACKEND_NVIDIA_2_AUTH_TOKEN",
    apiFormat: "openai-chat-completions",
    fallbackModel: "openai/gpt-oss-20b",
  },
  "nvidia-3": {
    id: "nvidia-3",
    label: "NVIDIA API #3",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    baseUrlEnvVar: "AI_OFFICE_BACKEND_NVIDIA_3_BASE_URL",
    authTokenEnvVar: "AI_OFFICE_BACKEND_NVIDIA_3_AUTH_TOKEN",
    apiFormat: "openai-chat-completions",
    fallbackModel: "openai/gpt-oss-20b",
  },

  openai: apiPreset("openai", "OpenAI", "https://api.openai.com/v1", "gpt-6-astra"),
  anthropic: apiPreset("anthropic", "Anthropic Claude", "https://api.anthropic.com", "claude-sonnet-5", "anthropic"),
  gemini: apiPreset("gemini", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai", "gemini-3.8-flash"),
  openrouter: apiPreset("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "openai/gpt-6-astra"),
  deepseek: apiPreset("deepseek", "DeepSeek", "https://api.deepseek.com", "deepseek-flash"),
  groq: apiPreset("groq", "Groq", "https://api.groq.com/openai/v1", "openai/gpt-oss-20b"),
  mistral: apiPreset("mistral", "Mistral AI", "https://api.mistral.ai/v1", "mistral-large-latest"),
  xai: apiPreset("xai", "xAI Grok", "https://api.x.ai/v1", "grok-4.7"),
  siliconflow: apiPreset("siliconflow", "SiliconFlow", "https://api.siliconflow.com/v1", "deepseek-ai/DeepSeek-V3"),
  qwen: apiPreset("qwen", "Alibaba Cloud Qwen", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "qwen-plus"),
  moonshot: apiPreset("moonshot", "Moonshot AI Kimi", "https://api.moonshot.ai/v1", "kimi-k2.6"),
};

function apiPreset(
  id: string,
  label: string,
  defaultBaseUrl: string,
  fallbackModel: string,
  apiFormat: BackendProfile["apiFormat"] = "openai-chat-completions"
): BackendProfile {
  const envId = id.toUpperCase().replace(/-/g, "_");
  return {
    id,
    label,
    defaultBaseUrl,
    baseUrlEnvVar: `AI_OFFICE_BACKEND_${envId}_BASE_URL`,
    authTokenEnvVar: `AI_OFFICE_BACKEND_${envId}_AUTH_TOKEN`,
    apiFormat,
    fallbackModel,
  };
}

const RETIRED_PRESET_LABELS: Record<string, string> = {
  "bai-1": "b.ai API #1",
  "bai-2": "b.ai API #2",
  "bai-3": "b.ai API #3",
  "experientiallabs-1": "Experiential Labs API",
  "vyceai-1": "vyceai API",
};

// Defaults preserve the 13-agent demo. Deployers can replace that roster
// with exact runtime counts in AI_OFFICE_AGENT_COUNTS and cap live CLI
// processes independently with AI_OFFICE_MAX_CONCURRENT_AGENTS.
const AGENT_ROSTER: AgentRoster = loadAgentRoster();

// v0.18: CORS + access-auth hardening for the Cloudflare Tunnel exposure —
// see auth.ts and SECURITY.md's sibling doc, and QUICKSTART.md's "Access
// control" section for the operator-facing writeup. Every origin this app
// is ever actually loaded from, no wildcard.
const WEB_PORT = Number(process.env.AI_OFFICE_WEB_PORT ?? 43118);
const EXTRA_ALLOWED_ORIGINS = (process.env.AI_OFFICE_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = new Set<string>([
  `http://localhost:${WEB_PORT}`,
  `http://127.0.0.1:${WEB_PORT}`,
  // Deployments with a different public origin can set
  // AI_OFFICE_ALLOWED_ORIGINS instead of editing this constant.
  ...EXTRA_ALLOWED_ORIGINS,
]);

class CorsOriginError extends Error {}

const app = express();
app.use(
  cors({
    origin(origin, callback) {
      // No Origin header at all: same-origin navigation, curl, or a
      // server-to-server call — nothing for CORS to enforce.
      if (!origin || ALLOWED_ORIGINS.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new CorsOriginError(`Origin "${origin}" is not allowed.`));
    },
    credentials: true,
  })
);
// Gives a disallowed origin a plain 403 instead of falling through to the
// generic 500 handler at the bottom of this file — this is an expected,
// named rejection, not an unexpected internal error.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof CorsOriginError) {
    res.status(403).json({ error: "Origin not allowed." });
    return;
  }
  next(err);
});
// v0.18: baseline security headers. Deliberately not a full helmet() config
// — this is a single-page app served through Vite's dev server in every
// deployment this project actually has, and a real Content-Security-Policy
// would need to be built and verified against that setup instead of copied
// in blind; these four are the broadly-safe, break-nothing baseline.
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  // Only honored by browsers when the response was actually received over
  // HTTPS (true for the Cloudflare Tunnel path, harmless no-op for plain
  // local HTTP dev) — see MDN's Strict-Transport-Security.
  res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  next();
});
app.use(express.json());
app.use("/api", generalApiLimiter);
// v0.18: registered before the blanket requireAuth below so /api/auth/status
// and /api/auth/login stay reachable with no session — see auth.ts.
registerAuthRoutes(app);
app.use("/api", requireAuth);

const httpServer = createServer(app);
const wss = new WebSocketServer({
  server: httpServer,
  path: "/ws",
  // v0.18: same auth check as the REST API — the initial WS "snapshot"
  // message hands a freshly-connected socket the full agents/tasks/
  // credential-status/backend-profiles state with no other gate, so this
  // upgrade handshake is exactly as sensitive as any /api route.
  verifyClient: (info, callback) => {
    if (isUpgradeRequestAuthenticated(info.req)) {
      callback(true);
      return;
    }
    callback(false, 401, "Unauthorized");
  },
});

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
// v0.22 Part C: same pattern — observes task_updated to detect a dependency
// handoff between two different agents. See HandoffCoordinator's own doc
// comment for the exact trigger.
let handoffCoordinator: HandoffCoordinator;

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
// One-time cleanup of the former obscure built-in rows. Match their old
// built-in labels so a user-created profile that reused one of these ids is
// left alone. Remove only those rows' own key/base-URL variables.
const retiredPresetIds = Object.entries(RETIRED_PRESET_LABELS)
  .filter(([id, label]) => backendProfileStore.registry[id]?.label === label)
  .map(([id]) => id);
const retiredProfiles = backendProfileStore.removeProfiles(retiredPresetIds);
const retiredEnvVars = retiredProfiles.flatMap((profile) => [profile.baseUrlEnvVar, profile.authTokenEnvVar]);
removeEnvVars(ENV_LOCAL_PATH, retiredEnvVars);
for (const envName of retiredEnvVars) delete process.env[envName];
agentAssignments.clearProfiles(retiredPresetIds);
defaultBackendStore.clearIfRetired(retiredPresetIds);

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
  maxConcurrentTasks: loadMaxConcurrentAgents(),
  broadcast: (event) => {
    broadcast(event);
    goalCoordinator.observe(event);
    handoffCoordinator.observe(event);
  },
});

// v0.22 Part B (+ v0.22.1 per-backend model choice): the fixed set of
// backends this server can drive the single Master planner with (see docs
// on why this couldn't just be another BackendProfile row). Constructing
// either never throws without its respective login/credential: both
// adapters resolve their own CredentialRouter provider lazily, at the first
// real plan()/summarize() call, not at construction time.
//
// v0.22.1: instances are no longer built once and kept forever — an
// operator picking a model (not just a backend) means the currently active
// instance needs to be rebuilt with that model baked into its own headless
// runner (see AnthropicMasterBrainOptions.model/CodexMasterBrainOptions.model),
// so buildMasterBrain() always constructs fresh from masterBrainStore's
// current persisted model for that id.
const MASTER_BRAIN_LABELS: Record<MasterBrainId, string> = {
  "claude-code": "Claude Code CLI (Claude.ai subscription login)",
  codex: "Codex CLI (ChatGPT/API login)",
};
const MASTER_BRAIN_CREDENTIAL_PROVIDER: Record<MasterBrainId, string> = {
  "claude-code": "claude-code-cli",
  codex: "codex-native",
};
const masterBrainStore = new MasterBrainStore(`${DATA_DIR}master-brain.json`);

function buildMasterBrain(id: MasterBrainId): MasterBrain {
  const model = masterBrainStore.getModel(id);
  return id === "codex" ? new CodexMasterBrain(credentialRouter, { model }) : new AnthropicMasterBrain(credentialRouter, { model });
}

const master = buildMasterBrain(masterBrainStore.get());
goalCoordinator = new GoalCoordinator({ orchestrator, master, broadcast });
handoffCoordinator = new HandoffCoordinator({ orchestrator, broadcast });

function makeAgent(id: string, runtime: string, eligibleCapabilities: string[], backendProfile?: string): Agent {
  const now = new Date().toISOString();
  return {
    id,
    enabled: !backendProfile || backendProfileStore.registry[backendProfile]?.enabled !== false,
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
      // v0.22 Part B: which backend currently drives the single Master planner.
      masterBrain: masterBrainStore.get(),
      // v0.22.1: per-backend --model override, keyed by MasterBrainId — see master-brain-store.ts.
      masterBrainModels: masterBrainStore.getModels(),
      // v0.22 Part C: recent dependency handoffs — see HandoffCoordinator.
      handoffs: handoffCoordinator.list(),
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

// v0.22 Part C: recent dependency handoffs, same "in-memory, queryable,
// not disk-persisted across restarts" shape as GET /api/tasks — see
// HandoffCoordinator's own doc comment on why that parity was the goal
// rather than a new persistence layer.
app.get("/api/handoffs", (_req, res) => {
  res.json(handoffCoordinator.list());
});

// Backs the workspace-path folder browser in the web UI: this server already
// runs with the operator's own filesystem access (agents it dispatches
// already execute arbitrary code on this machine — see SECURITY.md), so
// listing directory names under an operator-chosen path adds no new trust
// boundary. Directories only (workspace paths are always folders), never
// file contents or hidden-file listing beyond plain readdir's own behavior.
app.get("/api/fs/dirs", async (req, res) => {
  const requested = typeof req.query.path === "string" && req.query.path.trim() ? req.query.path : homedir();
  const target = isAbsolute(requested) ? resolve(requested) : homedir();
  try {
    const dirents = await readdir(target, { withFileTypes: true });
    const entries = dirents
      .filter((d) => d.isDirectory())
      .map((d) => ({ name: d.name, path: join(target, d.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    const parent = dirname(target);
    res.json({ path: target, parent: parent === target ? null : parent, entries });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      res.status(404).json({ error: `No such directory: ${target}` });
    } else if (code === "EACCES" || code === "EPERM") {
      res.status(403).json({ error: `Permission denied: ${target}` });
    } else if (code === "ENOTDIR") {
      res.status(400).json({ error: `Not a directory: ${target}` });
    } else {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }
});

app.post("/api/fs/dirs", async (req, res) => {
  const requested = typeof req.body?.path === "string" && req.body.path.trim() ? req.body.path : homedir();
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const target = isAbsolute(requested) ? resolve(requested) : homedir();

  if (!name || name === "." || name === ".." || name.length > 255 || /[\\/\0]/.test(name)) {
    res.status(400).json({ error: "Folder name must be a single valid directory name." });
    return;
  }

  try {
    await mkdir(join(target, name));
    res.status(201).json({ path: join(target, name), name });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      res.status(409).json({ error: `A folder named "${name}" already exists.` });
    } else if (code === "ENOENT") {
      res.status(404).json({ error: `No such directory: ${target}` });
    } else if (code === "ENOTDIR") {
      res.status(400).json({ error: `Not a directory: ${target}` });
    } else if (code === "EACCES" || code === "EPERM") {
      res.status(403).json({ error: `Permission denied: ${target}` });
    } else {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }
});

app.post("/api/tasks", dispatchLimiter, async (req, res) => {
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

// v0.22 Part A: point a task directly at one named agent, bypassing capability
// matching entirely — see Orchestrator.assignTaskToAgent. A busy agent is not
// an error: the task is created "pending" and Orchestrator.scheduleDispatch's
// pinnedAgentId branch means it only ever waits for this one agent, acting as
// their personal queue. The client already has this agent's live state from
// the WS stream and is expected to warn the operator before calling this when
// the agent isn't "available" (see build prompt Part A.2) — this route itself
// always accepts and queues.
app.post("/api/agents/:id/assign", dispatchLimiter, (req, res) => {
  const agent = orchestrator.getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: `Unknown agent "${req.params.id}"` });
    return;
  }
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
    const task = orchestrator.assignTaskToAgent(agent.id, { description, workspacePath, title });
    res.status(202).json(task);
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Separate from POST /api/tasks above: the manual "user picks capabilities"
// path is unchanged and stays fully available. This path hands the whole
// decomposition + capability judgment to the Master instead.
app.post("/api/goals", dispatchLimiter, (req, res) => {
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
  const { id, label, apiFormat, baseUrlEnvVar, authTokenEnvVar } = req.body ?? {};
  if (
    typeof id !== "string" ||
    typeof label !== "string" ||
    typeof apiFormat !== "string" ||
    typeof baseUrlEnvVar !== "string" ||
    typeof authTokenEnvVar !== "string"
  ) {
    res.status(400).json({ error: "id, label, apiFormat, baseUrlEnvVar, and authTokenEnvVar (all strings) are required" });
    return;
  }
  try {
    backendProfileStore.create({ id, label, apiFormat, baseUrlEnvVar, authTokenEnvVar });
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
  // v0.21: roleModelMap/fallbackModel/customHeaders/customBodyOverride added
  // for the cc-switch-style single-provider editor (BackendProfilesPanel).
  // Passed through as-is to BackendProfileStore.update, which distinguishes
  // "key omitted from the body" (keep existing) from "key present" (replace,
  // even with an empty object) — see its own comment on that `in` check.
  const body = req.body ?? {};
  const { label, enabled, apiFormat, baseUrlEnvVar, authTokenEnvVar } = body;
  const patch: BackendProfileUpdate = {
    label,
    enabled,
    apiFormat,
    baseUrlEnvVar,
    authTokenEnvVar,
    ...("roleModelMap" in body ? { roleModelMap: body.roleModelMap } : {}),
    ...("fallbackModel" in body ? { fallbackModel: body.fallbackModel } : {}),
    ...("customHeaders" in body ? { customHeaders: body.customHeaders } : {}),
    ...("customBodyOverride" in body ? { customBodyOverride: body.customBodyOverride } : {}),
  };
  try {
    backendProfileStore.update(req.params.id, patch);
    if (typeof enabled === "boolean") {
      for (const agent of orchestrator.listAgents()) {
        if (agent.backendProfile === req.params.id) orchestrator.setAgentEnabled(agent.id, enabled);
      }
    }
    // The first API key a user adds becomes the default automatically. This
    // keeps the quick-start flow to choosing a provider and pasting its key;
    // a later provider never silently replaces an existing default.
    const configuredProfile = backendProfileStore.registry[req.params.id];
    if (typeof authTokenEnvVar === "string" && configuredProfile && !defaultBackendStore.get() && backendProfileStore.list().find((p) => p.id === req.params.id)?.available) {
      defaultBackendStore.set(req.params.id);
      broadcast({ type: "default_backend_profile_changed", backendProfile: req.params.id });
      for (const agent of orchestrator.listAgents()) {
        if (agentAssignments.hasExplicitOverride(agent.id)) continue;
        if (AGENT_ROSTER[agent.id]?.backendProfile !== undefined) continue;
        orchestrator.setAgentBackendProfile(agent.id, req.params.id);
        orchestrator.setAgentEnabled(agent.id, true);
      }
    }
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
// actually has access to, instead of the operator guessing a string to type
// into the role-model-mapping/Fallback model fields (v0.21: BackendProfilesPanel
// turns these into a dropdown fed by this endpoint — see its handleFetchModels).
// Calls the provider's own
// GET {baseUrl}/models with that profile's real credential — never proxied
// through this server's stored state, never logged, never echoed back
// besides the model ids themselves (never secret). Both apiFormats this
// server supports happen to return the same `{ data: [{ id }] }` shape for
// their model-listing endpoint (OpenAI's convention, and Anthropic's own
// /v1/models — see Anthropic API docs), so one code path covers both.
app.get("/api/backend-profiles/:id/models", modelsLimiter, async (req, res) => {
  const profile = backendProfileStore.registry[req.params.id];
  if (!profile) {
    res.status(404).json({ error: `Backend profile "${req.params.id}" does not exist.` });
    return;
  }
  if (profile.enabled === false) {
    res.status(409).json({ error: `Profile "${profile.id}" is stopped. Start it before fetching models.` });
    return;
  }
  const baseUrl = process.env[profile.baseUrlEnvVar]?.trim() || profile.defaultBaseUrl;
  const authToken = process.env[profile.authTokenEnvVar]?.trim();
  if (!baseUrl || !authToken) {
    res.status(409).json({ error: `Profile "${profile.id}" is missing its API key (${profile.authTokenEnvVar}) on this server.` });
    return;
  }

  const headers: Record<string, string> =
    profile.apiFormat === "anthropic"
      ? { "x-api-key": authToken, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${authToken}` };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const modelsPath = profile.apiFormat === "anthropic" ? "/v1/models" : "/models";
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${modelsPath}`, { headers, signal: controller.signal });
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

// v0.21.2: the one route that sends a real credential value back to the
// browser — the Backend & Credentials panel's eye-icon "show plaintext"
// toggle, added at the operator's explicit request after being told this
// crosses the "never send the value itself" boundary every other route in
// this file keeps (see BackendProfile's own field comments) and that this
// server is reachable through a Cloudflare Tunnel guarded by one shared
// password, not per-account auth. Still behind the same `requireAuth`
// gate as everything else under /api (registered above, in index.ts's
// middleware chain) — this does not open a new unauthenticated surface,
// it just changes what an *already-authenticated* caller can see. Tighter
// rate limit than /models (revealSecretLimiter) since this is the more
// sensitive of the two.
app.get("/api/backend-profiles/:id/reveal", revealSecretLimiter, (req, res) => {
  const profile = backendProfileStore.registry[req.params.id];
  if (!profile) {
    res.status(404).json({ error: `Backend profile "${req.params.id}" does not exist.` });
    return;
  }
  res.json({
    baseUrl: process.env[profile.baseUrlEnvVar]?.trim() || profile.defaultBaseUrl || null,
    authToken: process.env[profile.authTokenEnvVar] ?? null,
  });
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
  if (backendProfile !== undefined && backendProfileStore.registry[backendProfile]?.enabled === false) {
    res.status(409).json({ error: `Backend profile "${backendProfile}" is stopped. Start it before assigning new agents to it.` });
    return;
  }

  orchestrator.setAgentBackendProfile(agent.id, backendProfile);
  orchestrator.setAgentEnabled(agent.id, true);
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
  if (backendProfile !== null && backendProfileStore.registry[backendProfile]?.enabled === false) {
    res.status(409).json({ error: `Backend profile "${backendProfile}" is stopped. Start it before making it the default.` });
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
    orchestrator.setAgentEnabled(agent.id, true);
  }

  res.json({ backendProfile: defaultBackendStore.get() });
});

// v0.22 Part B: Master Brain backend selector — see master-brain-store.ts and
// @ai-office/adapter-master-codex's own doc comment on why this needed a
// separate mechanism from BackendProfile. `credentialReady` here is the same
// per-provider check the Backend & Credentials panel's status pill already
// uses (GET /api/credentials), surfaced again here so the selector UI can
// show it inline without a second round trip.
const MASTER_BRAIN_IDS: MasterBrainId[] = ["claude-code", "codex"];

app.get("/api/master-brain", (_req, res) => {
  const current = masterBrainStore.get();
  res.json({
    current,
    options: MASTER_BRAIN_IDS.map((id) => ({
      id,
      label: MASTER_BRAIN_LABELS[id],
      credentialReady: Boolean(credentialRouter.resolve(MASTER_BRAIN_CREDENTIAL_PROVIDER[id])),
      model: masterBrainStore.getModel(id) ?? null,
    })),
  });
});

// Rejects the switch outright (409) when the target backend has no usable
// login session yet, rather than persisting a selection that would only
// fail later at the next goal submission — see the build prompt's Part B.4
// ("give a clear error at selection time or on first call, never a silent
// stall"). The operator can still always retry once logged in.
app.put("/api/master-brain", (req, res) => {
  const raw = req.body?.masterBrain;
  if (raw !== "claude-code" && raw !== "codex") {
    res.status(400).json({ error: 'masterBrain must be "claude-code" or "codex"' });
    return;
  }
  const id = raw as MasterBrainId;
  if (!credentialRouter.resolve(MASTER_BRAIN_CREDENTIAL_PROVIDER[id])) {
    res.status(409).json({
      error: `${MASTER_BRAIN_LABELS[id]} has no usable login session yet. ${
        id === "codex" ? "Run `codex login` on this machine, then try again." : "Run `claude auth login`, then try again."
      }`,
    });
    return;
  }

  masterBrainStore.set(id);
  goalCoordinator.setMaster(buildMasterBrain(id));
  broadcast({ type: "master_brain_changed", masterBrain: id, models: masterBrainStore.getModels() });
  res.json({ current: id, model: masterBrainStore.getModel(id) ?? null });
});

// v0.22.1: the operator asked to be able to pick the *model* Master uses,
// not just which CLI/login it runs on. Stored per-backend id (see
// MasterBrainStore) so switching backends never clobbers the other one's
// choice. Only rebuilds/repoints the live Master instance when the edited
// id is the one currently selected — editing the other (currently inactive)
// backend's model just persists it for whenever it's selected later.
app.put("/api/master-brain/model", (req, res) => {
  const rawId = req.body?.masterBrain;
  if (rawId !== "claude-code" && rawId !== "codex") {
    res.status(400).json({ error: 'masterBrain must be "claude-code" or "codex"' });
    return;
  }
  const rawModel = req.body?.model;
  if (rawModel !== null && rawModel !== undefined && typeof rawModel !== "string") {
    res.status(400).json({ error: "model must be a string, or null/undefined to clear it" });
    return;
  }
  const id = rawId as MasterBrainId;
  const model = typeof rawModel === "string" ? rawModel : undefined;

  masterBrainStore.setModel(id, model);
  if (masterBrainStore.get() === id) {
    goalCoordinator.setMaster(buildMasterBrain(id));
  }
  broadcast({ type: "master_brain_changed", masterBrain: masterBrainStore.get(), models: masterBrainStore.getModels() });
  res.json({ masterBrain: id, model: masterBrainStore.getModel(id) ?? null });
});

// v0.18: last middleware, catches anything an /api handler threw (Express 4
// forwards a synchronous throw from a route handler here automatically) —
// logs the real error server-side and returns a generic message, never
// `err.message`/stack/file paths, since this now answers requests from
// outside this machine. Every route above already handles its own expected
// failure modes with a specific status + safe message; only truly
// unexpected errors reach this.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[ai-office] unhandled request error:", err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error." });
});

httpServer.listen(PORT, () => {
  console.log(`[ai-office] server listening on http://localhost:${PORT}`);
  logAuthStartupState();
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
  const currentMasterBrain = masterBrainStore.get();
  const currentMasterBrainModel = masterBrainStore.getModel(currentMasterBrain);
  console.log(
    `[ai-office] Master Brain: ${MASTER_BRAIN_LABELS[currentMasterBrain]} (selected id: ${currentMasterBrain}${currentMasterBrainModel ? `, model: ${currentMasterBrainModel}` : ""})`
  );
  console.log(
    `[ai-office] Master Brain login session: ${credentialRouter.resolve(MASTER_BRAIN_CREDENTIAL_PROVIDER[currentMasterBrain]) ? "available" : "UNAVAILABLE — the next goal submission will fail fast until this is fixed"}`
  );
  if (currentMasterBrain === "claude-code") {
    console.log(
      `[ai-office] Master Brain parent API env: ANTHROPIC_API_KEY=${apiKeyState}, ANTHROPIC_AUTH_TOKEN=${authTokenState}, ANTHROPIC_BASE_URL=${baseUrlState}; all are stripped from the Master subprocess`
    );
  }
  console.log("[ai-office] switch Master Brain backends via PUT /api/master-brain (see the Backend & Credentials panel)");

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
      const ready = Boolean(process.env[profile.baseUrlEnvVar]?.trim() || profile.defaultBaseUrl) && Boolean(process.env[profile.authTokenEnvVar]?.trim());
      console.log(
        `  - ${id} (${profile.label}): ${ready ? "ready" : `missing ${profile.baseUrlEnvVar} and/or ${profile.authTokenEnvVar}`}`
      );
    }
  }
  console.log(
    `[ai-office] backend profile / agent-assignment data persisted under ${DATA_DIR} — edit via the "Backend & Credentials" panel in the web UI, not by hand.`
  );
});
