import { useState } from "react";
import type { Agent, BackendProfileClientInfo, CredentialSourceStatus } from "@ai-office/core";
import { createBackendProfile, setAgentBackendProfile, setDefaultBackendProfile, updateBackendProfile } from "./ws/client.js";
import { useLanguage } from "./i18n/language-context.js";

// v0.10: Credential / Backend Profile management panel — the UI Part A of
// the v0.10 build prompt calls for, replacing "check the startup log or
// /api/credentials" with an actual page. Every value shown here is
// non-secret: credential availability booleans, and backend profile
// id/label/apiFormat/env-var-*names* (never the values those env vars hold —
// see BackendProfileClientInfo's own field comments). Adding/editing a
// profile only ever asks for which env var name to read a real key from,
// never the key itself.

const API_FORMAT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "anthropic", label: "Anthropic Messages API" },
  { value: "openai-chat-completions", label: "OpenAI Chat Completions (translated)" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  credentialStatuses: CredentialSourceStatus[];
  backendProfiles: BackendProfileClientInfo[];
  /** v0.13 Part E: profile id every not-otherwise-pinned claude-code agent currently falls back to, or null for "official". */
  defaultBackendProfile: string | null;
  agents: Agent[];
}

interface NewProfileForm {
  id: string;
  label: string;
  apiFormat: string;
  baseUrlEnvVar: string;
  authTokenEnvVar: string;
  modelOverrideEnvVar: string;
}

const EMPTY_NEW_PROFILE: NewProfileForm = {
  id: "",
  label: "",
  apiFormat: "anthropic",
  baseUrlEnvVar: "",
  authTokenEnvVar: "",
  modelOverrideEnvVar: "",
};

