import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * v0.13 Part E: the "global default backend profile" layer — separate from,
 * and layered *underneath*, `AgentBackendAssignmentStore`'s per-agent
 * overrides (see that file). Priority order for a claude-code agent's
 * effective backendProfile, highest first:
 *
 *   1. an explicit per-agent override (AgentBackendAssignmentStore — the
 *      existing "assign this one agent to this one profile" feature,
 *      unchanged)
 *   2. AGENT_ROSTER's own hardcoded default for that agent id (also an
 *      explicit, intentional individual assignment — e.g. agent-08's
 *      hardcoded "nvidia-1")
 *   3. this store's global default, if set
 *   4. "official" (undefined) — the original, pre-v0.13 behavior
 *
 * A `null` value means "no global default set" (official), distinct from
 * "file doesn't exist yet" only in that both currently behave the same way
 * — kept as an explicit value (not just "absent") so a future default of
 * "true" false-in-JSON edge case never has to be special-cased differently
 * from an operator deliberately clearing it back to official.
 */
export class DefaultBackendStore {
  private value: string | null;

  constructor(private readonly filePath: string) {
    this.value = this.load();
  }

  get(): string | null {
    return this.value;
  }

  set(backendProfile: string | null): void {
    this.value = backendProfile;
    this.persist();
  }

  private load(): string | null {
    if (!existsSync(this.filePath)) return null;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as { backendProfile: string | null };
      return parsed.backendProfile ?? null;
    } catch (err) {
      console.warn(
        `[ai-office] failed to read ${this.filePath}, starting with no global default backend profile: ${err instanceof Error ? err.message : String(err)}`
      );
      return null;
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify({ backendProfile: this.value }, null, 2), "utf8");
    renameSync(tmpPath, this.filePath);
  }
}
