/**
 * v0.8: lets an individual agent be pinned to a different API backend than
 * the shared credential pool CredentialRouter resolves by default — e.g.
 * routing some agents through a third-party endpoint instead of the
 * operator's own official Anthropic subscription, so not every agent spends
 * the same quota.
 *
 * This is deliberately NOT built on top of cc-switch. See
 * docs/cc-switch-research.md: cc-switch's own switching/proxy mechanism is
 * one global "current profile" per CLI tool (a single `is_current` row, a
 * single `proxy_config` row) — there is no per-process or per-request way to
 * ask it "route just this one call through provider X" without racing every
 * other concurrent caller. Direct env-var injection at process-spawn time
 * (see backend-resolver.ts, node-only) sidesteps that entirely: each spawned
 * `claude` process gets its own isolated environment, so two agents with
 * different backendProfiles never share mutable state.
 */

/**
 * v0.21: the model "roles" a claude-code agent's CLI can request — Sonnet,
 * Opus, and Haiku are Anthropic's own long-standing model-family names;
 * Fable is included per the operator's current lineup (see AGENT_ROSTER's
 * v0.21 comment in apps/server/src/index.ts). "subagent" is not a model
 * family — it is Claude Code's own sub-task delegation, which by default
 * requests a cheaper model than whatever the parent conversation is using.
 * See RoleModelMap's own comment for exactly how (and how imperfectly) each
 * of these is actually detected at the proxy layer — this is a real,
 * wire-level best-effort match, not a guess dressed up as a mechanism.
 */
export type AgentRole = "sonnet" | "opus" | "fable" | "haiku" | "subagent";

export const AGENT_ROLES: AgentRole[] = ["sonnet", "opus", "fable", "haiku", "subagent"];

/**
 * v0.21: per-role upstream model id overrides for a BackendProfile — e.g.
 * "when this profile's agent's CLI asks for Sonnet, actually send
 * 'meta/llama-3.1-70b-instruct' upstream instead". Stored as plain strings,
 * not env-var *names* like baseUrlEnvVar/authTokenEnvVar above — a model id
 * is never a secret, so there is no reason to make this any harder to read
 * or edit than the plain string it is. (A pre-v0.21 single blanket
 * `modelOverrideEnvVar` field existed here and went through that env-var
 * indirection instead; removed at the operator's request once this
 * per-role mapping could fully replace it — see git history if you need
 * the old design's reasoning.)
 *
 * Detection at the proxy (apps/server/src/proxy-server.ts's resolveRoleModel):
 * sonnet/opus/haiku/fable are matched by a case-insensitive substring test
 * against the incoming request's own `model` field (e.g. a request for
 * "claude-sonnet-4-5-..." matches "sonnet"). This is a real signal — it's
 * exactly the model family the CLI actually asked for — not a heuristic
 * guess. "subagent" has no equivalent wire-level signal: Claude Code's
 * outbound request for a subagent's own model choice is not distinguishable
 * from an ordinary request for that same model family purely from the HTTP
 * request this proxy sees. So `subagent`'s mapping, if set, is used only as
 * the catch-all for a request whose model string matches none of the four
 * family substrings above — a documented, honest fallback, not a genuine
 * "this specific call is a subagent" detector.
 */
export type RoleModelMap = Partial<Record<AgentRole, string>>;

/**
 * v0.21: extra static request headers a profile's upstream needs beyond the
 * auth token this server already injects (x-api-key) — e.g. a required
 * pinned API version header some third-party gateway demands. Never a
 * substitute for the Base URL / API key fields: proxy-server.ts applies
 * these as additions on top of the credential it resolves from
 * baseUrlEnvVar/authTokenEnvVar, not instead of it.
 */
export type CustomHeaders = Record<string, string>;

/**
 * v0.21: a JSON object shallow-merged into the outgoing request body (after
 * role/model resolution) for a profile that needs a fixed extra parameter
 * some upstreams require (e.g. a vendor-specific flag). Applied on both the
 * "anthropic" passthrough and "openai-chat-completions" translated paths —
 * see proxy-server.ts's applyCustomBody.
 */
export type CustomBodyOverride = Record<string, unknown>;

