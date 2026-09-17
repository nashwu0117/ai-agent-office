import assert from "node:assert/strict";
import test from "node:test";
import { MasterPlanningError, type CredentialRouter, type CredentialSourceStatus } from "@ai-office/core";
import { AnthropicMasterBrain, subscriptionOnlyEnvironment } from "../src/index.js";

function subscriptionRouter(available = true): CredentialRouter {
  const status: CredentialSourceStatus = {
    id: "claude-code-cli-session",
    provider: "claude-code-cli",
    available,
  };
  return {
    resolve: () => (available ? { ...status, isAvailable: () => true } : undefined),
    reportFailure: () => undefined,
    listStatuses: () => [status],
  };
}

const validPlan = {
  tasks: [
    {
      title: "Add lastLoginAt to user data",
      description: "Add a nullable lastLoginAt field to the backend user data model and serialization.",
      requiredCapabilities: ["backend"],
    },
    {
      title: "Display lastLoginAt on profile",
      description: "Render the backend lastLoginAt value on the frontend profile page.",
      requiredCapabilities: ["frontend"],
      dependsOn: ["Add lastLoginAt to user data"],
    },
  ],
};

test("plan reads schema-validated structured_output", async () => {
  const master = new AnthropicMasterBrain(subscriptionRouter(), {
    runner: async () => ({ type: "result", is_error: false, structured_output: validPlan }),
  });

  const planned = await master.plan("add login time");
  assert.equal(planned.length, 2);
  assert.equal(planned[0].title, validPlan.tasks[0].title);
  assert.deepEqual(planned[1].dependsOn, [validPlan.tasks[0].title]);
});

test("plan retries one malformed result and accepts fenced JSON fallback", async () => {
  let calls = 0;
  const master = new AnthropicMasterBrain(subscriptionRouter(), {
    runner: async () => {
      calls += 1;
      return calls === 1
        ? { type: "result", is_error: false, result: "not json" }
        : { type: "result", is_error: false, result: `\`\`\`json\n${JSON.stringify(validPlan)}\n\`\`\`` };
    },
  });

  assert.equal((await master.plan("add login time")).length, 2);
  assert.equal(calls, 2);
});

test("quota errors are clear auth/usage failures and are not retried", async () => {
  let calls = 0;
  const master = new AnthropicMasterBrain(subscriptionRouter(), {
    runner: async () => {
      calls += 1;
      return {
        type: "result",
        is_error: true,
        api_error_status: 429,
        result: "You've hit your session limit",
      };
    },
  });

  await assert.rejects(master.plan("anything"), (error: unknown) => {
    assert.ok(error instanceof MasterPlanningError);
    assert.equal(error.authFailure, true);
    assert.match(error.message, /HTTP 429.*session limit/);
    return true;
  });
  assert.equal(calls, 1);
});

test("Master subprocess environment strips API/gateway auth but preserves ordinary settings", () => {
  const result = subscriptionOnlyEnvironment({
    PATH: "/bin",
    ANTHROPIC_API_KEY: "secret",
    ANTHROPIC_API_KEY_BACKUP: "secret2",
    ANTHROPIC_AUTH_TOKEN: "token",
    ANTHROPIC_BASE_URL: "https://gateway.invalid",
    CLAUDE_CODE_USE_BEDROCK: "1",
    AI_OFFICE_MASTER_MODEL: "sonnet",
  });

  assert.deepEqual(result, { PATH: "/bin", AI_OFFICE_MASTER_MODEL: "sonnet" });
});

test("missing CLI subscription source fails before spawning", async () => {
  let called = false;
  const master = new AnthropicMasterBrain(subscriptionRouter(false), {
    runner: async () => {
      called = true;
      return { type: "result", is_error: false, structured_output: validPlan };
    },
  });

  await assert.rejects(master.plan("anything"), /Claude Code subscription login is unavailable/);
  assert.equal(called, false);
});
