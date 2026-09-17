import type { CredentialRouter, CredentialSource, CredentialSourceStatus } from "./types.js";

/**
 * Sources are grouped by provider and tried in the order they were
 * constructed with (index 0 = highest priority, e.g. "primary" before
 * "backup"). A failed source is skipped by every later resolve() call for
 * the rest of this process — see CredentialRouter.reportFailure.
 */
export class InMemoryCredentialRouter implements CredentialRouter {
  private readonly byProvider = new Map<string, CredentialSource[]>();
  private readonly failed = new Set<string>();

  constructor(
    sources: CredentialSource[],
    private readonly onChange?: (statuses: CredentialSourceStatus[]) => void
  ) {
    for (const source of sources) {
      const list = this.byProvider.get(source.provider) ?? [];
      list.push(source);
      this.byProvider.set(source.provider, list);
    }
  }

  resolve(provider: string): CredentialSource | undefined {
    const list = this.byProvider.get(provider) ?? [];
    return list.find((source) => !this.failed.has(source.id) && source.isAvailable());
  }

  reportFailure(sourceId: string, reason: string): void {
    const alreadyFailed = this.failed.has(sourceId);
    this.failed.add(sourceId);
    if (!alreadyFailed) {
      console.warn(`[credentials] source "${sourceId}" failed and will be skipped for the rest of this process: ${reason}`);
      this.onChange?.(this.listStatuses());
    }
  }

  listStatuses(): CredentialSourceStatus[] {
    const statuses: CredentialSourceStatus[] = [];
    for (const list of this.byProvider.values()) {
      for (const source of list) {
        statuses.push({
          id: source.id,
          provider: source.provider,
          available: !this.failed.has(source.id) && source.isAvailable(),
        });
      }
    }
    return statuses;
  }
}
