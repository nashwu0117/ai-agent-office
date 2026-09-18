import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  AGENT_ROLES,
  type AgentRole,
  type BackendProfile,
  type BackendProfileClientInfo,
  type BackendProfileRegistry,
  type CustomBodyOverride,
  type CustomHeaders,
  type RoleModelMap,
} from "@ai-office/core";
import { upsertEnvVar } from "./env-file-store.js";

// v0.21: "unset" is a real, persistable state (see BackendProfile.apiFormat's
// own doc comment) — a profile whose wire format genuinely isn't known yet,
// left for the operator to pick manually rather than guessed by this code.
const VALID_API_FORMATS = new Set<BackendProfile["apiFormat"]>(["anthropic", "openai-chat-completions", "unset"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
// v0.15: baseUrlEnvVar/authTokenEnvVar are meant to hold the *name* of an
// env var this server reads at runtime — never the secret value itself. In
// practice, operators kept pasting the real URL/key string directly into
// these fields anyway (it happened five times —
// nvidia-real, bai-1, bai-2, and two new profiles mid-add — despite the
// field being labeled "env var name"), each time silently persisting a
// broken, exposed profile. Rejecting that input just left people stuck
// re-reading the label; see resolveEnvVarField below for what this does
// instead: treat anything that isn't already a valid identifier as the real
// value, and go set it up correctly on their behalf.
//
// v0.15.1: that identifier check originally allowed lowercase (any
// [A-Za-z_][A-Za-z0-9_]* string), so a real secret that happens to use only
// letters/digits/underscores — e.g. an API key shaped like
// "xpl_<40 lowercase hex chars>" — passed as "already a valid name" and got
// stored as-is instead of auto-provisioned, silently corrupting the profile
// (found live: platform.experientiallabs.ai's key ended up sitting in
// authTokenEnvVar itself, so process.env[that] was always undefined and
// every /models fetch 409'd). Every real env var name in this codebase is
// SCREAMING_SNAKE_CASE; requiring uppercase here is enough to correctly
// route any lowercase-containing secret through resolveEnvVarField's
// auto-provisioning path instead.
const ENV_VAR_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export class BackendProfileValidationError extends Error {}

export interface BackendProfileInput {
  id: string;
  label: string;
  apiFormat: string;
  baseUrlEnvVar: string;
  authTokenEnvVar: string;
  roleModelMap?: RoleModelMap;
  fallbackModel?: string;
  customHeaders?: CustomHeaders;
  customBodyOverride?: CustomBodyOverride;
}

export interface BackendProfileUpdate {
  label?: string;
  apiFormat?: string;
  baseUrlEnvVar?: string;
  authTokenEnvVar?: string;
  roleModelMap?: RoleModelMap;
  fallbackModel?: string;
  customHeaders?: CustomHeaders;
  customBodyOverride?: CustomBodyOverride;
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
 * the next startup for every profile id it already contains — editing or
 * deleting-then-recreating one of those through the management UI is never
 * overridden back to the hardcoded default. But a *new* profile id added to
 * DEFAULT_BACKEND_PROFILES by a later version of this codebase (e.g. the
 * v0.13 nvidia-1..3/bai-1..3/experientiallabs-1 expansion) still needs to
 * actually show up for an operator who already has a backend-profiles.json
 * from an earlier version — see mergeMissingDefaults below, called only for
 * ids genuinely absent from the persisted file, never touching one that's
 * already there under any state.
 */
export class BackendProfileStore {
  readonly registry: BackendProfileRegistry;

  constructor(
    defaults: BackendProfileRegistry,
    private readonly filePath: string,
    /** v0.15: apps/server/.env.local — see resolveEnvVarField's auto-provisioning. */
    private readonly envFilePath: string
  ) {
    const persisted = this.load();
    if (persisted) {
      this.registry = persisted;
      this.mergeMissingDefaults(defaults);
    } else {
      this.registry = { ...defaults };
      this.persist();
    }
  }

  /** Adds any default profile id missing from an already-persisted registry; never touches an existing id. */
  private mergeMissingDefaults(defaults: BackendProfileRegistry): void {
    let changed = false;
    for (const [id, profile] of Object.entries(defaults)) {
      if (!this.registry[id]) {
        this.registry[id] = profile;
        changed = true;
      }
    }
    if (changed) this.persist();
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

  /** v0.15: removes a profile that no agent is actively pinned to — see index.ts's DELETE route for the "still in use" guard. */
  delete(id: string): void {
    if (!this.registry[id]) {
      throw new BackendProfileValidationError(`Backend profile "${id}" does not exist.`);
    }
    delete this.registry[id];
    this.persist();
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
      // v0.21: these four are always taken from the patch when the caller
      // includes the key at all (even an explicit {} to clear one) —
      // undefined-means-"keep existing" would make it impossible to ever
      // clear a role mapping or custom header/body back to empty from the
      // UI. See index.ts's PUT route for how it distinguishes "field
      // omitted" from "field explicitly cleared".
      roleModelMap: "roleModelMap" in patch ? patch.roleModelMap : existing.roleModelMap,
      fallbackModel: "fallbackModel" in patch ? patch.fallbackModel : existing.fallbackModel,
      customHeaders: "customHeaders" in patch ? patch.customHeaders : existing.customHeaders,
      customBodyOverride: "customBodyOverride" in patch ? patch.customBodyOverride : existing.customBodyOverride,
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
    const rawBaseUrl = input.baseUrlEnvVar.trim();
    const rawAuthToken = input.authTokenEnvVar.trim();
    if (!rawBaseUrl || !rawAuthToken) {
      throw new BackendProfileValidationError("baseUrlEnvVar and authTokenEnvVar are both required.");
    }
    const baseUrlEnvVar = this.resolveEnvVarField(id, "BASE_URL", rawBaseUrl);
    const authTokenEnvVar = this.resolveEnvVarField(id, "AUTH_TOKEN", rawAuthToken);
    const roleModelMap = this.validateRoleModelMap(input.roleModelMap);
    const fallbackModel = input.fallbackModel?.trim() || undefined;
    const customHeaders = this.validateCustomHeaders(input.customHeaders);
    const customBodyOverride = this.validateCustomBodyOverride(input.customBodyOverride);
    return {
      id,
      label,
      apiFormat: input.apiFormat as BackendProfile["apiFormat"],
      baseUrlEnvVar,
      authTokenEnvVar,
      ...(roleModelMap ? { roleModelMap } : {}),
      ...(fallbackModel ? { fallbackModel } : {}),
      ...(customHeaders ? { customHeaders } : {}),
      ...(customBodyOverride ? { customBodyOverride } : {}),
    };
  }

  /** v0.21: drops empty-string entries (the UI's "no override for this role" state) rather than persisting them. */
  private validateRoleModelMap(input: RoleModelMap | undefined): RoleModelMap | undefined {
    if (!input) return undefined;
    const out: RoleModelMap = {};
    for (const [role, model] of Object.entries(input) as [AgentRole, string | undefined][]) {
      if (!AGENT_ROLES.includes(role)) {
        throw new BackendProfileValidationError(`Unknown role "${role}" in roleModelMap — must be one of: ${AGENT_ROLES.join(", ")}.`);
      }
      const trimmed = model?.trim();
      if (trimmed) out[role] = trimmed;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  private validateCustomHeaders(input: CustomHeaders | undefined): CustomHeaders | undefined {
    if (!input) return undefined;
    const out: CustomHeaders = {};
    for (const [key, value] of Object.entries(input)) {
      const trimmedKey = key.trim();
      if (!trimmedKey) continue;
      if (/[\r\n]/.test(trimmedKey) || /[\r\n]/.test(value)) {
        throw new BackendProfileValidationError("Custom header names/values can't contain line breaks.");
      }
      const lower = trimmedKey.toLowerCase();
      if (lower === "x-api-key" || lower === "authorization" || lower === "host") {
        throw new BackendProfileValidationError(
          `Custom headers can't override "${trimmedKey}" — that's set from the profile's own Base URL/API key fields, not a custom header.`
        );
      }
      out[trimmedKey] = value;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  private validateCustomBodyOverride(input: CustomBodyOverride | undefined): CustomBodyOverride | undefined {
    if (!input) return undefined;
    if (typeof input !== "object" || Array.isArray(input)) {
      throw new BackendProfileValidationError("customBodyOverride must be a JSON object (key/value pairs merged into the request body).");
    }
    return Object.keys(input).length > 0 ? input : undefined;
  }

  /**
   * v0.15: accepts either an env var name (used as-is, unchanged from the
   * original design) or the actual URL/key/model string. For the latter, it
   * derives a standard-shaped name from the profile id and this field's
   * kind, writes the real value into apps/server/.env.local under that name
   * (see env-file-store.ts — replacing any prior value there for the same
   * name), sets it on this process's own env immediately so the profile is
   * usable without a restart, and returns the *name* for the caller to
   * store — backend-profiles.json never holds anything but names.
   */
  private resolveEnvVarField(id: string, kind: "BASE_URL" | "AUTH_TOKEN", value: string): string {
    if (ENV_VAR_NAME_PATTERN.test(value)) return value;
    if (/[\r\n]/.test(value)) {
      throw new BackendProfileValidationError(`This value can't contain line breaks.`);
    }
    const envVarName = `AI_OFFICE_BACKEND_${id.toUpperCase().replace(/-/g, "_")}_${kind}`;
    upsertEnvVar(this.envFilePath, envVarName, value);
    process.env[envVarName] = value;
    return envVarName;
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
    ...(baseUrl?.trim() ? { baseUrlValue: baseUrl.trim() } : {}),
    ...(profile.roleModelMap ? { roleModelMap: profile.roleModelMap } : {}),
    ...(profile.fallbackModel ? { fallbackModel: profile.fallbackModel } : {}),
    ...(profile.customHeaders ? { customHeaders: profile.customHeaders } : {}),
    ...(profile.customBodyOverride ? { customBodyOverride: profile.customBodyOverride } : {}),
    // v0.21: "unset" apiFormat is never available — see BackendProfile.apiFormat's doc comment.
    available: profile.apiFormat !== "unset" && Boolean(baseUrl?.trim()) && Boolean(authToken?.trim()),
  };
}
