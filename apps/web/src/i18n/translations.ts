// v0.17: bilingual (zh-TW / en) UI text. Plain key-value dictionaries rather
// than a full i18n framework — this project has one small SPA and two
// languages, so a library like i18next would be pure overhead.
//
// Values that need runtime data (counts, ids, lists) are functions instead
// of `{placeholder}` template strings — that keeps pluralization/word-order
// differences between English and Chinese as plain, readable code in each
// language's own branch instead of a shared template mini-language.
//
// Static labels in the pixel-art canvas are localized too; live CLI progress
// remains the agent's original message.

export type Lang = "zh-TW" | "en";

export const LANGUAGE_STORAGE_KEY = "ai-office-lang";

export interface Translations {
  lang: Lang;
  languageToggleLabel: string;
  languageToggleAriaLabel: string;

  appTitle: string;
  skipToTaskControls: string;
  backendCredentials: string;

  credentialsPill: (available: number, total: number) => string;
  credentialsAriaLabel: (available: number, total: number, detail: string) => string;
  credentialDetailLine: (provider: string, id: string, available: boolean) => string;

  recentWorkspacePathsLabel: string;
  recentWorkspacePathsEmptyHint: string;
  browseFolderLabel: string;
  folderBrowserTitle: string;
  folderBrowserUp: string;
  folderBrowserSelect: string;
  folderBrowserCancel: string;
  folderBrowserLoading: string;
  folderBrowserEmpty: string;
  folderBrowserCreate: string;
  folderBrowserCreatePlaceholder: string;
  folderBrowserCreatePrompt: string;

  goalFormHeading: string;
  goalDescriptionLabel: string;
  goalDescriptionPlaceholder: string;
  goalWorkspaceLabel: string;
  goalWorkspacePlaceholder: string;
  goalSubmitting: string;
  goalSubmit: string;

  goalPlanningStatus: string;
  goalPlannedStatus: (taskCount: number) => string;
  goalFailedStatus: (reason: string, authFailure: boolean) => string;

  taskFormHeading: string;
  taskDescriptionLabel: string;
  taskDescriptionPlaceholder: string;
  taskWorkspaceLabel: string;
  taskWorkspacePlaceholder: string;
  requiredCapabilities: string;
  taskSubmitting: string;
  taskSubmit: string;

  taskResultsHeading: string;
  completionTitle: (
    kind: "ok" | "security" | "auth" | "backend" | "fail"
  ) => string;
  completionMeta: (agentId: string, filesChanged: string[]) => string;

  agentDetailsAriaLabel: string;
  detailRuntime: string;
  detailBackend: string;
  officialBackend: string;
  detailApiFormat: string;
  apiFormatUnknown: string;
  detailState: string;
  detailTask: string;
  detailWorkspace: string;
  detailEligibleFor: string;
  detailGrantedNow: string;
  liveCliOutput: string;
  emptyValue: string;

  queueHeading: (count: number) => string;
  queueEmpty: string;
  queueNeeds: (capabilities: string[]) => string;
  queuePendingLabel: string;
  queuePendingDetail: (waitedSeconds: number) => string;
  queueBlockedLabel: string;
  queueBlockedDetail: (deps: string[]) => string;
  queueBlockedFailedLabel: string;
  queueBlockedFailedDetail: (deps: string[]) => string;
  queueDependencyDetailsUnavailable: string;

  announceSnapshot: (agentCount: number, taskCount: number) => string;
  announceCredentialStatus: (available: number, total: number) => string;
  announceBackendProfiles: (count: number) => string;
  announceAgentReassigned: (agentId: string, backendProfile: string) => string;
  announceDefaultBackendChanged: (backendProfile: string) => string;
  announceAgentStateChanged: (agentId: string, state: string, taskId?: string) => string;
  announceTaskUpdated: (title: string, status: string) => string;
  announceTaskCompleted: (taskId: string, agentId: string, summary: string) => string;
  announceTaskFailed: (
    kind: "security" | "auth" | "backend" | "generic",
    taskId: string,
    reason: string
  ) => string;
  announceGoalPlanning: (goal: string) => string;
  announceGoalPlanned: (taskCount: number, goal: string) => string;
  announceGoalFailed: (goal: string, reason: string, authFailure: boolean) => string;
  announceGoalSummary: (goal: string, summary: string) => string;

  agentStateLabel: (state: string) => string;
  taskStatusLabel: (status: string) => string;
  capabilityLabel: (capability: string) => string;
  runtimeLabel: (runtime: string) => string;
  apiFormatLabel: (format: string) => string;

  // OfficeScene accessible fallback and localized canvas labels
  officeSceneHeading: string;
  officeSceneSummary: string;
  officeAgentsListLabel: string;
  officeCanvasTitle: string;
  officeZoneReception: string;
  officeZoneOpenOffice: string;
  officeZonePantry: string;
  officeZoneMeetingRoom: (room: number) => string;
  officeWorkingMessage: string;
  officeWaitingMessage: string;
  officeResizeHandle: string;
  officeResizeHint: string;
  agentAccessLabel: (agentId: string, state: string, progress?: string) => string;

  // BackendProfilesPanel
  closeBackendPanel: string;
  masterBrainHeading: string;
  claudeSubscriptionLogin: string;
  masterBrainDescBefore: string;
  masterBrainDescAfter: string;
  cliSessionConfigured: string;
  cliSessionUnavailable: string;
  authenticationLabel: string;
  authenticationValue: string;
  consoleApiKeyLabel: string;
  notUsed: string;
  structuredOutputLabel: string;
  structuredOutputValue: string;

  credentialSourcesHeading: string;
  credentialSourcesHint: string;
  credentialSourceOptionalHint: string;
  noCredentialSources: string;
  colProvider: string;
  colSourceId: string;
  colStatus: string;
  available: string;
  unavailable: string;
  refreshCredentialsButton: string;
  refreshingCredentialsButton: string;

  // v0.21: cc-switch-style single-provider editor, replacing the old
  // table-of-profiles-plus-add-form UI (BackendProfilesPanel.tsx).
  backendProfilesHeading: string;
  providerEditorIntro: string;
  providerListHeading: string;
  noBackendProfiles: string;
  colId: string;
  colLabel: string;
  colApiFormat: string;
  profileReady: string;
  profileMissingEnvVars: string;
  profileNeedsFormat: string;
  saveButton: string;
  savingButton: string;
  resetDraftButton: string;
  saveSuccessNotice: string;

