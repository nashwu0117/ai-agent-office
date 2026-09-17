import { createServer } from "node:http";

/**
 * v0.9 test/demo fixture: a minimal OpenAI Chat Completions server used to
 * prove the format-translation proxy's "openai-chat-completions" path (not
 * just passthrough) end to end — see docs/api-format-translation.md
 * "Testing the translation path" for how to point a backendProfile at this.
 *
 * Not a general-purpose mock: it recognizes exactly one shape of request
 * (a Claude Code CLI turn that includes a "Write" tool) and drives a
 * deterministic two-turn conversation —
 *   turn 1 (no tool result yet): call the Write tool to create a file
 *   turn 2 (a tool result is present): reply with plain text and stop
 * — which is what running one real headless `claude -p` task against it
 * looks like on the wire. Supports both streaming and non-streaming
 * requests since the CLI's own default (streaming) and the simpler
 * non-streaming path both need coverage.
 */
const PORT = Number(process.argv[2] ?? process.env.MOCK_OPENAI_PORT ?? 43199);
const TARGET_FILE = process.env.MOCK_OPENAI_TARGET_FILE ?? "hello.txt";
const TARGET_CONTENT = process.env.MOCK_OPENAI_TARGET_CONTENT ?? "Hello from the mock OpenAI backend!\n";

interface ChatRequest {
  model?: string;
  stream?: boolean;
  messages?: Array<{ role: string; content?: unknown; tool_calls?: unknown }>;
  tools?: Array<{ type: string; function?: { name: string } }>;
}

function findWriteToolName(req: ChatRequest): string | undefined {
  const names = (req.tools ?? []).map((t) => t.function?.name).filter((n): n is string => Boolean(n));
  // Prefer an exact "Write" match — Claude Code's own tool names include
  // "TodoWrite", which also matches a loose /write/i scan and is the wrong
  // tool to call here (it doesn't touch the filesystem).
  return names.find((n) => n === "Write") ?? names.find((n) => /write/i.test(n) && n !== "TodoWrite");
}

function hasToolResult(req: ChatRequest): boolean {
  return (req.messages ?? []).some((m) => m.role === "tool");
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
    return;
  }

  let body: ChatRequest;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "invalid JSON" } }));
    return;
  }

  const id = `chatcmpl-mock-${Date.now()}`;
  const model = body.model ?? "mock-model";
  const resultTurn = hasToolResult(body);
  const writeToolName = findWriteToolName(body);

  if (body.messages && body.messages.length > 0) {
    console.log(
      `[mock-openai] turn: ${resultTurn ? "tool-result received -> finishing" : writeToolName ? `calling ${writeToolName}` : "no Write tool offered -> plain reply"}`
    );
  }

  if (body.stream) {
    streamResponse(res, id, model, resultTurn, writeToolName);
  } else {
    sendJsonResponse(res, id, model, resultTurn, writeToolName);
  }
});

function sendJsonResponse(
  res: import("node:http").ServerResponse,
  id: string,
  model: string,
  resultTurn: boolean,
  writeToolName: string | undefined
): void {
  const message = resultTurn
    ? { role: "assistant", content: `Done! I created ${TARGET_FILE}.` }
    : writeToolName
      ? {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: writeToolName, arguments: JSON.stringify({ file_path: TARGET_FILE, content: TARGET_CONTENT }) },
            },
          ],
        }
      : { role: "assistant", content: "No Write tool was offered in this request." };

  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message, finish_reason: resultTurn || !writeToolName ? "stop" : "tool_calls" }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    })
  );
}

function streamResponse(
  res: import("node:http").ServerResponse,
  id: string,
  model: string,
  resultTurn: boolean,
  writeToolName: string | undefined
): void {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });

  const send = (delta: Record<string, unknown>, finishReason: string | null = null) => {
    res.write(
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}\n\n`
    );
  };

  send({ role: "assistant" });

  if (resultTurn || !writeToolName) {
    const text = resultTurn ? `Done! I created ${TARGET_FILE}.` : "No Write tool was offered in this request.";
    for (const word of text.split(" ")) send({ content: `${word} ` });
    send({}, "stop");
  } else {
    const args = JSON.stringify({ file_path: TARGET_FILE, content: TARGET_CONTENT });
    send({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: writeToolName, arguments: "" } }] });
    // Split the arguments JSON into fragments to actually exercise
    // input_json_delta accumulation on the Anthropic side of the proxy,
    // not just a single-shot burst.
    const mid = Math.floor(args.length / 2);
    for (const fragment of [args.slice(0, mid), args.slice(mid)]) {
      send({ tool_calls: [{ index: 0, function: { arguments: fragment } }] });
    }
    send({}, "tool_calls");
  }

  res.write("data: [DONE]\n\n");
  res.end();
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-openai] listening on http://127.0.0.1:${PORT}/v1/chat/completions`);
});
