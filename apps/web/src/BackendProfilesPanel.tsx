import { useEffect, useMemo, useState } from "react";
import { AGENT_ROLES, type Agent, type AgentRole, type BackendProfileClientInfo, type CredentialSourceStatus } from "@ai-office/core";
import {
  fetchBackendProfileModels,
  revealBackendProfileSecret,
  setAgentBackendProfile,
  setDefaultBackendProfile,
  setMasterBrain,
  setMasterBrainModel,
  updateBackendProfile,
} from "./ws/client.js";
import { useLanguage } from "./i18n/language-context.js";

// v0.10: Credential / Backend Profile management panel — the UI Part A of
// the v0.10 build prompt calls for, replacing "check the startup log or
// /api/credentials" with an actual page. Every value *displayed* here is
// non-secret: credential availability booleans, and backend profile
// id/label/apiFormat/env-var-*names* (never the values those env vars hold —
// see BackendProfileClientInfo's own field comments).
//
// v0.21: the "Backend profiles" section was rebuilt from a table of
// profiles each hiding its own simplified edit form behind an "Edit"
// button, into a cc-switch-style single-provider editor — pick a provider
// on the left, edit everything about it on the right in one screen,
// including the new per-role model mapping, custom headers/body, and a
// live (secret-masked) preview. This replaces that old table+add-form UI
// entirely rather than living alongside it (see the v0.21 build prompt's
// explicit "no two out-of-sync edit entry points" requirement) — there is
// no more "Add profile" UI either (profiles are still only ever created by
// editing DEFAULT_BACKEND_PROFILES in apps/server/src/index.ts, per that
// prompt's "明確不做" section).
//
// Officially-logged-in providers (Claude Code, OpenCode, Codex, Cline) are
// folded into the same provider list so there's one place to look, but
// their detail view only ever shows login status + how-to-login text —
// they have no Base URL/API key/apiFormat of their own to edit (see
// LOGIN_PROVIDERS below).

const API_FORMAT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "anthropic", label: "Anthropic Messages API" },
  { value: "openai-chat-completions", label: "OpenAI Chat Completions (translated)" },
  { value: "unset", label: "— not selected yet —" },
];

/**
 * v0.22.1: Master's --model dropdown, same "clickable list, not just free
 * text" UX as the role-model-map fields' Fetch Models button below — but
 * Master's two CLIs have no baseUrl/authToken to call a real /models
 * endpoint with, so there is nothing to live-fetch. These choices mirror the
 * aliases/models exposed by the installed CLIs on the operator's machine:
 * - claude-code: stable aliases accepted by `claude --model` (the CLI help
 *   gives fable/opus/sonnet as examples; haiku is also a supported alias).
 * - codex: visible entries from ~/.codex/models_cache.json. Hidden internal
 *   models such as the approval reviewer are deliberately excluded.
 * Neither list claims to be exhaustive or current on a different machine —
 * ModelField still shows a currently-saved value even if it isn't one of
 * these, and the operator can always fall back to editing
 * apps/server/data/master-brain.json by hand for anything not listed here.
 */
const MASTER_MODEL_OPTIONS: Record<"claude-code" | "codex", string[]> = {
  "claude-code": ["fable", "opus", "sonnet", "haiku"],
  codex: ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"],
};

interface LoginProvider {
  id: string;
  labelEn: string;
  labelZh: string;
  /** v0.21.3: one login can have more than one real credential source (e.g. Cline: an env var OR a `cline auth` session) — available if ANY of these is. */
  credentialSourceIds: string[];
  loginCommand: string;
}

// v0.21: the spec's own examples name Claude Code/Codex/Cline explicitly as
// "official login" providers; OpenCode authenticates the exact same way
// (its own CLI-native session, no Base URL/API key of its own — see
// packages/core/src/credentials/factory.ts's opencode-cli-session source)
// so it's included here too rather than left out of the unified list.
const LOGIN_PROVIDERS: LoginProvider[] = [
  {
    id: "official-claude-code",
    labelEn: "Claude Code (official)",
    labelZh: "Claude Code 官方",
    credentialSourceIds: ["claude-code-cli-session"],
    loginCommand: "claude auth login",
  },
  {
    id: "official-opencode",
    labelEn: "OpenCode CLI",
    labelZh: "OpenCode CLI",
    credentialSourceIds: ["opencode-cli-session"],
    loginCommand: "opencode auth login",
  },
  {
    id: "official-codex",
    labelEn: "Codex CLI",
    labelZh: "Codex CLI",
    credentialSourceIds: ["codex-cli-session"],
    loginCommand: "codex login",
  },
  {
    id: "official-cline",
    labelEn: "Cline CLI",
    labelZh: "Cline CLI",
    // v0.21.3: cline-cli-session (a real `cline auth` OAuth session, see
    // factory.ts's hasClineOAuthSession) added alongside the pre-existing
    // CLINE_API_KEY env var source — either one makes this usable.
    credentialSourceIds: ["cline-key-primary", "cline-cli-session"],
    loginCommand: "cline auth (or set CLINE_API_KEY)",
  },
];

interface ProfileDraft {
  label: string;
  apiFormat: string;
  baseUrlInput: string;
  authTokenInput: string;
  roleModelMap: Record<AgentRole, string>;
  fallbackModel: string;
  headers: Array<{ key: string; value: string }>;
  customBodyText: string;
}

const EMPTY_ROLE_MAP: Record<AgentRole, string> = { sonnet: "", opus: "", fable: "", haiku: "", subagent: "" };