export interface BackendProfile {
  /** Matches Agent.backendProfile and the key this profile is registered under. */
  id: string;
  /** Shown in the Agent detail panel, e.g. "NVIDIA API". */
  label: string;
  /** Env var this server reads the backend's ANTHROPIC_BASE_URL-equivalent from. Never the value itself. */
  baseUrlEnvVar: string;
  /** Env var this server reads the backend's auth token from. Never the value itself. */
  authTokenEnvVar: string;
  /**
   * v0.9: which wire format this backend actually speaks, read by the local
   * format-translation proxy (apps/server/src/proxy-server.ts) to decide
   * whether to forward a request byte-for-byte ("anthropic", v0.8 behavior)
   * or translate it to/from OpenAI Chat Completions first. See
   * packages/core/src/proxy and docs/api-format-translation.md — the
   * translation is lossy in documented, specific ways, never a silent
   * best-effort pretending the two APIs are equivalent.
   *
   * v0.21: a third value, "unset", was added for a profile whose wire format
   * genuinely isn't known yet (see vyceai's seed profile in index.ts — no
   * public documentation of its API shape was found, so this project
   * deliberately does not guess). A profile with apiFormat "unset" is never
   * `available` and the proxy refuses to route it with a clear
   * configuration error instead of misinterpreting its bytes — see
   * backend-profile-store.ts's toClientInfo and proxy-server.ts's
   * handleRequest.
   */
  apiFormat: "anthropic" | "openai-chat-completions" | "unset";
  /** v0.21: see RoleModelMap. Undefined/empty means no per-role mapping is configured. */
  roleModelMap?: RoleModelMap;
  /**
   * v0.21: the model id to send when a request's role can't be resolved
   * from roleModelMap (no substring match, and no `subagent` entry to catch
   * it) — the "退而求其次要打的模型" the v0.21 build prompt asks for. Undefined
   * means no rewrite at all: the CLI's own requested model id is forwarded
   * unchanged.
   */
  fallbackModel?: string;
  /** v0.21: see CustomHeaders. */
  customHeaders?: CustomHeaders;
  /** v0.21: see CustomBodyOverride. */
  customBodyOverride?: CustomBodyOverride;
}

/** Keyed by BackendProfile.id. "official"/undefined is the implicit default and never appears here — it means "use CredentialRouter as before, unchanged". */
export type BackendProfileRegistry = Record<string, BackendProfile>;

/**
 * v0.10: the shape of a BackendProfile the server ever sends to the browser
 * — id/label/apiFormat/env-var-*names* for the management UI (packages
 * apps/web/src/BackendProfilesPanel.tsx) plus a computed `available` flag.
 * Never the env vars' actual values: this is exactly the boundary
 * BackendProfile's own field comments describe ("Never the value itself"),
 * just reused for the read side instead of resolveBackendEnv's write side.
 */
export interface BackendProfileClientInfo {
  id: string;
  label: string;
  apiFormat: BackendProfile["apiFormat"];
  baseUrlEnvVar: string;
  authTokenEnvVar: string;
  /** v0.21: see RoleModelMap. Sent as-is — never a secret. */
  roleModelMap?: RoleModelMap;
  /** v0.21: see BackendProfile.fallbackModel. */
  fallbackModel?: string;
  /** v0.21: see CustomHeaders. Sent as-is — header values here are never the profile's own auth credential (that stays server-side, see baseUrlEnvVar/authTokenEnvVar's own comments). */
  customHeaders?: CustomHeaders;
  /** v0.21: see CustomBodyOverride. */
  customBodyOverride?: CustomBodyOverride;
  /** Whether both baseUrlEnvVar and authTokenEnvVar are currently set (non-empty) on this server's process, AND apiFormat isn't "unset" — never proves the values are valid credentials, only present and structurally usable. */
  available: boolean;
}

/**
 * Thrown by resolveBackendEnv (backend-resolver.ts) when an agent's
 * backendProfile can't be cleanly resolved — unregistered id, or a
 * registered profile missing its required env var(s). Deliberately a
 * distinct error type from an ordinary auth failure: this is a *server
 * configuration* problem caught before any process is even spawned, not the
 * provider rejecting a credential it was actually able to send. See
 * orchestrator.ts's runTask catch block and events/types.ts's
 * `backendProfileError` flag.
 */
export class BackendProfileError extends Error {
  constructor(
    message: string,
    public readonly profileId: string
  ) {
    super(message);
    this.name = "BackendProfileError";
  }
}
