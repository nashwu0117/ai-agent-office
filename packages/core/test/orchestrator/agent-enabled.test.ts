import assert from "node:assert/strict";
import test from "node:test";
import type { Agent, OfficeEvent, RuntimeAdapter, RuntimeHandle } from "../../src/index.js";
import { Orchestrator } from "../../src/index.js";

function agent(enabled: boolean): Agent {
  const now = new Date().toISOString();
  return {
    id: "agent-offline-test",
    enabled,
    state: "available",
    runtime: "fake-cli",
    eligibleCapabilities: ["testing"],
    capabilities: [],
    createdAt: now,
    updatedAt: now,
  };
}

test("a disabled agent is not dispatched and starts pending work after it is enabled", async () => {
  let starts = 0;
  const events: OfficeEvent[] = [];
  const neverExits: RuntimeHandle = {
    onEvent() {},
    onExit() {},
    stop() {},
  };
  const adapter: RuntimeAdapter = {
    async start() {
      starts += 1;
      return neverExits;
    },
  };
  const orchestrator = new Orchestrator({
    adapters: { "fake-cli": adapter },
    broadcast: (event) => events.push(event),
    releaseDelayMs: 0,
  });
  orchestrator.registerAgent(agent(false));

  const task = await orchestrator.submitTask({
    description: "wait until online",
    workspacePath: "/tmp/ai-office-agent-enabled-test",
    requiredCapabilities: ["testing"],
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(starts, 0);
  assert.equal(task.status, "pending");
  assert.throws(
    () => orchestrator.assignTaskToAgent("agent-offline-test", { description: "no", workspacePath: "/tmp" }),
    /offline/
  );

  orchestrator.setAgentEnabled("agent-offline-test", true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(starts, 1);
  assert.equal(task.assignedAgentId, "agent-offline-test");
  assert.ok(events.some((event) => event.type === "agent_enabled_changed" && event.enabled));
});
