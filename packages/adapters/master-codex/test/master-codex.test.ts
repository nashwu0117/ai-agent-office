import assert from "node:assert/strict";
import test from "node:test";
import { MasterPlanningError, type CredentialRouter, type CredentialSourceStatus } from "@ai-office/core";
import { CodexMasterBrain, codexSubscriptionOnlyEnvironment } from "../src/index.js";

function routerWithSession(available: boolean): CredentialRouter {
  return {
    resolve: (provider) =>
      provider === "codex-native" && available ? { id: "codex-cli-session", provider, isAvailable: () => true } : undefined,
    reportFailure: () => {},
    listStatuses: (): CredentialSourceStatus[] => [{ id: "codex-cli-session", provider: "codex-native", available }],
  };
}

test("plan reads the last agent_message before turn.completed", async () => {
  const plan = JSON.stringify({
    tasks: [{ title: "Add health check", description: "Add a /health endpoint", requiredCapabilities: ["backend"] }],
  });
  const brain = new CodexMasterBrain(routerWithSession(true), {
    runner: async () => ({ text: `\`\`\`json\n${plan}\n\`\`\``, turnCompleted: true }),
  });
  const tasks = await brain.plan("Add a health check endpoint");
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, "Add health check");
});

test("plan retries once on malformed JSON and can recover", async () => {
  let call = 0;
  const brain = new CodexMasterBrain(routerWithSession(true), {
    runner: async () => {
      call += 1;
      if (call === 1) return { text: "not json at all", turnCompleted: true };
      return {
        text: JSON.stringify({ tasks: [{ title: "Fix it", description: "Fix it", requiredCapabilities: [] }] }),
        turnCompleted: true,
      };
    },
  });
  const tasks = await brain.plan("goal");
  assert.equal(call, 2);
  assert.equal(tasks[0].title, "Fix it");
});

test("plan fails clearly after two malformed attempts", async () => {
  const brain = new CodexMasterBrain(routerWithSession(true), {
    runner: async () => ({ text: "still not json", turnCompleted: true }),
  });
  await assert.rejects(() => brain.plan("goal"), MasterPlanningError);
});

test("missing codex login session fails before spawning, with authFailure set", async () => {
  const brain = new CodexMasterBrain(routerWithSession(false), {
    runner: async () => {
      throw new Error("should never be called");
    },
  });
  await assert.rejects(
    () => brain.plan("goal"),
    (err: unknown) => err instanceof MasterPlanningError && err.authFailure === true
  );
});

test("summarize returns the final agent_message text", async () => {
  const brain = new CodexMasterBrain(routerWithSession(true), {
    runner: async () => ({ text: "All three subtasks completed successfully.", turnCompleted: true }),
  });
  const summary = await brain.summarize("goal", []);
  assert.equal(summary, "All three subtasks completed successfully.");
});

test("codexSubscriptionOnlyEnvironment strips OPENAI_API_KEY/OPENAI_BASE_URL but preserves other vars", () => {
  const env = codexSubscriptionOnlyEnvironment({ OPENAI_API_KEY: "sk-x", OPENAI_BASE_URL: "https://x", PATH: "/usr/bin" });
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.OPENAI_BASE_URL, undefined);
  assert.equal(env.PATH, "/usr/bin");
});
