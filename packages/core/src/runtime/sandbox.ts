import { execFileSync } from "node:child_process";
import { homedir } from "node:os";

export interface SandboxPlan {
  command: string;
  args: string[];
}

const HOME = homedir();

// Each CLI's own operational state (credentials/logs/cache) must stay
// writable even though everything else outside the task's workspacePath is
// read-only — verified by hand that opencode hard-crashes on startup
// ("FileSystem.open ~/.local/share/opencode/log/opencode.log") without
// this. This is NOT the task's target files, only the tool's own state.
const CLI_STATE_DIRS = [
  `${HOME}/.claude`,
  `${HOME}/.claude.json`,
  `${HOME}/.cache/claude`,
  `${HOME}/.local/share/opencode`,
  `${HOME}/.config/opencode`,
  `${HOME}/.cache/opencode`,
  // v0.15: verified by hand that `codex exec` hard-fails without this —
  // "Error: failed to initialize in-process app-server client: Read-only
  // file system (os error 30)" — it needs to write its own session/auth/
  // app-server-daemon state under here (see `codex doctor`'s "auth file
  // ~/.codex/auth.json" / "daemon state dir ~/.codex/app-server-daemon").
  `${HOME}/.codex`,
];

let bwrapAvailable: boolean | undefined;

function hasBwrap(): boolean {
  if (bwrapAvailable === undefined) {
    try {
      execFileSync("bwrap", ["--version"], { stdio: "ignore" });
      bwrapAvailable = true;
    } catch {
      bwrapAvailable = false;
    }
  }
  return bwrapAvailable;
}

/**
 * Layer-2 defense (see SECURITY.md): wraps a worker CLI invocation in a
 * bubblewrap sandbox that makes the entire filesystem read-only except the
 * task's own workspacePath, /tmp, and each CLI's own state directory.
 * Verified by hand to actually block writes outside workspacePath at the OS
 * level (a real `Read-only file system` error, not a convention the CLI
 * could ignore) — this is prevention, not a heuristic. GitRepoGuard
 * (Layer 1) remains active regardless, as a backstop for environments where
 * `bwrap` isn't installed (this silently falls back to running the command
 * unwrapped in that case — most likely on non-Linux dev machines).
 */
export function planSandboxedCommand(command: string, args: string[], workspacePath: string): SandboxPlan {
  if (!hasBwrap()) return { command, args };

  const bwrapArgs = [
    "--ro-bind",
    "/",
    "/",
    "--bind",
    workspacePath,
    workspacePath,
    "--bind",
    "/tmp",
    "/tmp",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--die-with-parent",
  ];
  for (const dir of CLI_STATE_DIRS) {
    bwrapArgs.push("--bind-try", dir, dir);
  }
  bwrapArgs.push("--", command, ...args);

  return { command: "bwrap", args: bwrapArgs };
}
