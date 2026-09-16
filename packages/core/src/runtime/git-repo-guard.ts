import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { WorkspaceGuard, WorkspaceGuardViolation } from "./workspace-guard.js";

const execFileAsync = promisify(execFile);

/**
 * Layer-1 safety net for one specific git repo (in practice: this project's
 * own checkout, which worker CLIs must never modify regardless of what
 * workspacePath a task targets). Snapshots `git status --porcelain`
 * immediately before and after a task runs; any path that was clean before
 * and dirty after — and that doesn't fall inside the task's own
 * workspacePath — is treated as an isolation violation and force-reverted.
 *
 * Known gap (see SECURITY.md): a path that was ALREADY dirty before the
 * task ran (e.g. the operator's own in-progress edit) and gets modified
 * further by the task is not auto-reverted — checkout would destroy the
 * operator's unrelated pending work, which is worse than leaving it. It's
 * still flagged in the diff capture below, just not reverted.
 */
export class GitRepoGuard implements WorkspaceGuard {
  constructor(private readonly repoPath: string) {}

  async snapshot(): Promise<string[]> {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: this.repoPath });
    return stdout.split("\n").filter((line) => line.trim().length > 0);
  }

  async checkAndCapture(before: string[], taskWorkspacePath: string): Promise<WorkspaceGuardViolation | null> {
    const after = await this.snapshot();
    const beforeSet = new Set(before);
    const workspaceAbs = path.resolve(taskWorkspacePath);

    const newlyDirty = after.filter((line) => {
      if (beforeSet.has(line)) return false; // unchanged since baseline
      const relPath = parsePorcelainPath(line);
      if (!relPath) return false;
      const abs = path.resolve(this.repoPath, relPath);
      // Changes inside the task's own workspacePath are the intended
      // outcome, not an escape — only flag changes outside it.
      return abs !== workspaceAbs && !abs.startsWith(workspaceAbs + path.sep);
    });

    if (newlyDirty.length === 0) return null;

    const paths = newlyDirty.map((line) => parsePorcelainPath(line)).filter((p): p is string => p !== null);
    const diff = await execFileAsync("git", ["diff", "--", ...paths], { cwd: this.repoPath })
      .then((r) => r.stdout)
      .catch(() => "(git diff failed to capture)");

    return { paths, diff };
  }

  async revert(violation: WorkspaceGuardViolation): Promise<void> {
    for (const relPath of violation.paths) {
      const abs = path.resolve(this.repoPath, relPath);
      const wasTrackedBefore = await execFileAsync("git", ["ls-files", "--error-unmatch", relPath], {
        cwd: this.repoPath,
      })
        .then(() => true)
        .catch(() => false);

      if (wasTrackedBefore) {
        await execFileAsync("git", ["checkout", "--", relPath], { cwd: this.repoPath }).catch(() => {});
      } else {
        // Brand-new untracked file/dir the task created outside its workspace — remove it directly;
        // `git checkout` has nothing in HEAD to restore it to.
        await execFileAsync("rm", ["-rf", "--", abs]).catch(() => {});
      }
    }
  }
}

function parsePorcelainPath(line: string): string | null {
  // Porcelain v1: "XY PATH" or "XY PATH1 -> PATH2" for renames — take the destination.
  const rest = line.slice(3);
  const arrow = rest.indexOf(" -> ");
  const p = arrow >= 0 ? rest.slice(arrow + 4) : rest;
  return p.trim() || null;
}
