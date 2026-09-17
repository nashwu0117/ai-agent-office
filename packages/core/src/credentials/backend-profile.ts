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
   */
  apiFormat: "anthropic" | "openai-chat-completions";
}

/** Keyed by BackendProfile.id. "official"/undefined is the implicit default and never appears here — it means "use CredentialRouter as before, unchanged". */
export type BackendProfileRegistry = Record<string, BackendProfile>;

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
