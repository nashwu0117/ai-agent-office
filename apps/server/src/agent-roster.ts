export type AgentRuntimeId = "claude-code" | "opencode" | "cline" | "codex";

export interface AgentRosterEntry {
  eligibleCapabilities: string[];
  runtime: AgentRuntimeId;
  backendProfile?: string;
}

export type AgentRoster = Record<string, AgentRosterEntry>;

export const DEFAULT_AGENT_ROSTER: AgentRoster = {
  "agent-01": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code" },
  "agent-02": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code" },
  "agent-03": { eligibleCapabilities: ["frontend", "docs"], runtime: "opencode" },
  "agent-04": { eligibleCapabilities: ["backend", "testing"], runtime: "codex" },
  "agent-05": { eligibleCapabilities: ["frontend", "docs"], runtime: "cline" },
  "agent-06": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code" },
  "agent-07": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code" },
  "agent-08": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code" },
  "agent-09": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code" },
  "agent-10": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code" },
  "agent-11": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code" },
  "agent-12": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code" },
  "agent-13": { eligibleCapabilities: ["backend", "testing"], runtime: "claude-code" },
};

const RUNTIME_CAPABILITIES: Record<AgentRuntimeId, string[]> = {
  "claude-code": ["backend", "testing"],
  opencode: ["frontend", "docs"],
  cline: ["frontend", "docs"],
  codex: ["backend", "testing"],
};
const SUPPORTED_RUNTIMES = Object.keys(RUNTIME_CAPABILITIES) as AgentRuntimeId[];
const MAX_CONFIGURED_AGENTS = 500;

/**
 * Optional deployment-time fleet configuration. When set, the JSON object
 * specifies exact agent counts for the supported local CLI runtimes.
 */
export function loadAgentRoster(rawCounts = process.env.AI_OFFICE_AGENT_COUNTS): AgentRoster {
  if (rawCounts === undefined || rawCounts.trim() === "") return { ...DEFAULT_AGENT_ROSTER };

  let counts: unknown;
  try {
    counts = JSON.parse(rawCounts);
  } catch {
    throw new Error("AI_OFFICE_AGENT_COUNTS must be a JSON object of runtime names to non-negative integer counts.");
  }
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) {
    throw new Error("AI_OFFICE_AGENT_COUNTS must be a JSON object of runtime names to non-negative integer counts.");
  }

  const record = counts as Record<string, unknown>;
  const unknownRuntimes = Object.keys(record).filter((runtime) => !SUPPORTED_RUNTIMES.includes(runtime as AgentRuntimeId));
  if (unknownRuntimes.length > 0) {
    throw new Error(`AI_OFFICE_AGENT_COUNTS contains unsupported runtime(s): ${unknownRuntimes.join(", ")}.`);
  }

  const roster: AgentRoster = {};
  let total = 0;
  for (const runtime of SUPPORTED_RUNTIMES) {
    const count = record[runtime] ?? 0;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(`AI_OFFICE_AGENT_COUNTS["${runtime}"] must be a non-negative integer.`);
    }
    total += count;
    if (total > MAX_CONFIGURED_AGENTS) {
      throw new Error(`AI_OFFICE_AGENT_COUNTS supports at most ${MAX_CONFIGURED_AGENTS} agents in total.`);
    }
    for (let index = 1; index <= count; index++) {
      const id = `agent-${runtime}-${String(index).padStart(3, "0")}`;
      roster[id] = { eligibleCapabilities: [...RUNTIME_CAPABILITIES[runtime]], runtime };
    }
  }
  if (total === 0) throw new Error("AI_OFFICE_AGENT_COUNTS must configure at least one agent.");
  return roster;
}

export function loadMaxConcurrentAgents(rawLimit = process.env.AI_OFFICE_MAX_CONCURRENT_AGENTS): number {
  if (rawLimit === undefined || rawLimit.trim() === "") return 16;
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_CONFIGURED_AGENTS) {
    throw new Error(`AI_OFFICE_MAX_CONCURRENT_AGENTS must be an integer from 1 to ${MAX_CONFIGURED_AGENTS}.`);
  }
  return limit;
}
