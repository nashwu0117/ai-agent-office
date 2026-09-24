import { BackendProfileError, type BackendProfileRegistry } from "./backend-profile.js";

export interface BackendEnvOverride {
  ANTHROPIC_BASE_URL: string;
  ANTHROPIC_AUTH_TOKEN: string;
}

/**
 * Resolves the env overrides a spawned Claude Code process should use for
 * `profileId`, reading only from this server's own process env (set by the
 * operator directly — never read from cc-switch's store at runtime; see
 * backend-profile.ts). Returns undefined for "official"/undefined, meaning
 * "no override, resolve the shared credential pool as before".
 *
 * Throws BackendProfileError — never silently falls back to the official
 * credential, never lets a caller spawn a process with a half-configured
 * backend — when `profileId` isn't registered, or is registered but its
 * required env var(s) aren't set on this process.
 */
export function resolveBackendEnv(
  profileId: string | undefined,
  registry: BackendProfileRegistry
): BackendEnvOverride | undefined {
  if (!profileId || profileId === "official") return undefined;

  const profile = registry[profileId];
  if (!profile) {
    throw new BackendProfileError(
      `Unknown backend profile "${profileId}" — not registered in this server's BACKEND_PROFILES.`,
      profileId
    );
  }

  if (profile.enabled === false) {
    throw new BackendProfileError(
      `Backend profile "${profileId}" (${profile.label}) is stopped. Start it in Backend & Credentials before dispatching a task through it.`,
      profileId
    );
  }

  const baseUrl = process.env[profile.baseUrlEnvVar];
  const authToken = process.env[profile.authTokenEnvVar];
  if (!baseUrl || !authToken) {
    const missing = [!baseUrl && profile.baseUrlEnvVar, !authToken && profile.authTokenEnvVar]
      .filter((v): v is string => Boolean(v))
      .join(", ");
    throw new BackendProfileError(
      `Backend profile "${profileId}" (${profile.label}) is missing required environment variable(s): ${missing}.`,
      profileId
    );
  }

  return { ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_AUTH_TOKEN: authToken };
}
