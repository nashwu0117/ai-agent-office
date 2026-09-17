/**
 * v0.7: lets a provider (Anthropic API, a CLI's own login session, ...) be
 * backed by more than one credential and fail over between them, instead of
 * every consumer (AnthropicMasterBrain, ClaudeCodeAdapter, OpenCodeAdapter)
 * separately reading one hardcoded environment variable. This phase only
 * ships an environment-variable-backed CredentialSource (see
 * credentials/sources.ts, node-only) — a secrets-manager-backed one would
 * implement the same interface without any consumer changing.
 */
export interface CredentialSource {
  /** Unique across the whole router, e.g. "anthropic-primary", "anthropic-backup". Never the secret itself. */
  id: string;
  /** Groups sources a consumer resolves together, e.g. "anthropic", "opencode-native". */
  provider: string;
  /** Present when this source is backed by a single environment variable; absent for other source kinds. */
  envVar?: string;
  /** Whether this source currently looks usable (env var set, file present, ...) — never proves the secret is *valid*, only present. */
  isAvailable(): boolean;
}

/** Non-secret snapshot of one CredentialSource, safe to log or send to the UI. */
export interface CredentialSourceStatus {
  id: string;
  provider: string;
  available: boolean;
}

export interface CredentialRouter {
  /** Highest-priority source for `provider` that is available and hasn't been reported failed this process, or undefined if none qualify. */
  resolve(provider: string): CredentialSource | undefined;
  /**
   * Marks `sourceId` as failed for the remainder of this process (e.g. a 401
   * from the API it backs) — a later resolve() for its provider skips it and
   * falls through to the next source. Not time-limited: only a process
   * restart clears it (see v0.7 scope notes in README).
   */
  reportFailure(sourceId: string, reason: string): void;
  /** Every registered source's current id/provider/availability — for startup logging and the UI status pill. Never exposes secret values. */
  listStatuses(): CredentialSourceStatus[];
}
