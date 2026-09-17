import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  Orchestrator,
  type Agent,
  type BackendProfileRegistry,
  type CredentialRouter,
  type OfficeEvent,
} from "@ai-office/core";
import { ClaudeCodeAdapter } from "@ai-office/adapter-claude-code";
import { startFormatTranslationProxy } from "../proxy-server.js";

/**
 * v0.9 acceptance check: runs one real headless `claude -p` task, through
 * the local format-translation proxy, against the mock OpenAI Chat
 * Completions backend (mock-openai-backend.ts) — exercising the
 * "openai-chat-completions" translation path end to end, including one
 * tool-use round trip (a Write tool call the mock backend issues, which the
 * CLI actually executes, whose result is sent back and translated again).
 *
 * `npm run verify-openai-proxy` from apps/server. Spawns its own mock
 * backend child process on MOCK_OPENAI_PORT (default 43299) unless
 * AI_OFFICE_BACKEND_MOCK_OPENAI_BASE_URL is already set to point elsewhere.
 */
const MOCK_PORT = Number(process.env.MOCK_OPENAI_PORT ?? 43299);
const HERE = fileURLToPath(new URL(".", import.meta.url));

const stubCredentialRouter: CredentialRouter = {
  resolve: () => undefined,
  reportFailure: () => {},
  listStatuses: () => [],
};

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { method: "POST", body: "{}" });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function main(): Promise<void> {
  let mockProcess: ChildProcess | undefined;
  let proxy: { port: number; close(): Promise<void> } | undefined;
  const externalMockUrl = process.env.AI_OFFICE_BACKEND_MOCK_OPENAI_BASE_URL;

  try {
    if (!externalMockUrl) {
      // node_modules/tsx is hoisted to the workspace root by npm workspaces,
      // not into apps/server/node_modules — same layout scripts/dev.mjs
      // resolves against (repoRoot/node_modules/tsx/dist/cli.mjs).
      const tsxCli = join(HERE, "../../../../node_modules/tsx/dist/cli.mjs");
      mockProcess = spawn(process.execPath, [tsxCli, join(HERE, "mock-openai-backend.ts"), String(MOCK_PORT)], {
        stdio: "inherit",
      });
      await waitForHttp(`http://127.0.0.1:${MOCK_PORT}/v1/chat/completions`, 10_000);
    }

    process.env.AI_OFFICE_BACKEND_MOCK_OPENAI_BASE_URL ??= `http://127.0.0.1:${MOCK_PORT}/v1`;
    process.env.AI_OFFICE_BACKEND_MOCK_OPENAI_AUTH_TOKEN ??= "test-token-unused-by-mock";

    const backendProfiles: BackendProfileRegistry = {
      "mock-openai": {
        id: "mock-openai",
        label: "Mock OpenAI Backend (dev/test)",
        baseUrlEnvVar: "AI_OFFICE_BACKEND_MOCK_OPENAI_BASE_URL",
        authTokenEnvVar: "AI_OFFICE_BACKEND_MOCK_OPENAI_AUTH_TOKEN",
        apiFormat: "openai-chat-completions",
      },
    };

    proxy = await startFormatTranslationProxy(backendProfiles, 43220);
    const proxyBaseUrl = `http://127.0.0.1:${proxy.port}`;

    const workspacePath = mkdtempSync(join(tmpdir(), "ai-office-proxy-test-"));
    execFileSync("git", ["init", "-q"], { cwd: workspacePath });
    execFileSync(
      "git",
      ["-c", "user.email=verify@ai-office.local", "-c", "user.name=ai-office-verify", "commit", "--allow-empty", "-q", "-m", "init"],
      { cwd: workspacePath }
    );

    const events: OfficeEvent[] = [];
    const orchestrator = new Orchestrator({
      adapters: { "claude-code": new ClaudeCodeAdapter(stubCredentialRouter, backendProfiles, proxyBaseUrl) },
      broadcast: (event) => {
        events.push(event);
        if (event.type === "agent_task_progress") console.log(`[progress] ${event.message}`);
      },
    });

    const now = new Date().toISOString();
    const agent: Agent = {
      id: "agent-proxy-verify",
      state: "available",
      runtime: "claude-code",
      backendProfile: "mock-openai",
      eligibleCapabilities: [],
      capabilities: [],
      createdAt: now,
      updatedAt: now,
    };
    orchestrator.registerAgent(agent);

    await orchestrator.submitTask({
      description: "Create hello.txt (the mock backend decides the actual tool call, not this text).",
      workspacePath,
    });

    const settled = await new Promise<OfficeEvent>((resolve) => {
      const check = () => {
        const terminal = events.find((e) => e.type === "task_completed" || e.type === "task_failed");
        if (terminal) resolve(terminal);
        else setTimeout(check, 200);
      };
      check();
    });

    const targetPath = join(workspacePath, "hello.txt");
    const fileOk = existsSync(targetPath) && readFileSync(targetPath, "utf8").includes("Hello from the mock OpenAI backend");

    console.log("\n=== RESULT ===");
    console.log("terminal event:", JSON.stringify(settled));
    console.log("workspacePath:", workspacePath);
    console.log("hello.txt written with expected content:", fileOk);

    const ok = settled.type === "task_completed" && fileOk;
    console.log(ok ? "\nPASS: full interaction (incl. tool-use round trip) succeeded through the openai-chat-completions proxy path." : "\nFAIL");
    process.exitCode = ok ? 0 : 1;
  } finally {
    await proxy?.close();
    mockProcess?.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
