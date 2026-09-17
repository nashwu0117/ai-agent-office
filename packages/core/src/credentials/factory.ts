import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialRouter } from "./router.js";
import { EnvVarCredentialSource, StaticCredentialSource } from "./sources.js";
import type { CredentialRouter, CredentialSource, CredentialSourceStatus } from "./types.js";

// Priority order within one base env var: the var itself, then numbered
// backups. Kept small and explicit rather than open-ended env scanning —
// good enough for "a couple of fallback keys", not a general secrets store.
const BACKUP_SUFFIXES = ["_BACKUP", "_BACKUP2", "_BACKUP3", "_BACKUP4"];

function envSourcesFor(baseVar: string, provider: string, idPrefix: string): EnvVarCredentialSource[] {
  const sources: EnvVarCredentialSource[] = [];
  if (process.env[baseVar] !== undefined) {
    sources.push(new EnvVarCredentialSource(`${idPrefix}-primary`, provider, baseVar));
  }
  BACKUP_SUFFIXES.forEach((suffix, i) => {
    const envVar = `${baseVar}${suffix}`;
    if (process.env[envVar] !== undefined) {
      sources.push(new EnvVarCredentialSource(`${idPrefix}-backup${i + 1}`, provider, envVar));
    }
  });
  return sources;
}

/**
 * Builds the router this project actually runs with: every ANTHROPIC_API_KEY
 * / ANTHROPIC_AUTH_TOKEN (+ numbered _BACKUP variants) found in the current
 * environment under provider "anthropic" — shared by AnthropicMasterBrain
 * and ClaudeCodeAdapter, since both ultimately authenticate the same way —
 * plus one best-effort source per CLI-native adapter. `onChange` is called
 * (with the same shape as listStatuses()) whenever reportFailure() actually
 * changes a source's state, so the caller can push it to the UI live.
 */
export function createDefaultCredentialRouter(onChange?: (statuses: CredentialSourceStatus[]) => void): CredentialRouter {
  const sources: CredentialSource[] = [
    ...envSourcesFor("ANTHROPIC_API_KEY", "anthropic", "anthropic-key"),
    ...envSourcesFor("ANTHROPIC_AUTH_TOKEN", "anthropic", "anthropic-token"),

    // Claude Code CLI can authenticate via `claude auth` login session
    // instead of an env var (see README) — there is no reliable way to
    // check that from outside the CLI itself, so this always reports
    // available. It exists so the adapter's credential check is routed
    // through the same CredentialRouter interface as everything else,
    // ready for a real second source later without call sites changing.
    new StaticCredentialSource("claude-code-cli-session", "claude-code-cli", () => true),

    // OpenCode keeps its own credential store; unlike Claude Code's, its
    // location is documented and stable (see README "Setting up OpenCode"),
    // so this can give a real available/unavailable signal.
    new StaticCredentialSource("opencode-cli-session", "opencode-native", () =>
      existsSync(join(homedir(), ".local", "share", "opencode", "auth.json"))
    ),
  ];

  return new InMemoryCredentialRouter(sources, onChange);
}
