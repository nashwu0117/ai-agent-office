import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * v0.10: persists which backend profile each agent is pinned to, across
 * server restarts — the management UI's per-agent reassignment
 * (PUT /api/agents/:id/backend-profile) would otherwise silently revert to
 * AGENT_ROSTER's hardcoded default (index.ts) on the next restart.
 *
 * Keyed by agent id; a stored value of `null` means "official" (explicitly
 * reassigned back to the shared credential pool), distinct from "not in
 * this file at all" (never reassigned — defer to AGENT_ROSTER's default).
 * Never touches BACKEND_PROFILES itself — see backend-profile-store.ts for
 * that.
 */
export class AgentBackendAssignmentStore {
  private assignments: Record<string, string | null>;

  constructor(private readonly filePath: string) {
    this.assignments = this.load();
  }

  /** Applied over AGENT_ROSTER's hardcoded default at startup, before registerAgent. */
  resolve(agentId: string, defaultProfile: string | undefined): string | undefined {
    if (!(agentId in this.assignments)) return defaultProfile;
    const value = this.assignments[agentId];
    return value === null ? undefined : value;
  }

  /**
   * v0.13: true once an operator has explicitly reassigned this agent
   * through the management UI (including explicitly clearing it back to
   * "official") — distinct from "never touched," which is what lets
   * DefaultBackendStore's global default (apps/server/src/default-backend-store.ts)
   * apply only to agents nobody has ever individually pinned.
   */
  hasExplicitOverride(agentId: string): boolean {
    return agentId in this.assignments;
  }

  set(agentId: string, backendProfile: string | undefined): void {
    this.assignments[agentId] = backendProfile ?? null;
    this.persist();
  }

  private load(): Record<string, string | null> {
    if (!existsSync(this.filePath)) return {};
    try {
      return JSON.parse(readFileSync(this.filePath, "utf8")) as Record<string, string | null>;
    } catch (err) {
      console.warn(
        `[ai-office] failed to read ${this.filePath}, starting with no persisted agent backend assignments: ${err instanceof Error ? err.message : String(err)}`
      );
      return {};
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(this.assignments, null, 2), "utf8");
    renameSync(tmpPath, this.filePath);
  }
}
