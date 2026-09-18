// v0.17: bilingual (zh-TW / en) UI text. Plain key-value dictionaries rather
// than a full i18n framework — this project has one small SPA and two
// languages, so a library like i18next would be pure overhead.
//
// Values that need runtime data (counts, ids, lists) are functions instead
// of `{placeholder}` template strings — that keeps pluralization/word-order
// differences between English and Chinese as plain, readable code in each
// language's own branch instead of a shared template mini-language.
//
// Not covered here: the pixel-art canvas in OfficeScene (zone signs, the
// company mark, task-bubble text) and a few decorative CSS ::before/::after
// HUD labels in index.css. Both are English-only bitmap/CSS content with no
// CJK glyphs available, so localizing them would mean drawing a second
// pixel font — out of scope for this pass. Everything else a user reads
// (forms, panels, queue, agent detail, announcements) is bilingual.

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

  // OfficeScene accessible fallback (the canvas itself stays decorative/English)
  officeSceneHeading: string;
  officeSceneSummary: string;
  officeAgentsListLabel: string;
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
  noCredentialSources: string;
  colProvider: string;
  colSourceId: string;
  colStatus: string;
  available: string;
  unavailable: string;

  backendProfilesHeading: string;
  backendProfilesHintBefore: string;
  backendProfilesHintEm: string;
  backendProfilesHintAfter: string;
  noBackendProfiles: string;
  colId: string;
  colLabel: string;
  colApiFormat: string;
  colBaseUrlEnvVar: string;
  colAuthTokenEnvVar: string;
  colModelOverrideEnvVar: string;
  profileReady: string;
  profileMissingEnvVars: string;
  editButton: string;
  saveButton: string;
  savingButton: string;
  cancelButton: string;

  labelFieldLabel: string;
  apiFormatFieldLabel: string;
  baseUrlEnvVarFieldLabel: string;
  authTokenEnvVarFieldLabel: string;
  modelOverrideEnvVarFieldLabel: string;
  modelOverrideEnvVarPlaceholder: string;

  addNewProfileHeading: string;
  idFieldLabel: string;
  idFieldPlaceholder: string;
  labelFieldPlaceholder: string;
  baseUrlEnvVarPlaceholder: string;
  authTokenEnvVarPlaceholder: string;
  newModelOverrideEnvVarPlaceholder: string;
  addingButton: string;
  addProfileButton: string;

  defaultBackendHeading: string;
  defaultBackendHint: string;
  defaultBackendProfileFieldLabel: string;

  agentAssignmentHeading: string;
  agentAssignmentHint: string;
  colAgent: string;
  colBackendProfile: string;
  backendProfileForAgentAriaLabel: (agentId: string) => string;
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
  noCredentialSources: "No credential sources detected.",
  colProvider: "Provider",
  colSourceId: "Source id",
  colStatus: "Status",
  available: "Available",
  unavailable: "Unavailable",

  backendProfilesHeading: "Backend profiles",
  backendProfilesHintBefore: "Each profile points a claude-code agent at a different API backend. Only the environment variable ",
  backendProfilesHintEm: "names",
  backendProfilesHintAfter:
    " are configured here — set the actual base URL/token as environment variables on this server before an agent using this profile can run a task.",
  noBackendProfiles: "No backend profiles registered yet.",
  colId: "Id",
  colLabel: "Label",
  colApiFormat: "API format",
  colBaseUrlEnvVar: "Base URL env var",
  colAuthTokenEnvVar: "Auth token env var",
  colModelOverrideEnvVar: "Model override env var",
  profileReady: "Ready",
  profileMissingEnvVars: "Missing env var(s)",
  editButton: "Edit",
  saveButton: "Save",
  savingButton: "Saving…",
  cancelButton: "Cancel",

  labelFieldLabel: "Label",
  apiFormatFieldLabel: "API format",
  baseUrlEnvVarFieldLabel: "Base URL environment variable name",
  authTokenEnvVarFieldLabel: "Auth token environment variable name",
  modelOverrideEnvVarFieldLabel: "Model override environment variable name (optional)",
  modelOverrideEnvVarPlaceholder: "optional, e.g. AI_OFFICE_NVIDIA_MODEL",

  addNewProfileHeading: "Add a new backend profile",
  idFieldLabel: "Id",
  idFieldPlaceholder: "e.g. my-provider",
  labelFieldPlaceholder: "e.g. My Provider API",
  baseUrlEnvVarPlaceholder: "e.g. AI_OFFICE_BACKEND_MY_PROVIDER_BASE_URL",
  authTokenEnvVarPlaceholder: "e.g. AI_OFFICE_BACKEND_MY_PROVIDER_AUTH_TOKEN",
  newModelOverrideEnvVarPlaceholder: "optional — e.g. AI_OFFICE_BACKEND_MY_PROVIDER_MODEL",
  addingButton: "Adding…",
  addProfileButton: "Add profile",

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
  noCredentialSources: "未偵測到任何憑證來源。",
  colProvider: "提供者",
  colSourceId: "來源 ID",
  colStatus: "狀態",
  available: "可用",
  unavailable: "不可用",

  backendProfilesHeading: "後端設定檔",
  backendProfilesHintBefore: "每個設定檔會指定 claude-code 代理使用的 API 後端。這裡只設定環境變數的",
  backendProfilesHintEm: "名稱",
  backendProfilesHintAfter:
    ";在代理使用此設定檔執行任務之前,請先在這台伺服器上,把實際的 Base URL/權杖設為對應的環境變數。",
  noBackendProfiles: "尚未註冊任何後端設定檔。",
  colId: "ID",
  colLabel: "名稱",
  colApiFormat: "API 格式",
  colBaseUrlEnvVar: "Base URL 環境變數",
  colAuthTokenEnvVar: "驗證權杖環境變數",
  colModelOverrideEnvVar: "模型覆寫環境變數",
  profileReady: "就緒",
  profileMissingEnvVars: "缺少環境變數",
  editButton: "編輯",
  saveButton: "儲存",
  savingButton: "儲存中…",
  cancelButton: "取消",

  labelFieldLabel: "名稱",
  apiFormatFieldLabel: "API 格式",
  baseUrlEnvVarFieldLabel: "Base URL 環境變數名稱",
  authTokenEnvVarFieldLabel: "驗證權杖環境變數名稱",
  modelOverrideEnvVarFieldLabel: "模型覆寫環境變數名稱(選填)",
  modelOverrideEnvVarPlaceholder: "選填,例如 AI_OFFICE_NVIDIA_MODEL",

  addNewProfileHeading: "新增後端設定檔",
  idFieldLabel: "ID",
  idFieldPlaceholder: "例如 my-provider",
  labelFieldPlaceholder: "例如 My Provider API",
  baseUrlEnvVarPlaceholder: "例如 AI_OFFICE_BACKEND_MY_PROVIDER_BASE_URL",
  authTokenEnvVarPlaceholder: "例如 AI_OFFICE_BACKEND_MY_PROVIDER_AUTH_TOKEN",
  newModelOverrideEnvVarPlaceholder: "選填 — 例如 AI_OFFICE_BACKEND_MY_PROVIDER_MODEL",
  addingButton: "新增中…",
  addProfileButton: "新增設定檔",

  defaultBackendHeading: "未指定代理的預設後端",
  defaultBackendHint:
    "僅套用於下方沒有個別指派、也沒有自帶預設值的 claude-code 代理,並不會覆蓋這兩種情況。此設定會被保存,並立即套用到目前所有符合條件的代理(下方每一列會同步更新),不需要重新啟動。",
  defaultBackendProfileFieldLabel: "預設後端設定檔",

  agentAssignmentHeading: "代理 → 後端指派",
  agentAssignmentHint: "只有 claude-code 代理會讀取後端設定檔。變更會從該代理下一個派送的任務開始生效,不需要重新啟動。",
  colAgent: "代理",
  colBackendProfile: "後端設定檔",
  backendProfileForAgentAriaLabel: (agentId) => `${agentId} 的後端設定檔`,
};

export const translations: Record<Lang, Translations> = {
  en,
  "zh-TW": zhTW,
};
