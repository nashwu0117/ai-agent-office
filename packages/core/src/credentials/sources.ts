import type { CredentialSource } from "./types.js";

/** Backed by one environment variable — available whenever it's set to a non-empty value. */
export class EnvVarCredentialSource implements CredentialSource {
  constructor(
    public readonly id: string,
    public readonly provider: string,
    public readonly envVar: string
  ) {}

  isAvailable(): boolean {
    const value = process.env[this.envVar];
    return typeof value === "string" && value.trim().length > 0;
  }

  /** The actual secret value, read fresh each call. Never logged — callers pass it straight to an SDK client. */
  readValue(): string | undefined {
    return process.env[this.envVar];
  }
}

/**
 * Wraps an arbitrary availability check that isn't a single env var — e.g. a
 * CLI's own login-session file, or (documented as a known limitation) a
 * check that can't be done at all and always reports available. Never
 * carries a secret value itself; consumers that need one use
 * EnvVarCredentialSource instead.
 */
export class StaticCredentialSource implements CredentialSource {
  constructor(
    public readonly id: string,
    public readonly provider: string,
    private readonly check: () => boolean
  ) {}

  isAvailable(): boolean {
    return this.check();
  }
}
