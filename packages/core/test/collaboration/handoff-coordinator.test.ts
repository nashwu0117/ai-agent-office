import assert from "node:assert/strict";
import test from "node:test";
import { HandoffCoordinator, type TaskLookup } from "../../src/collaboration/handoff-coordinator.js";
import type { OfficeEvent } from "../../src/events/types.js";
import type { Task } from "../../src/task/types.js";

function makeTask(overrides: Partial<Task> & Pick<Task, "id" | "title" | "status">): Task {
  return {
    description: overrides.title,
    workspacePath: "/tmp/ws",
    requiredCapabilities: [],
    source: "master",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function lookup(tasks: Task[]): TaskLookup {
  // Reads `tasks` live rather than snapshotting it at call time, so a test
  // can keep pushing tasks into the same array after constructing this.
  return { getTask: (id) => tasks.find((t) => t.id === id) };
}

test("emits a handoff when a dependency was done by a different agent", () => {
  const producer = makeTask({
    id: "t1",
    title: "Add discountCode field",
    status: "done",
    assignedAgentId: "agent-01",
    resultSummary: 'Completed "Add discountCode field" in 4.0s',
    resultFilesChanged: ["src/order.ts"],
  });
  const consumer = makeTask({
    id: "t2",
    title: "Show discountCode on summary page",
    status: "assigned",
    assignedAgentId: "agent-02",
    dependsOn: ["t1"],
  });

  const events: OfficeEvent[] = [];
  const coordinator = new HandoffCoordinator({
    orchestrator: lookup([producer, consumer]),
    broadcast: (e) => events.push(e),
    idGen: () => "handoff-1",
    now: () => "2026-01-01T00:00:01.000Z",
  });

  coordinator.observe({ type: "task_updated", task: consumer });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "agent_handoff");
  const handoff = (events[0] as { type: "agent_handoff"; handoff: ReturnType<HandoffCoordinator["list"]>[number] }).handoff;
  assert.equal(handoff.fromAgentId, "agent-01");
  assert.equal(handoff.toAgentId, "agent-02");
  assert.equal(handoff.fromTaskTitle, "Add discountCode field");
  assert.equal(handoff.toTaskTitle, "Show discountCode on summary page");
  assert.match(handoff.message, /agent-01 completed "Add discountCode field"/);
  assert.match(handoff.message, /src\/order\.ts/);
  assert.match(handoff.message, /Handing off to agent-02/);
  assert.deepEqual(coordinator.list(), [handoff]);
});

test("emits no handoff when the dependency was done by the same agent", () => {
  const producer = makeTask({ id: "t1", title: "Step 1", status: "done", assignedAgentId: "agent-01" });
  const consumer = makeTask({
    id: "t2",
    title: "Step 2",
    status: "assigned",
    assignedAgentId: "agent-01",
    dependsOn: ["t1"],
  });

  const events: OfficeEvent[] = [];
  const coordinator = new HandoffCoordinator({
    orchestrator: lookup([producer, consumer]),
    broadcast: (e) => events.push(e),
  });
  coordinator.observe({ type: "task_updated", task: consumer });

  assert.equal(events.length, 0);
});

test("ignores task_updated events that are not a fresh assignment with dependencies", () => {
  const task = makeTask({ id: "t1", title: "Solo task", status: "pending" });
  const events: OfficeEvent[] = [];
  const coordinator = new HandoffCoordinator({ orchestrator: lookup([task]), broadcast: (e) => events.push(e) });

  coordinator.observe({ type: "task_updated", task });
  coordinator.observe({ type: "task_completed", taskId: "t1", agentId: "agent-01", summary: "done", filesChanged: [] });

  assert.equal(events.length, 0);
});

test("one handoff per distinct producing agent, not per dependency task", () => {
  const producer = makeTask({ id: "t1", title: "Backend piece", status: "done", assignedAgentId: "agent-01" });
  const producerSameAgent = makeTask({ id: "t1b", title: "Backend piece 2", status: "done", assignedAgentId: "agent-01" });
  const consumer = makeTask({
    id: "t2",
    title: "Frontend piece",
    status: "assigned",
    assignedAgentId: "agent-02",
    dependsOn: ["t1", "t1b"],
  });

  const events: OfficeEvent[] = [];
  const coordinator = new HandoffCoordinator({
    orchestrator: lookup([producer, producerSameAgent, consumer]),
    broadcast: (e) => events.push(e),
  });
  coordinator.observe({ type: "task_updated", task: consumer });

  assert.equal(events.length, 1);
});

test("history is capped at maxHistory", () => {
  const events: OfficeEvent[] = [];
  const tasks: Task[] = [];
  const coordinator = new HandoffCoordinator({
    orchestrator: lookup(tasks),
    broadcast: (e) => events.push(e),
    maxHistory: 2,
  });

  for (let i = 0; i < 3; i += 1) {
    const producer = makeTask({ id: `p${i}`, title: `Producer ${i}`, status: "done", assignedAgentId: "agent-01" });
    const consumer = makeTask({
      id: `c${i}`,
      title: `Consumer ${i}`,
      status: "assigned",
      assignedAgentId: "agent-02",
      dependsOn: [`p${i}`],
    });
    tasks.push(producer, consumer);
    coordinator.observe({ type: "task_updated", task: consumer });
  }

  assert.equal(coordinator.list().length, 2);
  assert.equal(coordinator.list()[0].fromTaskTitle, "Producer 1");
  assert.equal(coordinator.list()[1].fromTaskTitle, "Producer 2");
});