  labelFieldLabel: string;
  labelFieldPlaceholder: string;
  apiFormatFieldLabel: string;
  baseUrlEnvVarFieldLabel: string;
  authTokenEnvVarFieldLabel: string;
  baseUrlEnvVarPlaceholder: string;
  authTokenEnvVarPlaceholder: string;
  revealSecretAriaLabel: string;
  hideSecretAriaLabel: string;

  // Login-based providers (Claude Code official, Codex, Cline, OpenCode) —
  // no Base URL/API key fields, just login status + how-to-login text.
  loginProviderNote: string;
  loginCommandLabel: (command: string) => string;

  roleModelMapHeading: string;
  roleModelMapHint: string;
  roleLabel: (role: string) => string;
  roleModelPlaceholder: string;
  fallbackModelFieldLabel: string;
  fallbackModelHint: string;
  fetchModelsButton: string;
  fetchingModelsButton: string;
  noModelsReturned: string;

  customHeadersHeading: string;
  customHeadersHint: string;
  headerKeyPlaceholder: string;
  headerValuePlaceholder: string;
  addHeaderButton: string;
  removeHeaderButton: string;

  customBodyHeading: string;
  customBodyHint: string;
  customBodyPlaceholder: string;

  previewHeading: string;
  previewHint: string;
  applyPreviewButton: string;

  validationLabelRequired: string;
  validationCustomBodyInvalidJson: string;
  validationHeaderReserved: (name: string) => string;

  defaultBackendHeading: string;
  defaultBackendHint: string;
  defaultBackendProfileFieldLabel: string;

  agentAssignmentHeading: string;
  agentAssignmentHint: string;
  colAgent: string;
  colBackendProfile: string;
  backendProfileForAgentAriaLabel: (agentId: string) => string;
  backendProfileNotApplicable: string;

  // v0.22 Part A: direct "point at an agent" assignment, bypassing capability
  // matching — see the assign mini-form inside the agent detail panel.
  taskSourceLabel: (source: "auto" | "manual" | "master") => string;
  assignFormHeading: (agentId: string) => string;
  assignFormHint: string;
  assignDescriptionLabel: string;
  assignDescriptionPlaceholder: string;
  assignWorkspaceLabel: string;
  assignWorkspacePlaceholder: string;
  assignSubmitting: string;
  assignSubmit: string;
  assignBusyWarning: (agentId: string, state: string) => string;
  assignBusyQueueButton: string;
  assignBusyCancelButton: string;
  announceTaskAssigned: (agentId: string, queued: boolean) => string;

  // v0.22 Part B: Master Brain backend selector.
  masterBrainSelectorHeading: string;
  masterBrainSelectorHint: string;
  masterBrainOptionLabel: (id: string) => string;
  masterBrainSelectorSaving: string;
  masterBrainSelectorSaved: string;
  masterBrainCredentialMissing: (label: string, hint: string) => string;
  /** v0.22.1: per-backend --model override field. */
  masterModelFieldLabel: (id: string) => string;
  masterModelPlaceholder: (id: string) => string;
  masterModelSaved: string;
  masterModelListHint: string;

  // v0.22 Part C: meeting-room handoff visualization + click-to-view transcript.
  meetingRoomStatusBusy: string;
  meetingRoomStatusIdle: string;
  meetingRoomTableAriaLabel: (room: number, busy: boolean) => string;
  meetingRoomPanelHeading: (room: number) => string;
  meetingRoomNoTranscript: string;
  meetingRoomFromLabel: string;
  meetingRoomToLabel: string;
  meetingRoomHandoffTaskLabel: string;
  meetingRoomMessageLabel: string;
  meetingRoomTimeLabel: string;
  closeMeetingRoomPanel: string;

  // v0.22 Part D: Master's own visible character in the office scene.
  masterCharacterLabel: string;
  masterIdleBubble: string;
  masterPlanningBubble: string;
  masterDetailStatus: string;
  masterDetailBackend: string;
  masterDetailModel: string;
  masterDetailCurrentGoals: string;
  masterDetailNoGoals: string;
  closeMasterPanel: string;
  masterDetailTasks: string;
  masterDetailNoTasks: string;
  detailCurrentWork: string;
  detailTaskStatus: string;
  detailTaskSource: string;

  // v0.18: access-auth login gate — see AuthGate.tsx.
  loginHeading: string;
  loginDescription: string;
  loginNoPasswordConfigured: string;
  loginPasswordLabel: string;
  loginPasswordPlaceholder: string;
  loginSubmitting: string;
  loginSubmit: string;
  logoutButton: string;
}

const AGENT_STATE_LABELS_EN: Record<string, string> = {
  created: "created",
  available: "available",
  assigned: "assigned",
  starting: "starting",
  working: "working",
  waiting: "waiting",
  blocked: "blocked",
  error: "error",
  done: "done",
  releasing: "releasing",
};

const AGENT_STATE_LABELS_ZH: Record<string, string> = {
  created: "已建立",
  available: "待命中",
  assigned: "已指派",
  starting: "啟動中",
  working: "工作中",
  waiting: "等待中",
  blocked: "已阻擋",
  error: "錯誤",
  done: "已完成",
  releasing: "釋放中",
};

const TASK_STATUS_LABELS_EN: Record<string, string> = {
  pending: "pending",
  assigned: "assigned",
  in_progress: "in progress",
  waiting: "waiting",
  blocked: "blocked",
  blocked_failed_dependency: "blocked, dependency failed",
  done: "done",
  failed: "failed",
};

const TASK_STATUS_LABELS_ZH: Record<string, string> = {
  pending: "待處理",
  assigned: "已指派",
  in_progress: "進行中",
  waiting: "等待中",
  blocked: "已阻擋",
  blocked_failed_dependency: "已阻擋(相依任務失敗)",
  done: "已完成",
  failed: "失敗",
};

const CAPABILITY_LABELS_EN: Record<string, string> = {
  backend: "backend",
  frontend: "frontend",
  testing: "testing",
  docs: "docs",
};

const CAPABILITY_LABELS_ZH: Record<string, string> = {
  backend: "後端",
  frontend: "前端",
  testing: "測試",
  docs: "文件",
};

const RUNTIME_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  cline: "Cline",
  codex: "Codex",
};

const API_FORMAT_LABELS: Record<string, string> = {
  anthropic: "Anthropic Messages API",
  "openai-chat-completions": "OpenAI Chat Completions (translated)",
};

