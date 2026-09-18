import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** The fixed set of Master Brain backends this server knows how to construct — see index.ts's MASTER_BRAIN_IDS/masterBrains map. */
export type MasterBrainId = "claude-code" | "codex";

const DEFAULT_MASTER_BRAIN: MasterBrainId = "claude-code";
const MASTER_BRAIN_IDS: MasterBrainId[] = ["claude-code", "codex"];

/**
 * v0.22 Part B: which backend drives the single Master planner, persisted
 * the same plain-JSON-file way as DefaultBackendStore (see that file) —
 * this project's established "not an enterprise config management system"
 * scope note applies here too. Unlike a worker's backendProfile, this has a
 * small fixed enum of ids rather than an open registry, since a MasterBrain
 * implementation is a structurally different adapter (see
 * @ai-office/adapter-master-codex's own doc comment on why this couldn't
 * just be another BackendProfile row).
 *
 * v0.22.1: also persists an optional `--model` override per backend id (the
 * operator asked to be able to pick the model, not just the CLI/login it
 * runs on — see index.ts's PUT /api/master-brain/model). Undefined/empty
 * means "let that CLI use its own default" (whatever `claude`/`codex` picks
 * with no --model flag at all), same meaning as the pre-v0.22.1
 * AI_OFFICE_MASTER_MODEL env var this now takes priority over. Kept
 * per-backend (not one shared value) so switching backends doesn't clobber
 * a model choice already made for the other one.
 */
export class MasterBrainStore {
  private value: MasterBrainId;
  private models: Partial<Record<MasterBrainId, string>>;

  constructor(private readonly filePath: string) {
    const loaded = this.load();
    this.value = loaded.masterBrain;
    this.models = loaded.models;
  }

  get(): MasterBrainId {
    return this.value;
  }

  set(id: MasterBrainId): void {
    this.value = id;
    this.persist();
  }

  getModel(id: MasterBrainId): string | undefined {
    return this.models[id];
  }

  getModels(): Partial<Record<MasterBrainId, string>> {
    return { ...this.models };
  }

  /** `undefined`/empty clears the override for this backend. */
  setModel(id: MasterBrainId, model: string | undefined): void {
    if (model?.trim()) {
      this.models[id] = model.trim();
    } else {
      delete this.models[id];
    }
    this.persist();
  }

  private load(): { masterBrain: MasterBrainId; models: Partial<Record<MasterBrainId, string>> } {
    if (!existsSync(this.filePath)) return { masterBrain: DEFAULT_MASTER_BRAIN, models: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as {
        masterBrain?: unknown;
        models?: unknown;
      };
      const masterBrain = parsed.masterBrain === "codex" ? "codex" : DEFAULT_MASTER_BRAIN;
      const models: Partial<Record<MasterBrainId, string>> = {};
      if (parsed.models && typeof parsed.models === "object") {
        for (const id of MASTER_BRAIN_IDS) {
          const value = (parsed.models as Record<string, unknown>)[id];
          if (typeof value === "string" && value.trim()) models[id] = value.trim();
        }
      }
      return { masterBrain, models };
    } catch (err) {
      console.warn(
        `[ai-office] failed to read ${this.filePath}, starting with the default Master Brain (${DEFAULT_MASTER_BRAIN}) and no model overrides: ${err instanceof Error ? err.message : String(err)}`
      );
      return { masterBrain: DEFAULT_MASTER_BRAIN, models: {} };
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify({ masterBrain: this.value, models: this.models }, null, 2), "utf8");
    renameSync(tmpPath, this.filePath);
  }
}
