// Per-browser convenience: remembers workspace folder paths the user has
// already typed/pasted so the three workspace-path inputs (goal/task/assign)
// can offer them back via a native <datalist> instead of retyping every time.
// localStorage only — never sent to the server, never shared across devices.
const RECENT_PATHS_KEY = "ai-office:recentWorkspacePaths";
const MAX_RECENT_PATHS = 8;

export function getRecentWorkspacePaths(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_PATHS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export function addRecentWorkspacePath(path: string): string[] {
  const trimmed = path.trim();
  const existing = getRecentWorkspacePaths().filter((p) => p !== trimmed);
  const next = trimmed ? [trimmed, ...existing].slice(0, MAX_RECENT_PATHS) : existing;
  try {
    localStorage.setItem(RECENT_PATHS_KEY, JSON.stringify(next));
  } catch {
    // Private browsing / storage disabled — recent paths just won't persist.
  }
  return next;
}