const en: Translations = {
  lang: "en",
  languageToggleLabel: "中文",
  languageToggleAriaLabel: "Switch to Traditional Chinese",

  appTitle: "AI Office — Vertical Slice",
  skipToTaskControls: "Skip to task controls",
  backendCredentials: "Backend & Credentials",

  credentialsPill: (available, total) => `Credentials: ${available}/${total} available`,
  credentialsAriaLabel: (available, total, detail) => `Credentials: ${available} of ${total} available. ${detail}`,
  credentialDetailLine: (provider, id, available) => `${provider}/${id}: ${available ? "available" : "unavailable"}`,

  recentWorkspacePathsLabel: "Recent folder paths",
  recentWorkspacePathsEmptyHint: "No recent paths yet — they'll show up here after your first successful submit.",
  browseFolderLabel: "Browse folders on this machine",
  folderBrowserTitle: "Choose a folder",
  folderBrowserUp: "Up one level",
  folderBrowserSelect: "Select this folder",
  folderBrowserCancel: "Cancel",
  folderBrowserLoading: "Loading…",
  folderBrowserEmpty: "No subfolders here.",
  folderBrowserCreate: "Create folder",
  folderBrowserCreatePlaceholder: "New folder name",
  folderBrowserCreatePrompt: "Enter a folder name first.",

  goalFormHeading: "High-level goal (Master plans it for you)",
  goalDescriptionLabel: "High-level goal",
  goalDescriptionPlaceholder:
    "e.g. Add an install section to README.md, and add a simple string-utils test in utils/",
  goalWorkspaceLabel: "Goal workspace folder path",
  goalWorkspacePlaceholder: "Local folder path (shared by every subtask), e.g. /home/you/some-project",
  goalSubmitting: "Sending to Master…",
  goalSubmit: "Ask Master to plan & dispatch",

  goalPlanningStatus: "Master is planning…",
  goalPlannedStatus: (taskCount) => `Planned ${taskCount} subtask${taskCount === 1 ? "" : "s"} — dispatching…`,
  goalFailedStatus: (reason, authFailure) =>
    `Master planning failed${authFailure ? " (authentication)" : ""}: ${reason}`,

  taskFormHeading: "Manual task (pick capabilities yourself)",
  taskDescriptionLabel: "Manual task description",
  taskDescriptionPlaceholder: "Task description, e.g. Add a project intro section to README.md",
  taskWorkspaceLabel: "Task workspace folder path",
  taskWorkspacePlaceholder: "Local folder path, e.g. /home/you/some-project",
  requiredCapabilities: "Required capabilities:",
  taskSubmitting: "Dispatching…",
  taskSubmit: "Dispatch task",

  taskResultsHeading: "Task results",
  completionTitle: (kind) =>
    kind === "ok"
      ? "Task completed"
      : kind === "security"
        ? "Security failure: workspace isolation violation"
        : kind === "auth"
          ? "Authentication failure"
          : kind === "backend"
            ? "Backend profile error"
            : "Task failed",
  completionMeta: (agentId, filesChanged) =>
    `agent: ${agentId}${filesChanged.length > 0 ? ` · files: ${filesChanged.join(", ")}` : ""}`,

  agentDetailsAriaLabel: "Agent details",
  detailRuntime: "Runtime",
  detailBackend: "Backend",
  officialBackend: "Official (Anthropic)",
  detailApiFormat: "API format",
  apiFormatUnknown: "unknown (profile not registered)",
  detailState: "State",
  detailTask: "Task",
  detailWorkspace: "Workspace",
  detailEligibleFor: "Eligible for",
  detailGrantedNow: "Granted now",
  liveCliOutput: "Live CLI output",
  emptyValue: "—",

  queueHeading: (count) => `Queue (${count})`,
  queueEmpty: "No tasks waiting for an agent.",
  queueNeeds: (capabilities) => `needs: ${capabilities.length > 0 ? capabilities.join(", ") : "any"}`,
  queuePendingLabel: "⌛ Pending",
  queuePendingDetail: (waitedSeconds) => `— waiting ${waitedSeconds}s`,
  queueBlockedLabel: "⏸ Blocked",
  queueBlockedDetail: (deps) => `— waiting on: ${deps.length > 0 ? deps.join(", ") : "a prior task"}`,
  queueBlockedFailedLabel: "✕ Blocked — dependency failed",
  queueBlockedFailedDetail: (deps) => `: ${deps.length > 0 ? deps.join(", ") : "a prior task"}`,
  queueDependencyDetailsUnavailable: "Failure details are not available in the current snapshot.",

  announceSnapshot: (agentCount, taskCount) =>
    `Office updated. ${agentCount} agent${agentCount === 1 ? "" : "s"} and ${taskCount} task${taskCount === 1 ? "" : "s"} loaded.`,
  announceCredentialStatus: (available, total) => `Credential status updated. ${available} of ${total} available.`,
  announceBackendProfiles: (count) => `Backend profiles updated. ${count} profile${count === 1 ? "" : "s"} registered.`,
  announceAgentReassigned: (agentId, backendProfile) =>
    `${agentId} reassigned to backend profile: ${backendProfile}.`,
  announceDefaultBackendChanged: (backendProfile) =>
    `Default backend profile for unassigned agents is now: ${backendProfile}.`,
  announceAgentStateChanged: (agentId, state, taskId) =>
    `${agentId} is now ${state}${taskId ? ` on task ${taskId}` : ""}.`,
  announceTaskUpdated: (title, status) => `Task ${title} is now ${status}.`,
  announceTaskCompleted: (taskId, agentId, summary) => `Task ${taskId} completed by ${agentId}. ${summary}`,
  announceTaskFailed: (kind, taskId, reason) =>
    `${
      kind === "security"
        ? "Security failure"
        : kind === "auth"
          ? "Authentication failure"
          : kind === "backend"
            ? "Backend profile error"
            : "Task failure"
    }: ${taskId}, ${reason}`,
  announceGoalPlanning: (goal) => `Master is planning the goal: ${goal}.`,
  announceGoalPlanned: (taskCount, goal) => `Master planned ${taskCount} subtasks for ${goal}. Dispatching now.`,
  announceGoalFailed: (goal, reason, authFailure) =>
    `Master planning failed for ${goal}${authFailure ? " (subscription login or usage limit)" : ""}: ${reason}`,
  announceGoalSummary: (goal, summary) => `Master summary ready for ${goal}: ${summary}`,

  agentStateLabel: (state) => AGENT_STATE_LABELS_EN[state] ?? state.replaceAll("_", " "),
  taskStatusLabel: (status) => TASK_STATUS_LABELS_EN[status] ?? status.replaceAll("_", " "),
  capabilityLabel: (capability) => CAPABILITY_LABELS_EN[capability] ?? capability,
  runtimeLabel: (runtime) => RUNTIME_LABELS[runtime] ?? runtime,
  apiFormatLabel: (format) => API_FORMAT_LABELS[format] ?? format,

  officeSceneHeading: "Live office agent status",
  officeSceneSummary:
    "The pixel-art canvas is decorative. Use the following agent buttons to open the same agent details with a keyboard or screen reader.",
  officeAgentsListLabel: "Office agents",
  officeCanvasTitle: "LIVE OFFICE  //  FLOOR 01",
  officeZoneReception: "RECEPTION",
  officeZoneOpenOffice: "OPEN OFFICE",
  officeZonePantry: "PANTRY",
  officeZoneMeetingRoom: (room) => `MEETING ${room}`,
  officeWorkingMessage: "WORKING...",
  officeWaitingMessage: "WAITING FOR WORKSPACE...",
  officeResizeHandle: "Resize the live office",
  officeResizeHint: "Drag to resize proportionally. Arrow keys resize; double-click resets.",
  agentAccessLabel: (agentId, state, progress) =>
    `${agentId}, ${state}${progress ? `, ${progress}` : ""}. Open agent details.`,

  closeBackendPanel: "Close backend and credentials panel",
  masterBrainHeading: "Master Brain",
  claudeSubscriptionLogin: "Claude subscription login",
  masterBrainDescBefore: "Runs ",
  masterBrainDescAfter:
    " in headless mode using the Claude Code CLI's existing Claude.ai Pro/Max login session.",
  cliSessionConfigured: "CLI session configured",
  cliSessionUnavailable: "CLI session unavailable",
  authenticationLabel: "Authentication",
  authenticationValue: "Claude.ai subscription session (OAuth)",
  consoleApiKeyLabel: "Console API key",
  notUsed: "Not used",
  structuredOutputLabel: "Structured output",
  structuredOutputValue: "CLI JSON + JSON Schema",

  credentialSourcesHeading: "Credential sources",
  credentialSourcesHint:
    "Runtime-agent credential sources only. Values themselves are never shown here — only whether a source looks usable. Master Brain is subscription-only as shown above and never reads these API-key sources.",
  credentialSourceOptionalHint: "Optional — another source for this provider is already available, so this one can be ignored.",
  noCredentialSources: "No credential sources detected.",
  colProvider: "Provider",
  colSourceId: "Source id",
  colStatus: "Status",
  available: "Available",
  unavailable: "Unavailable",
  refreshCredentialsButton: "Refresh",
  refreshingCredentialsButton: "Refreshing…",

  backendProfilesHeading: "Backend profiles",
  providerEditorIntro:
    "Pick a provider on the left to edit it in full — name, Base URL, API key, upstream format, per-role model mapping, fallback model, custom headers/body, and a live preview of what this actually resolves to. Base URL isn't a secret, so it's always shown; the API key stays masked until you click 👁 to reveal it (leave it blank to keep the current one, or type/paste a new one to overwrite).",
  providerListHeading: "Providers",
  noBackendProfiles: "No backend profiles registered yet.",
  colId: "Id",
  colLabel: "Label",
  colApiFormat: "API format",
  profileReady: "Ready",
  profileMissingEnvVars: "Missing env var(s)",
  profileNeedsFormat: "Needs format selection",
  saveButton: "Save",
  savingButton: "Saving…",
  resetDraftButton: "Reset unsaved changes",
  saveSuccessNotice: "Saved.",

  labelFieldLabel: "Label",
  labelFieldPlaceholder: "e.g. My Provider API",
  apiFormatFieldLabel: "API format",
  baseUrlEnvVarFieldLabel: "Base URL",
  authTokenEnvVarFieldLabel: "API key",
  baseUrlEnvVarPlaceholder: "not set yet — type an env var name or paste a real URL",
  authTokenEnvVarPlaceholder: "leave blank to keep current — click 👁 to reveal it, or type/paste a new key to overwrite",
  revealSecretAriaLabel: "Show the real API key (it will be sent to this browser)",
  hideSecretAriaLabel: "Hide the API key again",

  loginProviderNote:
    "This provider authenticates through its own CLI's login session, not a Base URL/API key pair — there's nothing to edit here beyond checking whether that login is in place.",
  loginCommandLabel: (command) => `Run ${command} in a terminal to sign in.`,

  roleModelMapHeading: "Role → model mapping",
  roleModelMapHint:
    "When this agent's CLI requests each model family, send this upstream model id instead. Sonnet/Opus/Haiku/Fable are matched against the model family the CLI actually requested; Subagent has no reliable wire-level signal of its own, so it's used only as a catch-all for a request that matches none of the other four — see the field's own note. Leave a role blank to fall through to Fallback model below.",
  roleLabel: (role) => ({ sonnet: "Sonnet", opus: "Opus", fable: "Fable", haiku: "Haiku", subagent: "Subagent (best-effort catch-all)" })[role] ?? role,
  roleModelPlaceholder: "e.g. meta/llama-3.1-70b-instruct",
  fallbackModelFieldLabel: "Fallback model",
  fallbackModelHint: "Used when a request's role has no mapping above. Leave blank for no rewrite at all.",
  fetchModelsButton: "Fetch models",
  fetchingModelsButton: "Fetching…",
  noModelsReturned: "Provider returned an empty model list.",

  customHeadersHeading: "Custom headers",
  customHeadersHint:
    "Extra static headers this upstream requires beyond the API key above (e.g. a pinned API version). Can't override x-api-key, authorization, or host — those always come from the API key field.",
  headerKeyPlaceholder: "Header name",
  headerValuePlaceholder: "Header value",
  addHeaderButton: "Add header",
  removeHeaderButton: "Remove",

  customBodyHeading: "Custom body override (JSON)",
  customBodyHint: "A JSON object shallow-merged into every outgoing request body for this provider, after model resolution.",
  customBodyPlaceholder: '{\n  "extra_param": true\n}',

  previewHeading: "Live preview",
  previewHint:
    "What this profile resolves to — edit or paste JSON here and click Apply to write it back into the fields above (name, role mapping, fallback model, custom headers/body). The baseUrlEnvVar/authTokenEnvVar lines are reference-only status strings, never the real credential, and editing them here does nothing — use the Base URL/API key fields above for those.",
  applyPreviewButton: "Apply to fields above",

  validationLabelRequired: "Label is required.",
  validationCustomBodyInvalidJson: "Custom body override must be valid JSON (a plain object, e.g. { \"key\": \"value\" }).",
  validationHeaderReserved: (name) => `"${name}" can't be a custom header — it's set from the API key field.`,

  defaultBackendHeading: "Default backend for unassigned agents",
  defaultBackendHint:
    "Applies only to a claude-code agent with no individual assignment below and no hardcoded default of its own — it never overrides either of those. Persisted, and takes effect immediately for every agent that currently qualifies (each one's row below updates to match), with no restart needed.",
  defaultBackendProfileFieldLabel: "Default backend profile",

  agentAssignmentHeading: "Agent → backend assignment",
  agentAssignmentHint:
    "Only claude-code agents read a backend profile. Changing this takes effect starting with that agent's next dispatched task — no restart needed.",
  colAgent: "Agent",
  colBackendProfile: "Backend profile",
  backendProfileForAgentAriaLabel: (agentId) => `Backend profile for ${agentId}`,
  backendProfileNotApplicable: "N/A — this runtime authenticates through its own CLI login, not a BackendProfile",

  taskSourceLabel: (source) =>
    source === "manual" ? "Manually assigned" : source === "master" ? "Master-planned" : "Auto-matched",
  assignFormHeading: (agentId) => `Assign a task directly to ${agentId}`,
  assignFormHint: "Bypasses capability matching entirely — this exact agent will do it, whatever their eligible capabilities are.",
  assignDescriptionLabel: "Task description",
  assignDescriptionPlaceholder: "e.g. Rename the config file and update its one import",
  assignWorkspaceLabel: "Workspace folder path",
  assignWorkspacePlaceholder: "Local folder path, e.g. /home/you/some-project",
  assignSubmitting: "Assigning…",
  assignSubmit: "Assign to this agent",
  assignBusyWarning: (agentId, state) =>
    `${agentId} is currently busy (${state}). Queue this task for them — it'll start as soon as they're free — or cancel and pick someone else.`,
  assignBusyQueueButton: "Queue it for them",
  assignBusyCancelButton: "Cancel",
  announceTaskAssigned: (agentId, queued) =>
    queued ? `Task queued for ${agentId}; they're currently busy.` : `Task assigned directly to ${agentId}.`,

  masterBrainSelectorHeading: "Master Brain backend",
  masterBrainSelectorHint:
    "Which backend drives the single Master planner's plan()/summarize() calls. Takes effect on the next goal submitted; persists across restarts.",
  masterBrainOptionLabel: (id) =>
    id === "claude-code" ? "Claude Code CLI (Claude.ai subscription login)" : id === "codex" ? "Codex CLI (ChatGPT/API login)" : id,
  masterBrainSelectorSaving: "Saving…",
  masterBrainSelectorSaved: "Saved — the next goal will use this backend.",
  masterBrainCredentialMissing: (label, hint) => `${label} has no usable login session yet. ${hint}`,
  masterModelFieldLabel: (id) => `Model for ${id === "codex" ? "Codex CLI" : "Claude Code CLI"}`,
  masterModelPlaceholder: (id) =>
    id === "codex" ? "e.g. gpt-5-codex — leave blank for the CLI's own default" : "e.g. sonnet, opus — leave blank for the CLI's own default",
  masterModelSaved: "Saved — the next plan()/summarize() call will use this model.",
  masterModelListHint:
    "\"—\" means no --model flag (the CLI's own default). These lists aren't a live/complete catalog — Claude Code's three come from `claude --help`'s own --model documentation; Codex's two are the model ids actually present in this machine's ~/.codex/config.toml.",

  meetingRoomStatusBusy: "In session",
  meetingRoomStatusIdle: "Idle",
  meetingRoomTableAriaLabel: (room, busy) => `Meeting room ${room} table, ${busy ? "in session" : "idle"} — click for the transcript`,
  meetingRoomPanelHeading: (room) => `Meeting Room ${room}`,
  meetingRoomNoTranscript: "No handoff has happened in this room yet.",
  meetingRoomFromLabel: "From",
  meetingRoomToLabel: "To",
  meetingRoomHandoffTaskLabel: "Handoff",
  meetingRoomMessageLabel: "Message",
  meetingRoomTimeLabel: "Time",
  closeMeetingRoomPanel: "Close",

  masterCharacterLabel: "MASTER",
  masterIdleBubble: "Standing by",
  masterPlanningBubble: "Planning…",
  masterDetailStatus: "Status",
  masterDetailBackend: "Backend",
  masterDetailModel: "Model",
  masterDetailCurrentGoals: "Current goals",
  masterDetailNoGoals: "No goals have been submitted yet.",
  closeMasterPanel: "Close Master details",
  masterDetailTasks: "Tasks created by Master",
  masterDetailNoTasks: "Master has not created any tasks yet.",
  detailCurrentWork: "Current work",
  detailTaskStatus: "Task status",
  detailTaskSource: "Task source",

  loginHeading: "AI Office — sign in",
  loginDescription: "This is being accessed from outside localhost, so a password is required.",
  loginNoPasswordConfigured:
    "No AI_OFFICE_ACCESS_PASSWORD is set on the server yet — remote access is disabled until the operator sets one in apps/server/.env.local and restarts.",
  loginPasswordLabel: "Password",
  loginPasswordPlaceholder: "Password",
  loginSubmitting: "Signing in…",
  loginSubmit: "Sign in",
  logoutButton: "Log out",
};

