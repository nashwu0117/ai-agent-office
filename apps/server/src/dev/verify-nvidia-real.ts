import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
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
 * v0.11 acceptance check: same shape as verify-openai-proxy.ts, but against
 * the real NVIDIA NIM API instead of the mock backend — proving the
 * "openai-chat-completions" translation path against an actual third-party
 * service, not just the mock. `npm run verify-nvidia-real` from apps/server.
 * Requires AI_OFFICE_NVIDIA_BASE_URL / AI_OFFICE_NVIDIA_API_KEY /
 * AI_OFFICE_NVIDIA_MODEL already set (see apps/server/.env.local, git-ignored).
 */
const stubCredentialRouter: CredentialRouter = {
  resolve: () => undefined,
  reportFailure: () => {},
  listStatuses: () => [],
};

async function main(): Promise<void> {
  const baseUrl = process.env.AI_OFFICE_NVIDIA_BASE_URL;
  const apiKey = process.env.AI_OFFICE_NVIDIA_API_KEY;
  const model = process.env.AI_OFFICE_NVIDIA_MODEL;
  if (!baseUrl || !apiKey || !model) {
    throw new Error("AI_OFFICE_NVIDIA_BASE_URL, AI_OFFICE_NVIDIA_API_KEY, and AI_OFFICE_NVIDIA_MODEL must all be set");
  }

  const backendProfiles: BackendProfileRegistry = {
    "nvidia-real": {
      id: "nvidia-real",
      label: "NVIDIA API (real key, edited)",
      apiFormat: "openai-chat-completions",
      baseUrlEnvVar: "AI_OFFICE_NVIDIA_BASE_URL",
      authTokenEnvVar: "AI_OFFICE_NVIDIA_API_KEY",
      modelOverrideEnvVar: "AI_OFFICE_NVIDIA_MODEL",
    },
  };

  const proxy = await startFormatTranslationProxy(backendProfiles, 43221);
  const proxyBaseUrl = `http://127.0.0.1:${proxy.port}`;

  try {
    const workspacePath = mkdtempSync(join(tmpdir(), "ai-office-nvidia-real-test-"));
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
      id: "agent-01",
      state: "available",
      runtime: "claude-code",
      backendProfile: "nvidia-real",
      eligibleCapabilities: [],
      capabilities: [],
      createdAt: now,
      updatedAt: now,
    };
    orchestrator.registerAgent(agent);

    console.log(`[verify] dispatching real task through NVIDIA NIM model "${model}"...`);
    await orchestrator.submitTask({
      description:
        "Create a file named nim-proof.txt containing exactly this single line: Hello from a real NVIDIA NIM backend.",
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

    const targetPath = join(workspacePath, "nim-proof.txt");
    const fileOk = existsSync(targetPath) && readFileSync(targetPath, "utf8").includes("Hello from a real NVIDIA NIM backend");

    console.log("\n=== RESULT ===");
    console.log("terminal event:", JSON.stringify(settled));
    console.log("workspacePath:", workspacePath);
    console.log("nim-proof.txt written with expected content:", fileOk);
    if (existsSync(targetPath)) console.log("file contents:", readFileSync(targetPath, "utf8"));

    const ok = settled.type === "task_completed" && fileOk;
    console.log(ok ? "\nPASS: real task completed through the real NVIDIA NIM backend." : "\nFAIL");
    process.exitCode = ok ? 0 : 1;
  } finally {
    await proxy.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