export function BackendProfilesPanel({
  open,
  onClose,
  credentialStatuses,
  backendProfiles,
  defaultBackendProfile,
  agents,
}: Props) {
  const { t } = useLanguage();
  const [newProfile, setNewProfile] = useState<NewProfileForm>(EMPTY_NEW_PROFILE);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<NewProfileForm | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [assignError, setAssignError] = useState<string | null>(null);
  const [assigningAgentId, setAssigningAgentId] = useState<string | null>(null);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [settingDefault, setSettingDefault] = useState(false);
  const masterCliSession = credentialStatuses.find((source) => source.id === "claude-code-cli-session");

  if (!open) return null;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await createBackendProfile({
        ...newProfile,
        modelOverrideEnvVar: newProfile.modelOverrideEnvVar.trim() || undefined,
      });
      setNewProfile(EMPTY_NEW_PROFILE);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  function startEdit(profile: BackendProfileClientInfo) {
    setEditingId(profile.id);
    setEditDraft({
      id: profile.id,
      label: profile.label,
      apiFormat: profile.apiFormat,
      baseUrlEnvVar: profile.baseUrlEnvVar,
      authTokenEnvVar: profile.authTokenEnvVar,
      modelOverrideEnvVar: profile.modelOverrideEnvVar ?? "",
    });
    setEditError(null);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editDraft) return;
    setEditError(null);
    setSaving(true);
    try {
      await updateBackendProfile(editDraft.id, {
        label: editDraft.label,
        apiFormat: editDraft.apiFormat,
        baseUrlEnvVar: editDraft.baseUrlEnvVar,
        authTokenEnvVar: editDraft.authTokenEnvVar,
        modelOverrideEnvVar: editDraft.modelOverrideEnvVar.trim() || undefined,
      });
      setEditingId(null);
      setEditDraft(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
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
          )}
        </section>

        <section className="bp-section" aria-labelledby="bp-profiles-heading">
          <h3 id="bp-profiles-heading">{t.backendProfilesHeading}</h3>
          <p className="bp-hint">
            {t.backendProfilesHintBefore}
            <em>{t.backendProfilesHintEm}</em>
            {t.backendProfilesHintAfter}
          </p>
          {backendProfiles.length === 0 ? (
            <div className="bp-empty">{t.noBackendProfiles}</div>
          ) : (
            <table className="bp-table">
              <thead>
                <tr>
                  <th>{t.colId}</th>
                  <th>{t.colLabel}</th>
                  <th>{t.colApiFormat}</th>
                  <th>{t.colBaseUrlEnvVar}</th>
                  <th>{t.colAuthTokenEnvVar}</th>
                  <th>{t.colModelOverrideEnvVar}</th>
                  <th>{t.colStatus}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {backendProfiles.map((p) =>
                  editingId === p.id && editDraft ? (
                    <tr key={p.id}>
                      <td colSpan={8}>
                        <form className="bp-edit-form" onSubmit={handleSaveEdit}>
                          <input
                            aria-label={t.labelFieldLabel}
                            value={editDraft.label}
                            onChange={(e) => setEditDraft({ ...editDraft, label: e.target.value })}
                            required
                          />
                          <select
                            aria-label={t.apiFormatFieldLabel}
                            value={editDraft.apiFormat}
                            onChange={(e) => setEditDraft({ ...editDraft, apiFormat: e.target.value })}
                          >
                            {API_FORMAT_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <input
                            aria-label={t.baseUrlEnvVarFieldLabel}
                            value={editDraft.baseUrlEnvVar}
                            onChange={(e) => setEditDraft({ ...editDraft, baseUrlEnvVar: e.target.value })}
                            required
                          />
                          <input
                            aria-label={t.authTokenEnvVarFieldLabel}
                            value={editDraft.authTokenEnvVar}
                            onChange={(e) => setEditDraft({ ...editDraft, authTokenEnvVar: e.target.value })}
                            required
                          />
                          <input
                            aria-label={t.modelOverrideEnvVarFieldLabel}
                            placeholder={t.modelOverrideEnvVarPlaceholder}
                            value={editDraft.modelOverrideEnvVar}
                            onChange={(e) => setEditDraft({ ...editDraft, modelOverrideEnvVar: e.target.value })}
                          />
                          <button type="submit" disabled={saving}>
                            {saving ? t.savingButton : t.saveButton}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null);
                              setEditDraft(null);
                              setEditError(null);
                            }}
                          >
                            {t.cancelButton}
                          </button>
                          {editError && (
                            <div className="bp-form-error" role="alert">
                              {editError}
                            </div>
                          )}
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr key={p.id}>
                      <td>{p.id}</td>
                      <td>{p.label}</td>
                      <td>{API_FORMAT_OPTIONS.find((opt) => opt.value === p.apiFormat)?.label ?? p.apiFormat}</td>
                      <td>
                        <code>{p.baseUrlEnvVar}</code>
                      </td>
                      <td>
                        <code>{p.authTokenEnvVar}</code>
                      </td>
                      <td>{p.modelOverrideEnvVar ? <code>{p.modelOverrideEnvVar}</code> : <span className="bp-hint">—</span>}</td>
                      <td>
                        <span className={`bp-status-pill ${p.available ? "bp-status-ok" : "bp-status-bad"}`}>
                          {p.available ? t.profileReady : t.profileMissingEnvVars}
                        </span>
                      </td>
                      <td>
                        <button type="button" onClick={() => startEdit(p)}>
                          {t.editButton}
                        </button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          )}

          <form className="bp-new-form" onSubmit={handleCreate} aria-label={t.addNewProfileHeading}>
            <h4>{t.addNewProfileHeading}</h4>
            <div className="bp-new-form-grid">
              <label>
                {t.idFieldLabel}
                <input
                  placeholder={t.idFieldPlaceholder}
                  value={newProfile.id}
                  onChange={(e) => setNewProfile({ ...newProfile, id: e.target.value })}
                  required
                />
              </label>
              <label>
                {t.labelFieldLabel}
                <input
                  placeholder={t.labelFieldPlaceholder}
                  value={newProfile.label}
                  onChange={(e) => setNewProfile({ ...newProfile, label: e.target.value })}
                  required
                />
              </label>
              <label>
                {t.apiFormatFieldLabel}
                <select
                  value={newProfile.apiFormat}
                  onChange={(e) => setNewProfile({ ...newProfile, apiFormat: e.target.value })}
                >
                  {API_FORMAT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t.baseUrlEnvVarFieldLabel}
                <input
                  placeholder={t.baseUrlEnvVarPlaceholder}
                  value={newProfile.baseUrlEnvVar}
                  onChange={(e) => setNewProfile({ ...newProfile, baseUrlEnvVar: e.target.value })}
                  required
                />
              </label>
              <label>
                {t.authTokenEnvVarFieldLabel}
                <input
                  placeholder={t.authTokenEnvVarPlaceholder}
                  value={newProfile.authTokenEnvVar}
                  onChange={(e) => setNewProfile({ ...newProfile, authTokenEnvVar: e.target.value })}
                  required
                />
              </label>
              <label>
                {t.modelOverrideEnvVarFieldLabel}
                <input
                  placeholder={t.newModelOverrideEnvVarPlaceholder}
                  value={newProfile.modelOverrideEnvVar}
                  onChange={(e) => setNewProfile({ ...newProfile, modelOverrideEnvVar: e.target.value })}
                />
              </label>
            </div>
            <button type="submit" disabled={creating}>
              {creating ? t.addingButton : t.addProfileButton}
            </button>
            {createError && (
              <div className="bp-form-error" role="alert">
                {createError}
              </div>
            )}
          </form>
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
