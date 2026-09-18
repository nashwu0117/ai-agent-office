import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * v0.15: writes a single NAME="value" line into a dotenv-style file (this
 * server's own apps/server/.env.local), creating the file if it doesn't
 * exist yet and replacing an existing line for the same name in place —
 * every other line (comments, unrelated vars) is left untouched.
 *
 * Exists so BackendProfileStore can accept a real URL/key pasted directly
 * into the management UI and put it where it actually belongs (an env var
 * on this server, never in backend-profiles.json) without asking the
 * operator to go hand-edit .env.local themselves — see backend-profile-store
 * .ts's resolveEnvVarField.
 */
export function upsertEnvVar(filePath: string, name: string, value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new Error(`Value for ${name} must not contain line breaks.`);
  }
  const quoted = `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const line = `${name}=${quoted}`;

  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const lines = existing.length > 0 ? existing.split("\n") : [];
  const prefix = `${name}=`;
  const idx = lines.findIndex((l) => l.startsWith(prefix));
  if (idx >= 0) {
    lines[idx] = line;
  } else {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push(line);
  }

  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, lines.join("\n"), "utf8");
  renameSync(tmpPath, filePath);
}
