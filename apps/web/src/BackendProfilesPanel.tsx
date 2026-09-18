import { useEffect, useMemo, useState } from "react";
import { AGENT_ROLES, type Agent, type AgentRole, type BackendProfileClientInfo, type CredentialSourceStatus } from "@ai-office/core";
import { setAgentBackendProfile, setDefaultBackendProfile, updateBackendProfile } from "./ws/client.js";
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

interface LoginProvider {
  id: string;
  labelEn: string;
  labelZh: string;
  credentialSourceId: string;
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
    credentialSourceId: "claude-code-cli-session",
    loginCommand: "claude auth login",
  },
  {
    id: "official-opencode",
    labelEn: "OpenCode CLI",
    labelZh: "OpenCode CLI",
    credentialSourceId: "opencode-cli-session",
    loginCommand: "opencode auth login",
  },
  {
    id: "official-codex",
    labelEn: "Codex CLI",
    labelZh: "Codex CLI",
    credentialSourceId: "codex-cli-session",
    loginCommand: "codex login",
  },
  {
    id: "official-cline",
    labelEn: "Cline CLI",
    labelZh: "Cline CLI",
    credentialSourceId: "cline-key-primary",
    loginCommand: "cline auth (or set CLINE_API_KEY)",
  },
];

interface ProfileDraft {
  label: string;
  apiFormat: string;
  baseUrlInput: string;
  authTokenInput: string;
  modelOverrideInput: string;
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
    baseUrlInput: "",
    authTokenInput: "",
    modelOverrideInput: p.modelOverrideEnvVar ?? "",
    roleModelMap: { ...EMPTY_ROLE_MAP, ...(p.roleModelMap ?? {}) },
    fallbackModel: p.fallbackModel ?? "",
    headers: Object.entries(p.customHeaders ?? {}).map(([key, value]) => ({ key, value })),
    customBodyText: p.customBodyOverride && Object.keys(p.customBodyOverride).length > 0 ? JSON.stringify(p.customBodyOverride, null, 2) : "",
  };
}

const RESERVED_HEADER_NAMES = new Set(["x-api-key", "authorization", "host"]);

interface Props {
  open: boolean;
  onClose: () => void;
  credentialStatuses: CredentialSourceStatus[];
  backendProfiles: BackendProfileClientInfo[];
  /** v0.13 Part E: profile id every not-otherwise-pinned claude-code agent currently falls back to, or null for "official". */
  defaultBackendProfile: string | null;
  agents: Agent[];
}

