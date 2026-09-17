import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BackendProfile, BackendProfileClientInfo, BackendProfileRegistry } from "@ai-office/core";

const VALID_API_FORMATS = new Set<BackendProfile["apiFormat"]>(["anthropic", "openai-chat-completions"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export class BackendProfileValidationError extends Error {}

export interface BackendProfileInput {
  id: string;
  label: string;
  apiFormat: string;
  baseUrlEnvVar: string;
  authTokenEnvVar: string;
}

export interface BackendProfileUpdate {
  label?: string;
  apiFormat?: string;
  baseUrlEnvVar?: string;
  authTokenEnvVar?: string;
}

/**
 * v0.10: owns the single BackendProfileRegistry object every consumer in
 * this server (ClaudeCodeAdapter, the format-translation proxy — see
 * index.ts) was constructed with. Mutating `registry`'s own properties in
 * place — never reassigning the object itself — is what lets a profile
 * added or edited through the management UI take effect for the very next
 * dispatched task, with no server restart: every holder of this same
 * object reference sees the mutation immediately.
 *
 * Persists to disk (apps/server/data/backend-profiles.json by default) on
 * every mutation. Once that file exists, it is the sole source of truth on
 * the next startup — the hardcoded defaults this is constructed with (see
 * index.ts's DEFAULT_BACKEND_PROFILES) are only ever a first-run seed.
 */
export class BackendProfileStore {
  readonly registry: BackendProfileRegistry;

  constructor(
    defaults: BackendProfileRegistry,
    private readonly filePath: string
  ) {
    const persisted = this.load();
    this.registry = persisted ?? { ...defaults };
    if (!persisted) this.persist();
  }

  list(): BackendProfileClientInfo[] {
    return Object.values(this.registry).map(toClientInfo);
  }

  create(input: BackendProfileInput): BackendProfile {
    const id = input.id.trim();
    if (!ID_PATTERN.test(id)) {
      throw new BackendProfileValidationError(
        `Invalid profile id "${id}" — must start with a lowercase letter or digit and contain only lowercase letters, digits, and hyphens.`
      );
    }
    if (id === "official") {
      throw new BackendProfileValidationError(
        `"official" is reserved — it means "no override, use the shared credential pool" and never appears as a registered profile.`
      );
    }
    if (this.registry[id]) {
      throw new BackendProfileValidationError(`Backend profile "${id}" already exists — use PUT to edit it.`);
    }
    const profile = this.validateFields(id, input);
    this.registry[id] = profile;
    this.persist();
    return profile;
  }

  update(id: string, patch: BackendProfileUpdate): BackendProfile {
    const existing = this.registry[id];
    if (!existing) {
      throw new BackendProfileValidationError(`Backend profile "${id}" does not exist.`);
    }
    const merged = this.validateFields(id, {
      id,
      label: patch.label ?? existing.label,
      apiFormat: patch.apiFormat ?? existing.apiFormat,
      baseUrlEnvVar: patch.baseUrlEnvVar ?? existing.baseUrlEnvVar,
      authTokenEnvVar: patch.authTokenEnvVar ?? existing.authTokenEnvVar,
    });
    this.registry[id] = merged;
    this.persist();
    return merged;
  }

  private validateFields(id: string, input: BackendProfileInput): BackendProfile {
    const label = input.label.trim();
    if (!label) throw new BackendProfileValidationError("label is required.");
    if (!VALID_API_FORMATS.has(input.apiFormat as BackendProfile["apiFormat"])) {
      throw new BackendProfileValidationError(`apiFormat must be one of: ${[...VALID_API_FORMATS].join(", ")}.`);
    }
    const baseUrlEnvVar = input.baseUrlEnvVar.trim();
    const authTokenEnvVar = input.authTokenEnvVar.trim();
    if (!baseUrlEnvVar || !authTokenEnvVar) {
      throw new BackendProfileValidationError("baseUrlEnvVar and authTokenEnvVar are both required (env var names, not values).");
    }
    return {
      id,
      label,
      apiFormat: input.apiFormat as BackendProfile["apiFormat"],
      baseUrlEnvVar,
      authTokenEnvVar,
    };
  }

  private load(): BackendProfileRegistry | undefined {
    if (!existsSync(this.filePath)) return undefined;
    try {
      return JSON.parse(readFileSync(this.filePath, "utf8")) as BackendProfileRegistry;
    } catch (err) {
      console.warn(
        `[ai-office] failed to read ${this.filePath}, starting from built-in defaults instead: ${err instanceof Error ? err.message : String(err)}`
      );
      return undefined;
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(this.registry, null, 2), "utf8");
    renameSync(tmpPath, this.filePath);
  }
}

function toClientInfo(profile: BackendProfile): BackendProfileClientInfo {
  const baseUrl = process.env[profile.baseUrlEnvVar];
  const authToken = process.env[profile.authTokenEnvVar];
  return {
    id: profile.id,
    label: profile.label,
    apiFormat: profile.apiFormat,
    baseUrlEnvVar: profile.baseUrlEnvVar,
    authTokenEnvVar: profile.authTokenEnvVar,
    available: Boolean(baseUrl?.trim()) && Boolean(authToken?.trim()),
  };
}