function draftFromProfile(p: BackendProfileClientInfo): ProfileDraft {
  return {
    label: p.label,
    apiFormat: p.apiFormat,
    // v0.21.2: Base URL isn't a secret, so it's always shown/editable as
    // its real current value now (p.baseUrlValue) — or, if nothing's been
    // set yet, the env var *name* it would be seeded under (p.baseUrlEnvVar,
    // the original v0.10 seed-name behavior), never blank either way. API
    // key stays blank until the operator clicks the eye icon to reveal it
    // (see the panel's handleToggleReveal) — that boundary is unchanged.
    baseUrlInput: p.baseUrlValue ?? p.baseUrlEnvVar,
    authTokenInput: "",
    roleModelMap: { ...EMPTY_ROLE_MAP, ...(p.roleModelMap ?? {}) },
    fallbackModel: p.fallbackModel ?? "",
    headers: Object.entries(p.customHeaders ?? {}).map(([key, value]) => ({ key, value })),
    customBodyText: p.customBodyOverride && Object.keys(p.customBodyOverride).length > 0 ? JSON.stringify(p.customBodyOverride, null, 2) : "",
  };
}

/**
 * v0.21.1: a role/fallback model field renders as a plain text input until
 * the operator fetches this profile's real model list (GET .../models,
 * v0.15) — then it becomes a real dropdown built from that live list, per
 * the operator's own request instead of always requiring free-text typing.
 * The current value is always included as an option even if it isn't in
 * the fetched list (a value set before fetching, or typed by hand), so
 * switching to the dropdown never silently discards it.
 */
function ModelField({
  id,
  value,
  onChange,
  placeholder,
  models,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  models: string[] | null;
  disabled?: boolean;
}) {
  if (!models) {
    return <input id={id} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
  }
  const options = value && !models.includes(value) ? [value, ...models] : models;
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">—</option>
      {options.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  );
}

const RESERVED_HEADER_NAMES = new Set(["x-api-key", "authorization", "host"]);

function isLoginProviderAvailable(provider: LoginProvider, credentialStatuses: CredentialSourceStatus[]): boolean {
  return provider.credentialSourceIds.some((id) => credentialStatuses.find((s) => s.id === id)?.available);
}

interface Props {
  open: boolean;
  onClose: () => void;
  credentialStatuses: CredentialSourceStatus[];
  backendProfiles: BackendProfileClientInfo[];
  /** v0.13 Part E: profile id every not-otherwise-pinned claude-code agent currently falls back to, or null for "official". */
  defaultBackendProfile: string | null;
  /** v0.22 Part B: which backend currently drives the single Master planner. */
  masterBrain: "claude-code" | "codex";
  /** v0.22.1: per-backend --model override, keyed by MasterBrainId. */
  masterBrainModels: Partial<Record<"claude-code" | "codex", string>>;
  agents: Agent[];
  /** v0.21.3: re-checks the login-based credential sources (see fetchCredentialStatuses's own doc comment) — the "refresh" button next to each. */
  onRefreshCredentials: () => Promise<void>;
}

