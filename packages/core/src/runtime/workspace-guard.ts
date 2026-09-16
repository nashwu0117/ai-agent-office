/**
 * Layer-1 safety net (see SECURITY.md): detects when a worker's execution
 * touched files outside its assigned Task.workspacePath and reverts them.
 * This is a backstop, not the primary defense — the primary defense is
 * Layer 2, the bubblewrap sandbox in runtime/sandbox.ts, which prevents the
 * write from succeeding at the OS level in the first place. This interface
 * exists so Orchestrator (platform-agnostic) can depend on it without
 * importing node:child_process directly; GitRepoGuard (runtime/git-repo-guard.ts,
 * Node-only, exported via the "/node" subpath) is the only implementation today.
 */
export interface WorkspaceGuardViolation {
  /** Repo-relative paths that were clean immediately before the task ran and dirty immediately after. */
  paths: string[];
  /** `git diff` output for those paths, captured before reverting, for the audit trail. */
  diff: string;
}

export interface WorkspaceGuard {
  /** Snapshot of the protected repo's status immediately before a task starts. */
  snapshot(): Promise<string[]>;
  /**
   * Compares a fresh snapshot to `before`, ignoring any change that falls
   * inside `taskWorkspacePath` (that's the task's intended, legitimate
   * output). Returns null if nothing outside it changed.
   */
  checkAndCapture(before: string[], taskWorkspacePath: string): Promise<WorkspaceGuardViolation | null>;
  /** Force-reverts exactly the paths named in a violation back to their pre-task state. */
  revert(violation: WorkspaceGuardViolation): Promise<void>;
}
