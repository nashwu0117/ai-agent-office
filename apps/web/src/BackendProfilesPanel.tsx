import { useState } from "react";
import type { Agent, BackendProfileClientInfo, CredentialSourceStatus } from "@ai-office/core";
import { createBackendProfile, setAgentBackendProfile, setDefaultBackendProfile, updateBackendProfile } from "./ws/client.js";

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
          <h2 id="bp-panel-heading">Backend &amp; Credentials</h2>
          <button type="button" className="bp-close" onClick={onClose} aria-label="Close backend and credentials panel">
            ✕
          </button>
        </div>

        <section className="bp-section" aria-labelledby="bp-master-heading">
          <h3 id="bp-master-heading">Master Brain</h3>
          <div className="bp-master-mode">
            <div>
              <strong>Claude subscription login</strong>
              <p>
                Runs <code>claude -p</code> in headless mode using the Claude Code CLI&apos;s existing Claude.ai
                Pro/Max login session.
              </p>
            </div>
            <span className={`bp-status-pill ${masterCliSession?.available ? "bp-status-ok" : "bp-status-bad"}`}>
              {masterCliSession?.available ? "CLI session configured" : "CLI session unavailable"}
            </span>
          </div>
          <dl className="bp-master-details">
            <div>
              <dt>Authentication</dt>
              <dd>Claude.ai subscription session (OAuth)</dd>
            </div>
            <div>
              <dt>Console API key</dt>
              <dd>Not used</dd>
            </div>
            <div>
              <dt>Structured output</dt>
              <dd>CLI JSON + JSON Schema</dd>
            </div>
          </dl>
        </section>

        <section className="bp-section" aria-labelledby="bp-credentials-heading">
          <h3 id="bp-credentials-heading">Credential sources</h3>
          <p className="bp-hint">
            Runtime-agent credential sources only. Values themselves are never shown here — only whether a source
            looks usable. Master Brain is subscription-only as shown above and never reads these API-key sources.
          </p>
          {credentialStatuses.length === 0 ? (
            <div className="bp-empty">No credential sources detected.</div>
          ) : (
            <table className="bp-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Source id</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {credentialStatuses.map((s) => (
                  <tr key={s.id}>
                    <td>{s.provider}</td>
                    <td>{s.id}</td>
                    <td>
                      <span className={`bp-status-pill ${s.available ? "bp-status-ok" : "bp-status-bad"}`}>
                        {s.available ? "Available" : "Unavailable"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="bp-section" aria-labelledby="bp-profiles-heading">
          <h3 id="bp-profiles-heading">Backend profiles</h3>
          <p className="bp-hint">
            Each profile points a claude-code agent at a different API backend. Only the environment variable{" "}
            <em>names</em> are configured here — set the actual base URL/token as environment variables on this
            server before an agent using this profile can run a task.
          </p>
          {backendProfiles.length === 0 ? (
            <div className="bp-empty">No backend profiles registered yet.</div>
          ) : (
            <table className="bp-table">
              <thead>
                <tr>
                  <th>Id</th>
                  <th>Label</th>
                  <th>API format</th>
                  <th>Base URL env var</th>
                  <th>Auth token env var</th>
                  <th>Model override env var</th>
                  <th>Status</th>
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
                            aria-label="Label"
                            value={editDraft.label}
                            onChange={(e) => setEditDraft({ ...editDraft, label: e.target.value })}
                            required
                          />
                          <select
                            aria-label="API format"
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
                            aria-label="Base URL environment variable name"
                            value={editDraft.baseUrlEnvVar}
                            onChange={(e) => setEditDraft({ ...editDraft, baseUrlEnvVar: e.target.value })}
                            required
                          />
                          <input
                            aria-label="Auth token environment variable name"
                            value={editDraft.authTokenEnvVar}
                            onChange={(e) => setEditDraft({ ...editDraft, authTokenEnvVar: e.target.value })}
                            required
                          />
                          <input
                            aria-label="Model override environment variable name (optional)"
                            placeholder="optional, e.g. AI_OFFICE_NVIDIA_MODEL"
                            value={editDraft.modelOverrideEnvVar}
                            onChange={(e) => setEditDraft({ ...editDraft, modelOverrideEnvVar: e.target.value })}
                          />
                          <button type="submit" disabled={saving}>
                            {saving ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null);
                              setEditDraft(null);
                              setEditError(null);
                            }}
                          >
                            Cancel
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
                          {p.available ? "Ready" : "Missing env var(s)"}
                        </span>
                      </td>
                      <td>
                        <button type="button" onClick={() => startEdit(p)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          )}

          <form className="bp-new-form" onSubmit={handleCreate} aria-label="Add a new backend profile">
            <h4>Add a new backend profile</h4>
            <div className="bp-new-form-grid">
              <label>
                Id
                <input
                  placeholder="e.g. my-provider"
                  value={newProfile.id}
                  onChange={(e) => setNewProfile({ ...newProfile, id: e.target.value })}
                  required
                />
              </label>
              <label>
                Label
                <input
                  placeholder="e.g. My Provider API"
                  value={newProfile.label}
                  onChange={(e) => setNewProfile({ ...newProfile, label: e.target.value })}
                  required
                />
              </label>
              <label>
                API format
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
                Base URL env var name
                <input
                  placeholder="e.g. AI_OFFICE_BACKEND_MY_PROVIDER_BASE_URL"
                  value={newProfile.baseUrlEnvVar}
                  onChange={(e) => setNewProfile({ ...newProfile, baseUrlEnvVar: e.target.value })}
                  required
                />
              </label>
              <label>
                Auth token env var name
                <input
                  placeholder="e.g. AI_OFFICE_BACKEND_MY_PROVIDER_AUTH_TOKEN"
                  value={newProfile.authTokenEnvVar}
                  onChange={(e) => setNewProfile({ ...newProfile, authTokenEnvVar: e.target.value })}
                  required
                />
              </label>
              <label>
                Model override env var name (optional)
                <input
                  placeholder="optional — e.g. AI_OFFICE_BACKEND_MY_PROVIDER_MODEL"
                  value={newProfile.modelOverrideEnvVar}
                  onChange={(e) => setNewProfile({ ...newProfile, modelOverrideEnvVar: e.target.value })}
                />
              </label>
            </div>
            <button type="submit" disabled={creating}>
              {creating ? "Adding…" : "Add profile"}
            </button>
            {createError && (
              <div className="bp-form-error" role="alert">
                {createError}
              </div>
            )}
          </form>
        </section>

        <section className="bp-section" aria-labelledby="bp-default-heading">
          <h3 id="bp-default-heading">Default backend for unassigned agents</h3>
          <p className="bp-hint">
            Applies only to a claude-code agent with no individual assignment below and no hardcoded default of its
            own — it never overrides either of those. Persisted, and takes effect immediately for every agent that
            currently qualifies (each one's row below updates to match), with no restart needed.
          </p>
          <label className="bp-default-select">
            Default backend profile
            <select
              aria-label="Default backend profile for unassigned agents"
              value={defaultBackendProfile ?? "official"}
              disabled={settingDefault}
              onChange={(e) => handleSetDefault(e.target.value)}
            >
              <option value="official">Official (Anthropic)</option>
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
          <h3 id="bp-agents-heading">Agent → backend assignment</h3>
          <p className="bp-hint">
            Only claude-code agents read a backend profile. Changing this takes effect starting with that agent's
            next dispatched task — no restart needed.
          </p>
          <table className="bp-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Runtime</th>
                <th>Backend profile</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id}>
                  <td>{agent.id}</td>
                  <td>{agent.runtime}</td>
                  <td>
                    <select
                      aria-label={`Backend profile for ${agent.id}`}
                      value={agent.backendProfile ?? "official"}
                      disabled={agent.runtime !== "claude-code" || assigningAgentId === agent.id}
                      onChange={(e) => handleReassign(agent.id, e.target.value)}
                    >
                      <option value="official">Official (Anthropic)</option>
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