export function BackendProfilesPanel({
  open,
  onClose,
  credentialStatuses,
  backendProfiles,
  defaultBackendProfile,
  masterBrain,
  masterBrainModels,
  agents,
  onRefreshCredentials,
}: Props) {
  const { t } = useLanguage();
  const masterCliSession = credentialStatuses.find((source) => source.id === "claude-code-cli-session");
  const codexCliSession = credentialStatuses.find((source) => source.id === "codex-cli-session");
  const [masterBrainSaving, setMasterBrainSaving] = useState(false);
  const [masterBrainError, setMasterBrainError] = useState<string | null>(null);
  const [masterBrainSaved, setMasterBrainSaved] = useState(false);

  async function handleMasterBrainChange(id: "claude-code" | "codex") {
    if (id === masterBrain) return;
    setMasterBrainSaving(true);
    setMasterBrainError(null);
    setMasterBrainSaved(false);
    try {
      await setMasterBrain(id);
      setMasterBrainSaved(true);
    } catch (err) {
      setMasterBrainError(err instanceof Error ? err.message : String(err));
    } finally {
      setMasterBrainSaving(false);
    }
  }

  // v0.22.1: per-backend model draft — re-synced from the live values only
  // when the panel opens, not on every masterBrainModels change, so it never
  // clobbers a value the operator is still typing.
  const [modelDrafts, setModelDrafts] = useState<Record<"claude-code" | "codex", string>>({
    "claude-code": masterBrainModels["claude-code"] ?? "",
    codex: masterBrainModels.codex ?? "",
  });
  const [modelSaving, setModelSaving] = useState<Partial<Record<"claude-code" | "codex", boolean>>>({});
  const [modelError, setModelError] = useState<Partial<Record<"claude-code" | "codex", string | null>>>({});
  const [modelSaved, setModelSaved] = useState<Partial<Record<"claude-code" | "codex", boolean>>>({});

  useEffect(() => {
    if (!open) return;
    setModelDrafts({
      "claude-code": masterBrainModels["claude-code"] ?? "",
      codex: masterBrainModels.codex ?? "",
    });
    // Deliberately re-syncs only when the panel opens (see comment above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSaveModel(id: "claude-code" | "codex") {
    setModelSaving((s) => ({ ...s, [id]: true }));
    setModelError((s) => ({ ...s, [id]: null }));
    setModelSaved((s) => ({ ...s, [id]: false }));
    try {
      await setMasterBrainModel(id, modelDrafts[id].trim() || null);
      setModelSaved((s) => ({ ...s, [id]: true }));
    } catch (err) {
      setModelError((s) => ({ ...s, [id]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setModelSaving((s) => ({ ...s, [id]: false }));
    }
  }

  const [assignError, setAssignError] = useState<string | null>(null);
  const [assigningAgentId, setAssigningAgentId] = useState<string | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [settingDefault, setSettingDefault] = useState(false);

  const [refreshingCredentials, setRefreshingCredentials] = useState(false);
  const [refreshCredentialsError, setRefreshCredentialsError] = useState<string | null>(null);
  async function handleRefreshCredentials() {
    setRefreshingCredentials(true);
    setRefreshCredentialsError(null);
    try {
      await onRefreshCredentials();
    } catch (err) {
      setRefreshCredentialsError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshingCredentials(false);
    }
  }

  // v0.21: combined list — login providers first, then every BackendProfile.
  const listItems = useMemo(
    () => [
      ...LOGIN_PROVIDERS.map((p) => ({ kind: "login" as const, provider: p })),
      ...backendProfiles.map((p) => ({ kind: "profile" as const, profile: p })),
    ],
    [backendProfiles]
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    if (selectedId && listItems.some((item) => (item.kind === "login" ? item.provider.id : item.profile.id) === selectedId)) return;
    setSelectedId(listItems[0] ? (listItems[0].kind === "login" ? listItems[0].provider.id : listItems[0].profile.id) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, listItems]);

  const selectedProfile = backendProfiles.find((p) => p.id === selectedId);
  const selectedLogin = LOGIN_PROVIDERS.find((p) => p.id === selectedId);

  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  useEffect(() => {
    setDraft(selectedProfile ? draftFromProfile(selectedProfile) : null);
    setSaveError(null);
  }, [selectedProfile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [profilePowerSaving, setProfilePowerSaving] = useState(false);
  const [profilePowerError, setProfilePowerError] = useState<string | null>(null);

  useEffect(() => {
    setProfilePowerError(null);
  }, [selectedProfile?.id]);

  async function handleProfileEnabledChange(enabled: boolean) {
    if (!selectedProfile || selectedProfile.enabled === enabled) return;
    setProfilePowerSaving(true);
    setProfilePowerError(null);
    try {
      await updateBackendProfile(selectedProfile.id, { enabled });
    } catch (err) {
      setProfilePowerError(err instanceof Error ? err.message : String(err));
    } finally {
      setProfilePowerSaving(false);
    }
  }

  // v0.21.2: the "live preview" box is now a two-way editable textarea, per
  // the operator's own request — typing/pasting JSON into it and clicking
  // "Apply" writes recognized fields back into `draft`. `previewText` only
  // re-derives from `draft` (via buildPreview) when `draft` itself changes
  // — i.e. when a *field above* was edited, or Apply just ran — never on
  // every keystroke inside the textarea itself, so free typing/pasting here
  // is never clobbered mid-edit.
  const [previewText, setPreviewText] = useState("");
  const [previewApplyError, setPreviewApplyError] = useState<string | null>(null);
  useEffect(() => {
    if (selectedProfile && draft) setPreviewText(buildPreview(selectedProfile, draft));
    setPreviewApplyError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfile?.id, draft]);

  // v0.21.1: real model ids this profile's own key can see, fetched on
  // demand — feeds ModelField's dropdown for the role/fallback fields
  // below. Reset whenever the selected profile changes so a stale list
  // from a different provider never lingers.
  const [modelsState, setModelsState] = useState<{ status: "loading" | "error" | "done"; models?: string[]; error?: string } | null>(
    null
  );
  useEffect(() => {
    setModelsState(null);
  }, [selectedProfile?.id]);

  async function handleFetchModels() {
    if (!selectedProfile) return;
    setModelsState({ status: "loading" });
    try {
      const models = await fetchBackendProfileModels(selectedProfile.id);
      setModelsState({ status: "done", models });
    } catch (err) {
      setModelsState({ status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }

  // v0.21.2: eye-icon reveal for the API key field — see revealBackendProfileSecret's
  // own doc comment for the security tradeoff this was built with the
  // operator's explicit go-ahead on. `authTokenRevealed` just toggles the
  // input's type ("password" <-> "text"); the real value, once fetched, stays
  // in draft.authTokenInput so toggling back to masked doesn't re-blank it —
  // matches a password-manager-style show/hide, not a re-fetch each click.
  const [authTokenRevealed, setAuthTokenRevealed] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  useEffect(() => {
    setAuthTokenRevealed(false);
    setRevealError(null);
  }, [selectedProfile?.id]);

  async function handleToggleReveal() {
    if (!selectedProfile || !draft) return;
    if (authTokenRevealed) {
      setAuthTokenRevealed(false);
      return;
    }
    if (!draft.authTokenInput) {
      setRevealing(true);
      setRevealError(null);
      try {
        const { authToken } = await revealBackendProfileSecret(selectedProfile.id);
        setDraft((d) => (d ? { ...d, authTokenInput: authToken ?? "" } : d));
      } catch (err) {
        setRevealError(err instanceof Error ? err.message : String(err));
        setRevealing(false);
        return;
      }
      setRevealing(false);
    }
    setAuthTokenRevealed(true);
  }

  function resetDraft() {
    if (selectedProfile) setDraft(draftFromProfile(selectedProfile));
    setSaveError(null);
    setSaved(false);
  }

  /**
   * v0.21.2: parses previewText as JSON and writes recognized fields back
   * into `draft` — the operator's own request for a paste-able preview.
   * Deliberately ignores `id`, `baseUrlEnvVar`, and `authTokenEnvVar` even
   * if present in the pasted JSON: the first is immutable, and the latter
   * two are display-only status strings here (see buildPreview's own
   * comment on why those two specifically never round-trip through this
   * box) — editing the actual Base URL/API key still goes through their
   * own dedicated fields above.
   */
  function handleApplyPreview() {
    if (!draft) return;
    try {
      const parsed = JSON.parse(previewText) as Record<string, unknown>;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      const next: ProfileDraft = { ...draft };
      if (typeof parsed.label === "string") next.label = parsed.label;
      if (typeof parsed.apiFormat === "string") next.apiFormat = parsed.apiFormat;
      if (parsed.roleModelMap && typeof parsed.roleModelMap === "object" && !Array.isArray(parsed.roleModelMap)) {
        const rm = { ...EMPTY_ROLE_MAP };
        for (const role of AGENT_ROLES) {
          const v = (parsed.roleModelMap as Record<string, unknown>)[role];
          if (typeof v === "string") rm[role] = v;
        }
        next.roleModelMap = rm;
      }
      if (typeof parsed.fallbackModel === "string") next.fallbackModel = parsed.fallbackModel;
      if (parsed.customHeaders && typeof parsed.customHeaders === "object" && !Array.isArray(parsed.customHeaders)) {
        next.headers = Object.entries(parsed.customHeaders as Record<string, unknown>).map(([key, value]) => ({
          key,
          value: typeof value === "string" ? value : String(value),
        }));
      }
      if ("customBodyOverride" in parsed) {
        const body = parsed.customBodyOverride;
        next.customBodyText = body && typeof body === "object" && Object.keys(body as object).length > 0 ? JSON.stringify(body, null, 2) : "";
      }
      setDraft(next);
      setPreviewApplyError(null);
    } catch (err) {
      setPreviewApplyError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSave() {
    if (!selectedProfile || !draft) return;
    setSaved(false);
    const label = draft.label.trim();
    if (!label) {
      setSaveError(t.validationLabelRequired);
      return;
    }
    for (const h of draft.headers) {
      const key = h.key.trim();
      if (!key) continue;
      if (RESERVED_HEADER_NAMES.has(key.toLowerCase())) {
        setSaveError(t.validationHeaderReserved(key));
        return;
      }
    }
    let customBodyOverride: Record<string, unknown> = {};
    if (draft.customBodyText.trim()) {
      try {
        const parsed = JSON.parse(draft.customBodyText);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
        customBodyOverride = parsed;
      } catch {
        setSaveError(t.validationCustomBodyInvalidJson);
        return;
      }
    }

    const roleModelMap: Record<string, string> = {};
    for (const role of AGENT_ROLES) {
      const v = draft.roleModelMap[role]?.trim();
      if (v) roleModelMap[role] = v;
    }
    const customHeaders: Record<string, string> = {};
    for (const h of draft.headers) {
      const key = h.key.trim();
      if (key) customHeaders[key] = h.value;
    }

    setSaving(true);
    setSaveError(null);
    try {
      await updateBackendProfile(selectedProfile.id, {
        label,
        apiFormat: draft.apiFormat,
        // v0.21.2: baseUrlInput is now always a real value or the seed env
        // var name (see draftFromProfile), never blank, so it's always sent
        // — unlike authTokenInput, which is genuinely blank until the
        // operator either reveals or types over it, so "leave blank = keep
        // unchanged" still applies there.
        baseUrlEnvVar: draft.baseUrlInput.trim(),
        ...(draft.authTokenInput.trim() ? { authTokenEnvVar: draft.authTokenInput.trim() } : {}),
        roleModelMap,
        fallbackModel: draft.fallbackModel.trim() || undefined,
        customHeaders,
        customBodyOverride,
      });
      // v0.21.2: baseUrlInput keeps showing what was just saved (it's not a
      // secret); authTokenInput/authTokenRevealed reset so a just-saved key
      // goes back to masked-and-hidden, matching every other page load.
      setDraft((d) => (d ? { ...d, authTokenInput: "" } : d));
      setAuthTokenRevealed(false);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefault(backendProfile: string) {
    setDefaultError(null);
    setSettingDefault(true);
    try {
      await setDefaultBackendProfile(backendProfile === "official" ? null : backendProfile);
    } catch (err) {
      setDefaultError(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingDefault(false);
    }
  }

  async function handleReassign(agentId: string, backendProfile: string) {
    setAssignError(null);
    setAssigningAgentId(agentId);
    try {
      await setAgentBackendProfile(agentId, backendProfile === "official" ? null : backendProfile);
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : String(err));
    } finally {
      setAssigningAgentId(null);
    }
  }

  if (!open) return null;

  function statusFor(p: BackendProfileClientInfo): { text: string; className: string } {
    if (!p.enabled) return { text: t.profileStopped, className: "bp-status-stopped" };
    if (p.apiFormat === "unset") return { text: t.profileNeedsFormat, className: "bp-status-warn" };
    return p.available ? { text: t.profileReady, className: "bp-status-ok" } : { text: t.profileMissingEnvVars, className: "bp-status-bad" };
  }

  return (
    <div className="bp-overlay" role="dialog" aria-modal="true" aria-labelledby="bp-panel-heading">
      <div className="bp-panel">
        <div className="bp-panel-header">
          <h2 id="bp-panel-heading">{t.backendCredentials}</h2>
          <button type="button" className="bp-close" onClick={onClose} aria-label={t.closeBackendPanel}>
            ✕
          </button>
        </div>

        <section className="bp-section" aria-labelledby="bp-master-heading">
          <h3 id="bp-master-heading">{t.masterBrainHeading}</h3>
          <p className="bp-hint">{t.masterBrainSelectorHint}</p>
          <p className="bp-hint">{t.masterModelListHint}</p>
          <div className="bp-master-selector" role="radiogroup" aria-labelledby="bp-master-heading">
            {(["claude-code", "codex"] as const).map((id) => {
              const session = id === "claude-code" ? masterCliSession : codexCliSession;
              const ready = Boolean(session?.available);
              return (
                <div key={id} className={`bp-master-option ${masterBrain === id ? "bp-master-option-selected" : ""}`}>
                  <label className="bp-master-option-radio-row">
                    <input
                      type="radio"
                      name="master-brain"
                      value={id}
                      checked={masterBrain === id}
                      disabled={masterBrainSaving}
                      onChange={() => void handleMasterBrainChange(id)}
                    />
                    <span>{t.masterBrainOptionLabel(id)}</span>
                    <span className={`bp-status-pill ${ready ? "bp-status-ok" : "bp-status-bad"}`}>
                      {ready ? t.cliSessionConfigured : t.cliSessionUnavailable}
                    </span>
                  </label>
                  <div className="bp-master-model-row">
                    <label className="sr-only" htmlFor={`master-model-${id}`}>
                      {t.masterModelFieldLabel(id)}
                    </label>
                    <ModelField
                      id={`master-model-${id}`}
                      value={modelDrafts[id]}
                      onChange={(v) => setModelDrafts((s) => ({ ...s, [id]: v }))}
                      placeholder={t.masterModelPlaceholder(id)}
                      models={MASTER_MODEL_OPTIONS[id]}
                      disabled={modelSaving[id]}
                    />
                    <button type="button" onClick={() => void handleSaveModel(id)} disabled={modelSaving[id]}>
                      {modelSaving[id] ? t.savingButton : t.saveButton}
                    </button>
                  </div>
                  {modelSaved[id] && !modelSaving[id] && !modelError[id] && (
                    <div className="bp-save-success">{t.masterModelSaved}</div>
                  )}
                  {modelError[id] && (
                    <div className="bp-form-error" role="alert">
                      {modelError[id]}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {masterBrainSaving && <div className="bp-hint">{t.masterBrainSelectorSaving}</div>}
          {masterBrainSaved && !masterBrainSaving && !masterBrainError && (
            <div className="bp-save-success">{t.masterBrainSelectorSaved}</div>
          )}
          {masterBrainError && (
            <div className="bp-form-error" role="alert">
              {masterBrainError}
            </div>
          )}
          <dl className="bp-master-details">
            <div>
              <dt>{t.authenticationLabel}</dt>
              <dd>{t.authenticationValue}</dd>
            </div>
            <div>
              <dt>{t.consoleApiKeyLabel}</dt>
              <dd>{t.notUsed}</dd>
            </div>
            <div>
              <dt>{t.structuredOutputLabel}</dt>
              <dd>{t.structuredOutputValue}</dd>
            </div>
          </dl>
        </section>

        <section className="bp-section" aria-labelledby="bp-credentials-heading">
          <div className="bp-section-header-row">
            <h3 id="bp-credentials-heading">{t.credentialSourcesHeading}</h3>
            <button type="button" onClick={handleRefreshCredentials} disabled={refreshingCredentials}>
              {refreshingCredentials ? t.refreshingCredentialsButton : t.refreshCredentialsButton}
            </button>
          </div>
          <p className="bp-hint">{t.credentialSourcesHint}</p>
          {refreshCredentialsError && (
            <div className="bp-form-error" role="alert">
              {refreshCredentialsError}
            </div>
          )}
          {credentialStatuses.length === 0 ? (
            <div className="bp-empty">{t.noCredentialSources}</div>
          ) : (
            <div className="bp-table-wrap">
              <table className="bp-table">
                <thead>
                  <tr>
                    <th>{t.colProvider}</th>
                    <th>{t.colSourceId}</th>
                    <th>{t.colStatus}</th>
                  </tr>
                </thead>
                <tbody>
                  {credentialStatuses.map((s) => {
                    // A provider can have more than one real credential source
                    // (e.g. Cline: CLINE_API_KEY or a `cline auth` session —
                    // see LOGIN_PROVIDERS above and factory.ts). An unavailable
                    // row is only ever a real problem if no sibling row for the
                    // same provider is available; otherwise it's just an unused
                    // alternative and showing a bare red "Unavailable" without
                    // that context previously left no way to tell the two apart.
                    const hasAvailableSibling =
                      !s.available &&
                      credentialStatuses.some((other) => other.provider === s.provider && other.id !== s.id && other.available);
                    return (
                      <tr key={s.id}>
                        <td>{s.provider}</td>
                        <td>{s.id}</td>
                        <td>
                          <span className={`bp-status-pill ${s.available ? "bp-status-ok" : "bp-status-bad"}`}>
                            {s.available ? t.available : t.unavailable}
                          </span>
                          {hasAvailableSibling && <div className="bp-hint bp-credential-optional-hint">{t.credentialSourceOptionalHint}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="bp-section" aria-labelledby="bp-profiles-heading">
          <h3 id="bp-profiles-heading">{t.backendProfilesHeading}</h3>
          <p className="bp-hint">{t.providerEditorIntro}</p>

          <div className="bp-provider-editor">
            <nav className="bp-provider-list" aria-label={t.providerListHeading}>
              {listItems.map((item) => {
                const id = item.kind === "login" ? item.provider.id : item.profile.id;
                const label = item.kind === "login" ? (t.lang === "zh-TW" ? item.provider.labelZh : item.provider.labelEn) : item.profile.label;
                const status =
                  item.kind === "login" ? isLoginProviderAvailable(item.provider, credentialStatuses) : statusFor(item.profile);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`bp-provider-list-item ${item.kind === "profile" && !item.profile.enabled ? "bp-provider-list-item-stopped" : ""} ${selectedId === id ? "bp-provider-list-item-active" : ""}`}
                    onClick={() => setSelectedId(id)}
                    aria-current={selectedId === id}
                  >
                    <span className="bp-provider-list-item-label">{label}</span>
                    {item.kind === "login" ? (
                      <span className={`bp-status-pill ${status ? "bp-status-ok" : "bp-status-bad"}`}>
                        {status ? t.available : t.unavailable}
                      </span>
                    ) : (
                      <span className={`bp-status-pill ${(status as { className: string }).className}`}>
                        {(status as { text: string }).text}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            <div className="bp-provider-detail">
              {selectedLogin && (
                <div className="bp-login-detail">
                  <h4>{t.lang === "zh-TW" ? selectedLogin.labelZh : selectedLogin.labelEn}</h4>
                  <p className="bp-hint">{t.loginProviderNote}</p>
                  <div className="bp-login-detail-status">
                    <span
                      className={`bp-status-pill ${
                        isLoginProviderAvailable(selectedLogin, credentialStatuses) ? "bp-status-ok" : "bp-status-bad"
                      }`}
                    >
                      {isLoginProviderAvailable(selectedLogin, credentialStatuses) ? t.cliSessionConfigured : t.cliSessionUnavailable}
                    </span>
                    <button type="button" onClick={handleRefreshCredentials} disabled={refreshingCredentials}>
                      {refreshingCredentials ? t.refreshingCredentialsButton : t.refreshCredentialsButton}
                    </button>
                  </div>
                  {refreshCredentialsError && (
                    <div className="bp-form-error" role="alert">
                      {refreshCredentialsError}
                    </div>
                  )}
                  <p>{t.loginCommandLabel(selectedLogin.loginCommand)}</p>
                </div>
              )}

              {selectedProfile && draft && (
                <form
                  className="bp-provider-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleSave();
                  }}
                >
                  <div className="bp-provider-form-header">
                    <div className="bp-provider-heading-main">
                      <h4>{selectedProfile.label}</h4>
                      <div className="bp-power-control" role="group" aria-label={t.profilePowerControlsLabel}>
                        <button
                          type="button"
                          className="bp-power-start"
                          aria-pressed={selectedProfile.enabled}
                          disabled={profilePowerSaving}
                          onClick={() => void handleProfileEnabledChange(true)}
                        >
                          <span aria-hidden="true">▶</span> {t.startProfileButton}
                        </button>
                        <button
                          type="button"
                          className="bp-power-stop"
                          aria-pressed={!selectedProfile.enabled}
                          disabled={profilePowerSaving}
                          onClick={() => void handleProfileEnabledChange(false)}
                        >
                          <span aria-hidden="true">■</span> {t.stopProfileButton}
                        </button>
                      </div>
                      <p className="bp-power-hint">{profilePowerSaving ? t.changingProfilePower : t.profilePowerHint}</p>
                      {profilePowerError && (
                        <div className="bp-form-error" role="alert">
                          {profilePowerError}
                        </div>
                      )}
                    </div>
                    <span className={`bp-status-pill ${statusFor(selectedProfile).className}`} role="status" aria-live="polite">
                      {statusFor(selectedProfile).text}
                    </span>
                  </div>

                  <div className="bp-field-grid">
                    <label>
                      {t.labelFieldLabel}
                      <input
                        placeholder={t.labelFieldPlaceholder}
                        value={draft.label}
                        onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                        required
                      />
                    </label>
                    <label>
                      {t.apiFormatFieldLabel}
                      <select value={draft.apiFormat} onChange={(e) => setDraft({ ...draft, apiFormat: e.target.value })}>
                        {API_FORMAT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="bp-field-wide">
                      {t.baseUrlEnvVarFieldLabel}
                      <input
                        placeholder={t.baseUrlEnvVarPlaceholder}
                        value={draft.baseUrlInput}
                        onChange={(e) => setDraft({ ...draft, baseUrlInput: e.target.value })}
                      />
                      <span className="bp-field-caption">
                        {selectedProfile.baseUrlEnvVar} — {selectedProfile.available ? t.available : t.unavailable}
                      </span>
                    </label>
                    <label className="bp-field-wide">
                      {t.authTokenEnvVarFieldLabel}
                      <div className="bp-reveal-field">
                        <input
                          type={authTokenRevealed ? "text" : "password"}
                          placeholder={t.authTokenEnvVarPlaceholder}
                          value={draft.authTokenInput}
                          onChange={(e) => setDraft({ ...draft, authTokenInput: e.target.value })}
                        />
                        <button
                          type="button"
                          className="bp-reveal-toggle"
                          onClick={handleToggleReveal}
                          disabled={revealing}
                          aria-label={authTokenRevealed ? t.hideSecretAriaLabel : t.revealSecretAriaLabel}
                          title={authTokenRevealed ? t.hideSecretAriaLabel : t.revealSecretAriaLabel}
                        >
                          {revealing ? "…" : authTokenRevealed ? "🙈" : "👁"}
                        </button>
                      </div>
                      <span className="bp-field-caption">
                        {selectedProfile.authTokenEnvVar} — {selectedProfile.available ? t.available : t.unavailable}
                      </span>
                      {revealError && (
                        <span className="bp-form-error" role="alert">
                          {revealError}
                        </span>
                      )}
                    </label>
                  </div>

                  <fieldset className="bp-fieldset">
                    <legend>{t.roleModelMapHeading}</legend>
                    <p className="bp-hint">{t.roleModelMapHint}</p>
                    <div className="bp-fetch-models-row">
                      <button
                        type="button"
                        disabled={!selectedProfile.enabled || !selectedProfile.available || modelsState?.status === "loading"}
                        onClick={handleFetchModels}
                      >
                        {modelsState?.status === "loading" ? t.fetchingModelsButton : t.fetchModelsButton}
                      </button>
                      {modelsState?.status === "error" && (
                        <span className="bp-form-error" role="alert">
                          {modelsState.error}
                        </span>
                      )}
                      {modelsState?.status === "done" && modelsState.models?.length === 0 && (
                        <span className="bp-hint">{t.noModelsReturned}</span>
                      )}
                    </div>
                    <div className="bp-role-grid">
                      {AGENT_ROLES.map((role) => (
                        <label key={role}>
                          {t.roleLabel(role)}
                          <ModelField
                            value={draft.roleModelMap[role]}
                            onChange={(v) => setDraft({ ...draft, roleModelMap: { ...draft.roleModelMap, [role]: v } })}
                            placeholder={t.roleModelPlaceholder}
                            models={modelsState?.status === "done" ? (modelsState.models ?? []) : null}
                          />
                        </label>
                      ))}
                    </div>
                    <label className="bp-field-wide">
                      {t.fallbackModelFieldLabel}
                      <ModelField
                        value={draft.fallbackModel}
                        onChange={(v) => setDraft({ ...draft, fallbackModel: v })}
                        placeholder={t.roleModelPlaceholder}
                        models={modelsState?.status === "done" ? (modelsState.models ?? []) : null}
                      />
                    </label>
                    <p className="bp-hint">{t.fallbackModelHint}</p>
                  </fieldset>

                  <fieldset className="bp-fieldset">
                    <legend>{t.customHeadersHeading}</legend>
                    <p className="bp-hint">{t.customHeadersHint}</p>
                    {draft.headers.map((h, i) => (
                      <div className="bp-header-row" key={i}>
                        <input
                          placeholder={t.headerKeyPlaceholder}
                          value={h.key}
                          onChange={(e) => {
                            const headers = [...draft.headers];
                            headers[i] = { ...headers[i], key: e.target.value };
                            setDraft({ ...draft, headers });
                          }}
                        />
                        <input
                          placeholder={t.headerValuePlaceholder}
                          value={h.value}
                          onChange={(e) => {
                            const headers = [...draft.headers];
                            headers[i] = { ...headers[i], value: e.target.value };
                            setDraft({ ...draft, headers });
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => setDraft({ ...draft, headers: draft.headers.filter((_, idx) => idx !== i) })}
                        >
                          {t.removeHeaderButton}
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={() => setDraft({ ...draft, headers: [...draft.headers, { key: "", value: "" }] })}>
                      {t.addHeaderButton}
                    </button>
                  </fieldset>

                  <fieldset className="bp-fieldset">
                    <legend>{t.customBodyHeading}</legend>
                    <p className="bp-hint">{t.customBodyHint}</p>
                    <textarea
                      className="bp-json-textarea"
                      placeholder={t.customBodyPlaceholder}
                      value={draft.customBodyText}
                      onChange={(e) => setDraft({ ...draft, customBodyText: e.target.value })}
                      rows={4}
                    />
                  </fieldset>

                  <fieldset className="bp-fieldset">
                    <legend>{t.previewHeading}</legend>
                    <p className="bp-hint">{t.previewHint}</p>
                    <textarea
                      className="bp-json-textarea bp-preview-editable"
                      value={previewText}
                      onChange={(e) => setPreviewText(e.target.value)}
                      rows={12}
                      spellCheck={false}
                    />
                    <div className="bp-preview-actions">
                      <button type="button" onClick={handleApplyPreview}>
                        {t.applyPreviewButton}
                      </button>
                      {previewApplyError && (
                        <span className="bp-form-error" role="alert">
                          {previewApplyError}
                        </span>
                      )}
                    </div>
                  </fieldset>

                  <div className="bp-provider-form-actions">
                    <button type="submit" disabled={saving}>
                      {saving ? t.savingButton : t.saveButton}
                    </button>
                    <button type="button" onClick={resetDraft} disabled={saving}>
                      {t.resetDraftButton}
                    </button>
                    {saved && !saveError && <span className="bp-save-success">{t.saveSuccessNotice}</span>}
                  </div>
                  {saveError && (
                    <div className="bp-form-error" role="alert">
                      {saveError}
                    </div>
                  )}
                </form>
              )}
            </div>
          </div>
        </section>

        <section className="bp-section" aria-labelledby="bp-default-heading">
          <h3 id="bp-default-heading">{t.defaultBackendHeading}</h3>
          <p className="bp-hint">{t.defaultBackendHint}</p>
          <label className="bp-default-select">
            {t.defaultBackendProfileFieldLabel}
            <select
              aria-label={t.defaultBackendProfileFieldLabel}
              value={defaultBackendProfile ?? "official"}
              disabled={settingDefault}
              onChange={(e) => handleSetDefault(e.target.value)}
            >
              <option value="official">{t.officialBackend}</option>
              {backendProfiles.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.enabled && p.id !== defaultBackendProfile}>
                  {p.label}{!p.enabled ? ` (${t.profileStopped})` : ""}
                </option>
              ))}
            </select>
          </label>
          {defaultError && (
            <div className="bp-form-error" role="alert">
              {defaultError}
            </div>
          )}
        </section>

        <section className="bp-section" aria-labelledby="bp-agents-heading">
          <h3 id="bp-agents-heading">{t.agentAssignmentHeading}</h3>
          <p className="bp-hint">{t.agentAssignmentHint}</p>
          <div className="bp-table-wrap">
            <table className="bp-table">
              <thead>
                <tr>
                  <th>{t.colAgent}</th>
                  <th>{t.detailRuntime}</th>
                  <th>{t.colBackendProfile}</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.id}>
                    <td>{agent.id}</td>
                    <td>{t.runtimeLabel(agent.runtime)}</td>
                    <td>
                      {agent.runtime === "claude-code" ? (
                        <select
                          aria-label={t.backendProfileForAgentAriaLabel(agent.id)}
                          value={agent.backendProfile ?? "official"}
                          disabled={assigningAgentId === agent.id}
                          onChange={(e) => handleReassign(agent.id, e.target.value)}
                        >
                          <option value="official">{t.officialBackend}</option>
                          {backendProfiles.map((p) => (
                            <option key={p.id} value={p.id} disabled={!p.enabled && p.id !== agent.backendProfile}>
                              {p.label}{!p.enabled ? ` (${t.profileStopped})` : ""}
                            </option>
                          ))}
                        </select>
                      ) : (
                        // v0.21.3 fix: a non-claude-code agent (OpenCode/Codex/
                        // Cline) never reads a BackendProfile/the Anthropic
                        // credential pool at all — it authenticates entirely
                        // through its own CLI's login (see the Backend &
                        // Credentials panel's login-provider list above). The
                        // disabled dropdown this replaced always showed
                        // "Official (Anthropic)" here regardless of runtime,
                        // which was simply wrong, not just visually confusing.
                        <span className="bp-hint">{t.backendProfileNotApplicable}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {assignError && (
            <div className="bp-form-error" role="alert">
              {assignError}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// v0.21: renders exactly what this profile will resolve to. baseUrlEnvVar/
// authTokenEnvVar still only ever show the env var *name* plus a set/not-set
// status — never the credential's real value, the one boundary this box
// never crosses (see BackendProfileClientInfo's own field comments); those
// two lines are also ignored by handleApplyPreview even if edited, so
// there's no way to "paste a fake status string" into actually changing the
// credential from here.
//
// v0.21.2: header *values* are no longer masked here — this box became a
// two-way editable JSON panel at the operator's own request, and a masked
// "••••" would otherwise get pasted straight back into the real header
// value on Apply. This is a different boundary than baseUrl/authToken:
// those never leave the server at all, while a custom header's value is
// something the operator just typed into `draft.headers` in this same
// browser tab moments ago, so showing it back to them here reveals nothing
// new.
function buildPreview(profile: BackendProfileClientInfo, draft: ProfileDraft): string {
  const roleModelMap: Record<string, string> = {};
  for (const role of AGENT_ROLES) {
    const v = draft.roleModelMap[role]?.trim();
    if (v) roleModelMap[role] = v;
  }
  const headers: Record<string, string> = {};
  for (const h of draft.headers) {
    const key = h.key.trim();
    if (key) headers[key] = h.value;
  }
  let customBodyOverride: unknown = undefined;
  if (draft.customBodyText.trim()) {
    try {
      customBodyOverride = JSON.parse(draft.customBodyText);
    } catch {
      customBodyOverride = "(invalid JSON)";
    }
  }
  const preview = {
    id: profile.id,
    label: draft.label,
    apiFormat: draft.apiFormat,
    // v0.21.2: baseUrl isn't a secret, so this shows the real current input
    // directly now (not a status string) — still ignored by
    // handleApplyPreview, since the dedicated Base URL field above is the
    // one source of truth for it.
    baseUrl: draft.baseUrlInput,
    authTokenEnvVar: `${draft.authTokenInput.trim() ? "(revealed or overridden)" : profile.authTokenEnvVar} — ${profile.available ? "set" : "not set"}`,
    ...(Object.keys(roleModelMap).length > 0 ? { roleModelMap } : {}),
    ...(draft.fallbackModel.trim() ? { fallbackModel: draft.fallbackModel.trim() } : {}),
    ...(Object.keys(headers).length > 0 ? { customHeaders: headers } : {}),
    ...(customBodyOverride !== undefined ? { customBodyOverride } : {}),
  };
  return JSON.stringify(preview, null, 2);
}