export function BackendProfilesPanel({ open, onClose, credentialStatuses, backendProfiles, defaultBackendProfile, agents }: Props) {
  const { t } = useLanguage();
  const masterCliSession = credentialStatuses.find((source) => source.id === "claude-code-cli-session");

  const [assignError, setAssignError] = useState<string | null>(null);
  const [assigningAgentId, setAssigningAgentId] = useState<string | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [settingDefault, setSettingDefault] = useState(false);

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

  function resetDraft() {
    if (selectedProfile) setDraft(draftFromProfile(selectedProfile));
    setSaveError(null);
    setSaved(false);
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
        ...(draft.baseUrlInput.trim() ? { baseUrlEnvVar: draft.baseUrlInput.trim() } : {}),
        ...(draft.authTokenInput.trim() ? { authTokenEnvVar: draft.authTokenInput.trim() } : {}),
        modelOverrideEnvVar: draft.modelOverrideInput.trim() || undefined,
        roleModelMap,
        fallbackModel: draft.fallbackModel.trim() || undefined,
        customHeaders,
        customBodyOverride,
      });
      setDraft((d) => (d ? { ...d, baseUrlInput: "", authTokenInput: "" } : d));
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
          <div className="bp-master-mode">
            <div>
              <strong>{t.claudeSubscriptionLogin}</strong>
              <p>
                {t.masterBrainDescBefore}
                <code>claude -p</code>
                {t.masterBrainDescAfter}
              </p>
            </div>
            <span className={`bp-status-pill ${masterCliSession?.available ? "bp-status-ok" : "bp-status-bad"}`}>
              {masterCliSession?.available ? t.cliSessionConfigured : t.cliSessionUnavailable}
            </span>
          </div>
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
          <h3 id="bp-credentials-heading">{t.credentialSourcesHeading}</h3>
          <p className="bp-hint">{t.credentialSourcesHint}</p>
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
                  {credentialStatuses.map((s) => (
                    <tr key={s.id}>
                      <td>{s.provider}</td>
                      <td>{s.id}</td>
                      <td>
                        <span className={`bp-status-pill ${s.available ? "bp-status-ok" : "bp-status-bad"}`}>
                          {s.available ? t.available : t.unavailable}
                        </span>
                      </td>
                    </tr>
                  ))}
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
                  item.kind === "login"
                    ? credentialStatuses.find((s) => s.id === item.provider.credentialSourceId)?.available
                    : statusFor(item.profile);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`bp-provider-list-item ${selectedId === id ? "bp-provider-list-item-active" : ""}`}
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
                  <span
                    className={`bp-status-pill ${
                      credentialStatuses.find((s) => s.id === selectedLogin.credentialSourceId)?.available ? "bp-status-ok" : "bp-status-bad"
                    }`}
                  >
                    {credentialStatuses.find((s) => s.id === selectedLogin.credentialSourceId)?.available
                      ? t.cliSessionConfigured
                      : t.cliSessionUnavailable}
                  </span>
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
                    <h4>{selectedProfile.label}</h4>
                    <span className={`bp-status-pill ${statusFor(selectedProfile).className}`}>{statusFor(selectedProfile).text}</span>
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
                      <input
                        type="password"
                        placeholder={t.authTokenEnvVarPlaceholder}
                        value={draft.authTokenInput}
                        onChange={(e) => setDraft({ ...draft, authTokenInput: e.target.value })}
                      />
                      <span className="bp-field-caption">
                        {selectedProfile.authTokenEnvVar} — {selectedProfile.available ? t.available : t.unavailable}
                      </span>
                    </label>
                  </div>

                  <fieldset className="bp-fieldset">
                    <legend>{t.roleModelMapHeading}</legend>
                    <p className="bp-hint">{t.roleModelMapHint}</p>
                    <div className="bp-role-grid">
                      {AGENT_ROLES.map((role) => (
                        <label key={role}>
                          {t.roleLabel(role)}
                          <input
                            placeholder={t.roleModelPlaceholder}
                            value={draft.roleModelMap[role]}
                            onChange={(e) => setDraft({ ...draft, roleModelMap: { ...draft.roleModelMap, [role]: e.target.value } })}
                          />
                        </label>
                      ))}
                    </div>
                    <label className="bp-field-wide">
                      {t.fallbackModelFieldLabel}
                      <input
                        placeholder={t.roleModelPlaceholder}
                        value={draft.fallbackModel}
                        onChange={(e) => setDraft({ ...draft, fallbackModel: e.target.value })}
                      />
                    </label>
                    <p className="bp-hint">{t.fallbackModelHint}</p>
                  </fieldset>

                  <fieldset className="bp-fieldset">
                    <legend>{t.legacyModelOverrideHeading}</legend>
                    <label className="bp-field-wide">
                      {t.modelOverrideEnvVarFieldLabel}
                      <input
                        placeholder={t.modelOverrideEnvVarPlaceholder}
                        value={draft.modelOverrideInput}
                        onChange={(e) => setDraft({ ...draft, modelOverrideInput: e.target.value })}
                      />
                    </label>
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
                    <pre className="bp-preview">{buildPreview(selectedProfile, draft)}</pre>
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
                <option key={p.id} value={p.id}>
                  {p.label}
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
                      <select
                        aria-label={t.backendProfileForAgentAriaLabel(agent.id)}
                        value={agent.backendProfile ?? "official"}
                        disabled={agent.runtime !== "claude-code" || assigningAgentId === agent.id}
                        onChange={(e) => handleReassign(agent.id, e.target.value)}
                      >
                        <option value="official">{t.officialBackend}</option>
                        {backendProfiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
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

// v0.21: renders exactly what this profile will resolve to — never a stored
// secret value, only whether baseUrl/authToken are set (from the server's
// own `available`/env-var-*name* fields, the same boundary every other
// value in this panel respects) and the plain-string, never-secret bits
// (role map / fallback model / header names / body override) as-is. Header
// *values* are masked since an operator could plausibly put something
// sensitive in one (see customHeaders' own doc comment on why this project
// doesn't assume otherwise).
function buildPreview(profile: BackendProfileClientInfo, draft: ProfileDraft): string {
  const roleModelMap: Record<string, string> = {};
  for (const role of AGENT_ROLES) {
    const v = draft.roleModelMap[role]?.trim();
    if (v) roleModelMap[role] = v;
  }
  const headers: Record<string, string> = {};
  for (const h of draft.headers) {
    const key = h.key.trim();
    if (key) headers[key] = "••••";
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
    baseUrlEnvVar: `${draft.baseUrlInput.trim() ? "(new value)" : profile.baseUrlEnvVar} — ${profile.available ? "set" : "not set"}`,
    authTokenEnvVar: `${draft.authTokenInput.trim() ? "(new value)" : profile.authTokenEnvVar} — ${profile.available ? "set" : "not set"}`,
    ...(draft.modelOverrideInput.trim() ? { legacyModelOverrideEnvVar: draft.modelOverrideInput.trim() } : {}),
    ...(Object.keys(roleModelMap).length > 0 ? { roleModelMap } : {}),
    ...(draft.fallbackModel.trim() ? { fallbackModel: draft.fallbackModel.trim() } : {}),
    ...(Object.keys(headers).length > 0 ? { customHeaders: headers } : {}),
    ...(customBodyOverride !== undefined ? { customBodyOverride } : {}),
  };
  return JSON.stringify(preview, null, 2);
}
