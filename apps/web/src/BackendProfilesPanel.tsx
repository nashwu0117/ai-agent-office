import { useState } from "react";
import type { Agent, BackendProfileClientInfo, CredentialSourceStatus } from "@ai-office/core";
import {
  createBackendProfile,
  deleteBackendProfile,
  fetchBackendProfileModels,
  setAgentBackendProfile,
  setDefaultBackendProfile,
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
// v0.15: the base URL / auth token / model fields still only ever end up
// holding an env var *name* in backend-profiles.json, but the operator is no
// longer required to already know that indirection to use this form —
// pasting the real value is accepted too and gets filed into
// apps/server/.env.local under an auto-derived name server-side (see
// backend-profile-store.ts's resolveEnvVarField). Typing the name directly
// still works exactly as before, for anyone who already has the env var set
// up.

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

  // v0.15: "what model ids can this profile's own key actually see?" — a
  // real call to the provider's own /models endpoint (see index.ts).
  // Accordion, not per-profile: fetching a different profile's list replaces
  // whatever was showing, so the table doesn't accumulate a long chip-list
  // under every profile you've ever checked. Clicking "Fetch models" again
  // on the one already open toggles it closed instead of re-fetching.
  const [modelsState, setModelsState] = useState<{
    id: string;
    status: "loading" | "error" | "done";
    models?: string[];
    error?: string;
  } | null>(null);

  async function handleFetchModels(id: string) {
    if (modelsState?.id === id) {
      setModelsState(null);
      return;
    }
    setModelsState({ id, status: "loading" });
    try {
      const models = await fetchBackendProfileModels(id);
      setModelsState({ id, status: "done", models });
    } catch (err) {
      setModelsState({ id, status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }

  // v0.15: click a fetched model id to set it live — updateBackendProfile's
  // modelOverrideEnvVar already auto-provisions a real value (see
  // backend-profile-store.ts's resolveEnvVarField), so this is the same
  // save path as typing one into the edit form, just one click instead of a
  // copy/paste round trip through apps/server/.env.local.
  const [settingModelFor, setSettingModelFor] = useState<string | null>(null);
  const [setModelError, setSetModelError] = useState<{ id: string; message: string } | null>(null);

  async function handleSetModel(id: string, model: string) {
    setSettingModelFor(`${id}:${model}`);
    setSetModelError(null);
    try {
      await updateBackendProfile(id, { modelOverrideEnvVar: model });
    } catch (err) {
      setSetModelError({ id, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSettingModelFor(null);
    }
  }

  // v0.15: server refuses (409) if any agent is still pinned to the profile
  // — surfaced inline per-row rather than a blocking confirm dialog, since
  // "why won't this delete" is more useful here than "are you sure".
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);

  async function handleDelete(id: string) {
    setDeletingId(id);
    setDeleteError(null);
    try {
      await deleteBackendProfile(id);
    } catch (err) {
      setDeleteError({ id, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setDeletingId(null);
    }
  }

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
          <p className="bp-hint">
            Each profile points a claude-code agent at a different API backend. You can type either an env var name
            (e.g. <code>AI_OFFICE_BACKEND_MY_PROVIDER_BASE_URL</code>) or paste the real base URL/key/model directly
            — pasting a real value stores it in apps/server/.env.local automatically and this table only ever shows
            the resulting variable name, never the value itself.
          </p>
          {backendProfiles.length === 0 ? (
            <div className="bp-empty">{t.noBackendProfiles}</div>
          ) : (
            <div className="bp-table-wrap">
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
                            className="bp-field-wide"
                            aria-label={t.baseUrlEnvVarFieldLabel}
                            value={editDraft.baseUrlEnvVar}
                            onChange={(e) => setEditDraft({ ...editDraft, baseUrlEnvVar: e.target.value })}
                            required
                          />
                          <input
                            className="bp-field-wide"
                            aria-label={t.authTokenEnvVarFieldLabel}
                            value={editDraft.authTokenEnvVar}
                            onChange={(e) => setEditDraft({ ...editDraft, authTokenEnvVar: e.target.value })}
                            required
                          />
                          <input
                            className="bp-field-wide"
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
                    <>
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
                        <td className="bp-model-cell">
                          {p.modelOverrideEnvVar ? <code>{p.modelOverrideEnvVar}</code> : <span className="bp-hint">—</span>}
                          <button
                            type="button"
                            className="bp-fetch-models-btn"
                            disabled={!p.available || (modelsState?.id === p.id && modelsState.status === "loading")}
                            title={p.available ? "Ask this profile's own provider which model ids its key can see" : "Set its env vars first"}
                            onClick={() => handleFetchModels(p.id)}
                          >
                            {modelsState?.id === p.id && modelsState.status === "loading"
                              ? "Fetching…"
                              : modelsState?.id === p.id
                                ? "Hide models"
                                : "Fetch models"}
                          </button>
                        </td>
                        <td>
                          <span className={`bp-status-pill ${p.available ? "bp-status-ok" : "bp-status-bad"}`}>
                            {p.available ? t.profileReady : t.profileMissingEnvVars}
                          </span>
                        </td>
                        <td className="bp-row-actions">
                          <button type="button" onClick={() => startEdit(p)}>
                            {t.editButton}
                          </button>
                          <button type="button" disabled={deletingId === p.id} onClick={() => handleDelete(p.id)}>
                            {deletingId === p.id ? "Deleting…" : "Delete"}
                          </button>
                        </td>
                      </tr>
                      {deleteError?.id === p.id && (
                        <tr key={`${p.id}-delete-error`}>
                          <td colSpan={8}>
                            <div className="bp-form-error" role="alert">
                              {deleteError.message}
                            </div>
                          </td>
                        </tr>
                      )}
                      {modelsState?.id === p.id && (
                        <tr key={`${p.id}-models`}>
                          <td colSpan={8} className="bp-models-cell">
                            {modelsState.status === "error" && (
                              <div className="bp-form-error" role="alert">
                                {modelsState.error}
                              </div>
                            )}
                            {modelsState.status === "done" && (
                              <>
                                {modelsState.models!.length === 0 ? (
                                  <span className="bp-hint">Provider returned an empty model list.</span>
                                ) : (
                                  <>
                                    <span className="bp-hint">
                                      Live from the provider — click one to set it as {p.id}'s model right now (writes it to
                                      apps/server/.env.local and takes effect immediately, no restart):
                                    </span>
                                    <div className="bp-model-list">
                                      {modelsState.models!.map((m) => {
                                        const isCurrent = m === p.currentModel;
                                        return (
                                          <button
                                            key={m}
                                            type="button"
                                            className={isCurrent ? "bp-model-current" : ""}
                                            disabled={settingModelFor === `${p.id}:${m}`}
                                            title={isCurrent ? "Currently set" : `Set ${p.id}'s model to ${m}`}
                                            onClick={() => handleSetModel(p.id, m)}
                                          >
                                            {settingModelFor === `${p.id}:${m}` ? "Setting…" : m}
                                            {isCurrent ? " ✓" : ""}
                                          </button>
                                        );
                                      })}
                                    </div>
                                    {setModelError?.id === p.id && (
                                      <div className="bp-form-error" role="alert">
                                        {setModelError.message}
                                      </div>
                                    )}
                                  </>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  )
                )}
                </tbody>
              </table>
            </div>
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
              <label className="bp-field-wide">
                {t.baseUrlEnvVarFieldLabel}
                <input
                  placeholder={t.baseUrlEnvVarPlaceholder}
                  value={newProfile.baseUrlEnvVar}
                  onChange={(e) => setNewProfile({ ...newProfile, baseUrlEnvVar: e.target.value })}
                  required
                />
              </label>
              <label className="bp-field-wide">
                {t.authTokenEnvVarFieldLabel}
                <input
                  placeholder={t.authTokenEnvVarPlaceholder}
                  value={newProfile.authTokenEnvVar}
                  onChange={(e) => setNewProfile({ ...newProfile, authTokenEnvVar: e.target.value })}
                  required
                />
              </label>
              <label className="bp-field-wide">
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
