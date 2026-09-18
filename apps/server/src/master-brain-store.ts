import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** The fixed set of Master Brain backends this server knows how to construct — see index.ts's MASTER_BRAIN_IDS/masterBrains map. */
export type MasterBrainId = "claude-code" | "codex";

const DEFAULT_MASTER_BRAIN: MasterBrainId = "claude-code";

/**
 * v0.22 Part B: which backend drives the single Master planner, persisted
 * the same plain-JSON-file way as DefaultBackendStore (see that file) —
 * this project's established "not an enterprise config management system"
 * scope note applies here too. Unlike a worker's backendProfile, this has a
 * small fixed enum of ids rather than an open registry, since a MasterBrain
 * implementation is a structurally different adapter (see
 * @ai-office/adapter-master-codex's own doc comment on why this couldn't
 * just be another BackendProfile row).
 */
export class MasterBrainStore {
  private value: MasterBrainId;

  constructor(private readonly filePath: string) {
    this.value = this.load();
  }

  get(): MasterBrainId {
    return this.value;
  }

  set(id: MasterBrainId): void {
    this.value = id;
    this.persist();
  }

  private load(): MasterBrainId {
    if (!existsSync(this.filePath)) return DEFAULT_MASTER_BRAIN;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as { masterBrain?: unknown };
      return parsed.masterBrain === "codex" ? "codex" : DEFAULT_MASTER_BRAIN;
    } catch (err) {
      console.warn(
        `[ai-office] failed to read ${this.filePath}, starting with the default Master Brain (${DEFAULT_MASTER_BRAIN}): ${err instanceof Error ? err.message : String(err)}`
      );
      return DEFAULT_MASTER_BRAIN;
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify({ masterBrain: this.value }, null, 2), "utf8");
    renameSync(tmpPath, this.filePath);
  }
}