const zhTW: Translations = {
  lang: "zh-TW",
  languageToggleLabel: "EN",
  languageToggleAriaLabel: "切換為英文",

  appTitle: "AI Office — 垂直切片",
  skipToTaskControls: "跳至任務控制區",
  backendCredentials: "後端與憑證",

  credentialsPill: (available, total) => `憑證:${available}/${total} 可用`,
  credentialsAriaLabel: (available, total, detail) => `憑證:${total} 個來源中有 ${available} 個可用。${detail}`,
  credentialDetailLine: (provider, id, available) => `${provider}/${id}:${available ? "可用" : "不可用"}`,

  recentWorkspacePathsLabel: "最近使用的資料夾路徑",
  recentWorkspacePathsEmptyHint: "目前還沒有最近路徑,成功送出一次後就會出現在這裡。",
  browseFolderLabel: "瀏覽本機資料夾",
  folderBrowserTitle: "選擇資料夾",
  folderBrowserUp: "上一層",
  folderBrowserSelect: "選擇此資料夾",
  folderBrowserCancel: "取消",
  folderBrowserLoading: "載入中…",
  folderBrowserEmpty: "這裡沒有子資料夾。",
  folderBrowserCreate: "建立資料夾",
  folderBrowserCreatePlaceholder: "新資料夾名稱",
  folderBrowserCreatePrompt: "請先輸入資料夾名稱。",

  goalFormHeading: "高階目標(由 Master 為你規劃)",
  goalDescriptionLabel: "高階目標",
  goalDescriptionPlaceholder: "例如:在 README.md 加入安裝說明章節,並在 utils/ 加一個簡單的字串工具測試",
  goalWorkspaceLabel: "目標工作區資料夾路徑",
  goalWorkspacePlaceholder: "本機資料夾路徑(所有子任務共用),例如 /home/you/some-project",
  goalSubmitting: "傳送給 Master 中…",
  goalSubmit: "請 Master 規劃並派工",

  goalPlanningStatus: "Master 規劃中…",
  goalPlannedStatus: (taskCount) => `已規劃 ${taskCount} 個子任務 — 派工中…`,
  goalFailedStatus: (reason, authFailure) => `Master 規劃失敗${authFailure ? "(驗證問題)" : ""}:${reason}`,

  taskFormHeading: "手動任務(自行選擇所需能力)",
  taskDescriptionLabel: "手動任務描述",
  taskDescriptionPlaceholder: "任務描述,例如:在 README.md 加入專案簡介章節",
  taskWorkspaceLabel: "任務工作區資料夾路徑",
  taskWorkspacePlaceholder: "本機資料夾路徑,例如 /home/you/some-project",
  requiredCapabilities: "所需能力:",
  taskSubmitting: "派工中…",
  taskSubmit: "派送任務",

  taskResultsHeading: "任務結果",
  completionTitle: (kind) =>
    kind === "ok"
      ? "任務已完成"
      : kind === "security"
        ? "安全性失敗:工作區隔離違規"
        : kind === "auth"
          ? "驗證失敗"
          : kind === "backend"
            ? "後端設定檔錯誤"
            : "任務失敗",
  completionMeta: (agentId, filesChanged) =>
    `代理:${agentId}${filesChanged.length > 0 ? ` · 檔案:${filesChanged.join("、")}` : ""}`,

  agentDetailsAriaLabel: "代理詳細資料",
  detailRuntime: "執行環境",
  detailBackend: "後端",
  officialBackend: "官方(Anthropic)",
  detailApiFormat: "API 格式",
  apiFormatUnknown: "未知(設定檔未註冊)",
  detailState: "狀態",
  detailTask: "任務",
  detailWorkspace: "工作區",
  detailEligibleFor: "可承接",
  detailGrantedNow: "目前授權",
  liveCliOutput: "即時 CLI 輸出",
  emptyValue: "—",

  queueHeading: (count) => `佇列(${count})`,
  queueEmpty: "目前沒有任務在等待代理。",
  queueNeeds: (capabilities) => `需要:${capabilities.length > 0 ? capabilities.join("、") : "任意"}`,
  queuePendingLabel: "⌛ 待處理",
  queuePendingDetail: (waitedSeconds) => `— 已等待 ${waitedSeconds} 秒`,
  queueBlockedLabel: "⏸ 已阻擋",
  queueBlockedDetail: (deps) => `— 等待:${deps.length > 0 ? deps.join("、") : "前置任務"}`,
  queueBlockedFailedLabel: "✕ 已阻擋 — 相依任務失敗",
  queueBlockedFailedDetail: (deps) => `:${deps.length > 0 ? deps.join("、") : "前置任務"}`,
  queueDependencyDetailsUnavailable: "目前快照沒有這些失敗原因的詳細資料。",

  announceSnapshot: (agentCount, taskCount) => `辦公室已更新。已載入 ${agentCount} 個代理與 ${taskCount} 個任務。`,
  announceCredentialStatus: (available, total) => `憑證狀態已更新。${total} 個來源中有 ${available} 個可用。`,
  announceBackendProfiles: (count) => `後端設定檔已更新。目前註冊 ${count} 個設定檔。`,
  announceAgentReassigned: (agentId, backendProfile) => `${agentId} 已改指派至後端設定檔:${backendProfile}。`,
  announceDefaultBackendChanged: (backendProfile) => `未指定代理的預設後端現在是:${backendProfile}。`,
  announceAgentStateChanged: (agentId, state, taskId) => `${agentId} 現在是${state}${taskId ? `,處理任務 ${taskId}` : ""}。`,
  announceTaskUpdated: (title, status) => `任務「${title}」現在是${status}。`,
  announceTaskCompleted: (taskId, agentId, summary) => `任務 ${taskId} 已由 ${agentId} 完成。${summary}`,
  announceTaskFailed: (kind, taskId, reason) =>
    `${
      kind === "security"
        ? "安全性失敗"
        : kind === "auth"
          ? "驗證失敗"
          : kind === "backend"
            ? "後端設定檔錯誤"
            : "任務失敗"
    }:${taskId},${reason}`,
  announceGoalPlanning: (goal) => `Master 正在規劃目標:${goal}。`,
  announceGoalPlanned: (taskCount, goal) => `Master 已為「${goal}」規劃 ${taskCount} 個子任務,開始派工。`,
  announceGoalFailed: (goal, reason, authFailure) =>
    `Master 為「${goal}」規劃失敗${authFailure ? "(訂閱登入或用量已達上限)" : ""}:${reason}`,
  announceGoalSummary: (goal, summary) => `Master 已完成「${goal}」的摘要:${summary}`,

  agentStateLabel: (state) => AGENT_STATE_LABELS_ZH[state] ?? state.replaceAll("_", " "),
  taskStatusLabel: (status) => TASK_STATUS_LABELS_ZH[status] ?? status.replaceAll("_", " "),
  capabilityLabel: (capability) => CAPABILITY_LABELS_ZH[capability] ?? capability,
  runtimeLabel: (runtime) => RUNTIME_LABELS[runtime] ?? runtime,
  apiFormatLabel: (format) => API_FORMAT_LABELS[format] ?? format,

  officeSceneHeading: "即時辦公室代理狀態",
  officeSceneSummary: "這個像素風畫布僅為裝飾效果。請使用下方的代理按鈕,以鍵盤或螢幕報讀器開啟相同的代理詳細資料。",
  officeAgentsListLabel: "辦公室代理",
  officeCanvasTitle: "即時辦公室  //  一樓",
  officeZoneReception: "接待區",
  officeZoneOpenOffice: "開放辦公區",
  officeZonePantry: "茶水間",
  officeZoneMeetingRoom: (room) => `會議室 ${room}`,
  officeWorkingMessage: "正在處理任務…",
  officeWaitingMessage: "等待工作區…",
  officeResizeHandle: "調整即時辦公室大小",
  officeResizeHint: "拖曳可等比例縮放；方向鍵可調整大小，按兩下可重設。",
  agentAccessLabel: (agentId, state, progress) => `${agentId},${state}${progress ? `,${progress}` : ""}。開啟代理詳細資料。`,

  closeBackendPanel: "關閉後端與憑證面板",
  masterBrainHeading: "Master 大腦",
  claudeSubscriptionLogin: "Claude 訂閱登入",
  masterBrainDescBefore: "以無頭模式執行 ",
  masterBrainDescAfter: ",使用 Claude Code CLI 既有的 Claude.ai Pro/Max 登入工作階段。",
  cliSessionConfigured: "CLI 工作階段已設定",
  cliSessionUnavailable: "CLI 工作階段無法使用",
  authenticationLabel: "驗證方式",
  authenticationValue: "Claude.ai 訂閱工作階段(OAuth)",
  consoleApiKeyLabel: "主控台 API 金鑰",
  notUsed: "未使用",
  structuredOutputLabel: "結構化輸出",
  structuredOutputValue: "CLI JSON + JSON Schema",

  credentialSourcesHeading: "憑證來源",
  credentialSourcesHint:
    "僅列出執行期代理使用的憑證來源。這裡從不顯示實際值,只顯示來源是否可用。如上所示,Master 大腦僅使用訂閱登入,不會讀取這些 API 金鑰來源。",
  credentialSourceOptionalHint: "非必要——此提供者已有其他可用來源,這一筆可以忽略。",
  noCredentialSources: "未偵測到任何憑證來源。",
  colProvider: "提供者",
  colSourceId: "來源 ID",
  colStatus: "狀態",
  available: "可用",
  unavailable: "不可用",
  refreshCredentialsButton: "重新整理",
  refreshingCredentialsButton: "重新整理中…",

  backendProfilesHeading: "後端設定檔",
  providerEditorIntro:
    "在左側選一個供應商,即可在這裡完整編輯它:名稱、Base URL、API 金鑰、上游格式、角色→模型對應、Fallback 模型、自訂 headers/body,以及即時預覽。Base URL 不是密鑰,所以一律直接顯示;API 金鑰預設遮住,點 👁 才會顯示真正的值(留空表示保持目前的金鑰,輸入或貼上新值即可覆寫)。",
  providerListHeading: "供應商",
  noBackendProfiles: "尚未註冊任何後端設定檔。",
  colId: "ID",
  colLabel: "名稱",
  colApiFormat: "API 格式",
  profileReady: "就緒",
  profileMissingEnvVars: "缺少環境變數",
  profileNeedsFormat: "尚未選擇格式",
  saveButton: "儲存",
  savingButton: "儲存中…",
  resetDraftButton: "還原未儲存的變更",
  saveSuccessNotice: "已儲存。",

  labelFieldLabel: "名稱",
  labelFieldPlaceholder: "例如 My Provider API",
  apiFormatFieldLabel: "API 格式",
  baseUrlEnvVarFieldLabel: "Base URL",
  authTokenEnvVarFieldLabel: "API 金鑰",
  baseUrlEnvVarPlaceholder: "尚未設定 — 輸入環境變數名稱或直接貼上真實網址",
  authTokenEnvVarPlaceholder: "留空 = 保持不變 — 點 👁 可看到目前的金鑰,或直接輸入/貼上新的覆寫",
  revealSecretAriaLabel: "顯示真正的 API 金鑰(會傳到這個瀏覽器)",
  hideSecretAriaLabel: "再次隱藏 API 金鑰",

  loginProviderNote: "這個供應商是透過自己 CLI 的登入工作階段驗證,不是 Base URL/API 金鑰組合——這裡沒有欄位可編輯,只能確認登入狀態。",
  loginCommandLabel: (command) => `在終端機執行 ${command} 以登入。`,

  roleModelMapHeading: "角色 → 模型對應",
  roleModelMapHint:
    "當這個代理的 CLI 請求各模型家族時,改送出這個上游模型 ID。Sonnet/Opus/Haiku/Fable 是依 CLI 實際請求的模型家族比對;Subagent 沒有可靠的線路層訊號,只會在請求不符合前四者時當作後備使用——詳見欄位本身的說明。留空的角色會落到下方的 Fallback 模型。",
  roleLabel: (role) =>
    ({ sonnet: "Sonnet", opus: "Opus", fable: "Fable", haiku: "Haiku", subagent: "Subagent(盡力而為的後備)" })[role] ?? role,
  roleModelPlaceholder: "例如 meta/llama-3.1-70b-instruct",
  fallbackModelFieldLabel: "Fallback 模型",
  fallbackModelHint: "當某個角色在上方沒有對應時使用。留空則完全不改寫。",
  fetchModelsButton: "取得模型清單",
  fetchingModelsButton: "取得中…",
  noModelsReturned: "供應商回傳空的模型清單。",

  customHeadersHeading: "自訂 Headers",
  customHeadersHint: "上游除了上方 API 金鑰之外還需要的額外固定 headers(例如指定的 API 版本)。不能覆寫 x-api-key、authorization 或 host——這些一律來自 API 金鑰欄位。",
  headerKeyPlaceholder: "Header 名稱",
  headerValuePlaceholder: "Header 值",
  addHeaderButton: "新增 header",
  removeHeaderButton: "移除",

  customBodyHeading: "自訂 Body 覆寫(JSON)",
  customBodyHint: "在模型解析完成後,淺層合併進這個供應商每一次請求 body 的 JSON 物件。",
  customBodyPlaceholder: '{\n  "extra_param": true\n}',

  previewHeading: "即時預覽",
  previewHint:
    "這組設定實際會解析成什麼——可以直接在這裡編輯或貼上 JSON,按「套用到上方欄位」就會寫回名稱、角色對應、Fallback 模型、自訂 headers/body。baseUrlEnvVar/authTokenEnvVar 這兩行只是參考用的狀態字串,不是真正的密鑰,在這裡改它們不會有作用——要改 Base URL/API 金鑰請用上面各自的欄位。",
  applyPreviewButton: "套用到上方欄位",

  validationLabelRequired: "名稱為必填。",
  validationCustomBodyInvalidJson: "自訂 Body 覆寫必須是合法 JSON(一個物件,例如 { \"key\": \"value\" })。",
  validationHeaderReserved: (name) => `「${name}」不能作為自訂 header——它是由 API 金鑰欄位設定的。`,

  defaultBackendHeading: "未指定代理的預設後端",
  defaultBackendHint:
    "僅套用於下方沒有個別指派、也沒有自帶預設值的 claude-code 代理,並不會覆蓋這兩種情況。此設定會被保存,並立即套用到目前所有符合條件的代理(下方每一列會同步更新),不需要重新啟動。",
  defaultBackendProfileFieldLabel: "預設後端設定檔",

  agentAssignmentHeading: "代理 → 後端指派",
  agentAssignmentHint: "只有 claude-code 代理會讀取後端設定檔。變更會從該代理下一個派送的任務開始生效,不需要重新啟動。",
  colAgent: "代理",
  colBackendProfile: "後端設定檔",
  backendProfileForAgentAriaLabel: (agentId) => `${agentId} 的後端設定檔`,
  backendProfileNotApplicable: "不適用——這個執行環境是透過自己的 CLI 登入驗證,不是後端設定檔",

  taskSourceLabel: (source) => (source === "manual" ? "手動指派" : source === "master" ? "Master 拆解" : "系統自動配對"),
  assignFormHeading: (agentId) => `直接指派任務給 ${agentId}`,
  assignFormHint: "完全略過能力配對——不論這位員工目前的 eligibleCapabilities 是什麼,都會是他來做。",
  assignDescriptionLabel: "任務描述",
  assignDescriptionPlaceholder: "例如:把設定檔重新命名,並更新唯一一處的匯入路徑",
  assignWorkspaceLabel: "工作區資料夾路徑",
  assignWorkspacePlaceholder: "本機資料夾路徑,例如 /home/you/some-project",
  assignSubmitting: "指派中…",
  assignSubmit: "指派給這位員工",
  assignBusyWarning: (agentId, state) =>
    `${agentId} 目前忙碌中(${state})。可以把這個任務排進他的個人佇列——等他忙完會自動接手——或取消改點別人。`,
  assignBusyQueueButton: "排進他的佇列",
  assignBusyCancelButton: "取消",
  announceTaskAssigned: (agentId, queued) =>
    queued ? `任務已排入 ${agentId} 的佇列,他目前忙碌中。` : `任務已直接指派給 ${agentId}。`,

  masterBrainSelectorHeading: "Master Brain 後端",
  masterBrainSelectorHint: "決定唯一的 Master 規劃者呼叫 plan()/summarize() 時使用哪個後端。從下一次提交高階目標開始生效;會持久保存,重啟後仍在。",
  masterBrainOptionLabel: (id) =>
    id === "claude-code" ? "Claude Code CLI(Claude.ai 訂閱登入)" : id === "codex" ? "Codex CLI(ChatGPT/API 登入)" : id,
  masterBrainSelectorSaving: "儲存中…",
  masterBrainSelectorSaved: "已儲存——下一次規劃會使用這個後端。",
  masterBrainCredentialMissing: (label, hint) => `${label} 目前沒有可用的登入工作階段。${hint}`,
  masterModelFieldLabel: (id) => `${id === "codex" ? "Codex CLI" : "Claude Code CLI"} 的模型`,
  masterModelPlaceholder: (id) => (id === "codex" ? "例如 gpt-5-codex——留空則使用 CLI 自己的預設值" : "例如 sonnet、opus——留空則使用 CLI 自己的預設值"),
  masterModelSaved: "已儲存——下一次呼叫 plan()/summarize() 會使用這個模型。",
  masterModelListHint:
    "「—」代表不加 --model 參數(用 CLI 自己的預設值)。這份清單不是即時或完整的型錄——Claude Code 的三個選項來自 claude --help 自己文件裡列出的 --model 別名;Codex 的兩個是這台機器 ~/.codex/config.toml 裡實際出現過的模型 id。",

  meetingRoomStatusBusy: "會議進行中",
  meetingRoomStatusIdle: "空閒中",
  meetingRoomTableAriaLabel: (room, busy) => `第 ${room} 會議室的桌子,${busy ? "會議進行中" : "空閒中"}——點擊查看交接內容`,
  meetingRoomPanelHeading: (room) => `第 ${room} 會議室`,
  meetingRoomNoTranscript: "這間會議室目前還沒有發生過交接。",
  meetingRoomFromLabel: "交接方",
  meetingRoomToLabel: "接手方",
  meetingRoomHandoffTaskLabel: "交接內容",
  meetingRoomMessageLabel: "訊息",
  meetingRoomTimeLabel: "時間",
  closeMeetingRoomPanel: "關閉",

  masterCharacterLabel: "MASTER",
  masterIdleBubble: "待命中",
  masterPlanningBubble: "規劃中…",
  masterDetailStatus: "狀態",
  masterDetailBackend: "後端",
  masterDetailModel: "模型",
  masterDetailCurrentGoals: "目前目標",
  masterDetailNoGoals: "目前還沒有提交任何目標。",
  closeMasterPanel: "關閉 Master 詳細資料",
  masterDetailTasks: "Master 建立的任務",
  masterDetailNoTasks: "Master 目前還沒有建立任務。",
  detailCurrentWork: "目前工作",
  detailTaskStatus: "任務狀態",
  detailTaskSource: "任務來源",

  loginHeading: "AI Office — 登入",
  loginDescription: "目前是從 localhost 以外的來源連進來,需要輸入密碼才能繼續。",
  loginNoPasswordConfigured: "伺服器尚未設定 AI_OFFICE_ACCESS_PASSWORD——在使用者於 apps/server/.env.local 設定並重啟伺服器前,遠端連線會被拒絕。",
  loginPasswordLabel: "密碼",
  loginPasswordPlaceholder: "密碼",
  loginSubmitting: "登入中…",
  loginSubmit: "登入",
  logoutButton: "登出",
};

export const translations: Record<Lang, Translations> = {
  en,
  "zh-TW": zhTW,
};
