import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { BackendProfileRegistry } from "@ai-office/core";
import {
  anthropicRequestToOpenAI,
  openAIResponseToAnthropic,
  OpenAIStreamToAnthropicTranslator,
  type AnthropicMessagesRequest,
  type AnthropicSSEEvent,
  type OpenAIChatResponse,
  type OpenAIChatStreamChunk,
} from "@ai-office/core";
import { selectAvailablePort } from "@ai-office/core/node";

/**
 * v0.9: local HTTP proxy every backendProfile-routed claude-code agent talks
 * to instead of a third-party backend directly (see ClaudeCodeAdapter and
 * docs/api-format-translation.md). One path prefix per profile —
 * `http://127.0.0.1:<port>/<profileId>/` — so "which backend" is entirely a
 * BACKEND_PROFILES registry decision, never something ClaudeCodeAdapter
 * needs to know how to speak.
 *
 * Two profile.apiFormat behaviors:
 *  - "anthropic": byte-level reverse proxy. Same wire behavior as v0.8's
 *    direct env-var routing, just with this process as a hop — headers,
 *    JSON body, and SSE streaming are all forwarded unmodified except the
 *    auth header, which is replaced with this profile's own credential.
 *  - "openai-chat-completions": request/response (and SSE stream) are
 *    translated both directions through packages/core/src/proxy/translate.ts.
 *    Lossy in documented ways — see docs/api-format-translation.md.
 *
 * Official (no backendProfile) agents never reach this proxy — see
 * ClaudeCodeAdapter's comment for why that split is deliberate.
 */
export interface ProxyServerHandle {
  port: number;
  close(): Promise<void>;
}

export async function startFormatTranslationProxy(
  backendProfiles: BackendProfileRegistry,
  preferredPort: number
): Promise<ProxyServerHandle> {
  const server = createServer((req, res) => {
    handleRequest(req, res, backendProfiles).catch((err) => {
      console.error("[ai-office proxy] unhandled error:", err);
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      if (!res.writableEnded) {
        res.end(JSON.stringify({ error: { message: err instanceof Error ? err.message : String(err) } }));
      }
    });
  });

  const { port } = await selectAvailablePort(preferredPort, "format-translation proxy");
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  console.log(`[ai-office] format-translation proxy listening on http://127.0.0.1:${port}`);

  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, registry: BackendProfileRegistry): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "not found" } }));
    return;
  }

  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const segments = url.pathname.split("/").filter(Boolean);
  const profileId = segments[0];
  const rest = `/${segments.slice(1).join("/")}`;

  const profile = registry[profileId];
  if (!profile) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `Unknown backend profile "${profileId}" — not registered in BACKEND_PROFILES.` } }));
    return;
  }

  const baseUrl = process.env[profile.baseUrlEnvVar];
  const authToken = process.env[profile.authTokenEnvVar];
  if (!baseUrl || !authToken) {
    const missing = [!baseUrl && profile.baseUrlEnvVar, !authToken && profile.authTokenEnvVar].filter(Boolean).join(", ");
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `Backend profile "${profileId}" is missing required environment variable(s): ${missing}.` } }));
    return;
  }

  const rawBody = await readRawBody(req);

  if (profile.apiFormat === "anthropic") {
    await passthroughToAnthropic(req, res, baseUrl, authToken, rest + url.search, rawBody);
    return;
  }

  if (rest !== "/v1/messages") {
    res.writeHead(501, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: {
          message: `This proxy only translates POST /v1/messages for openai-chat-completions backends; "${rest}" has no translated equivalent (e.g. /v1/messages/count_tokens is unsupported — see docs/api-format-translation.md).`,
        },
      })
    );
    return;
  }

  let anthropicReq: AnthropicMessagesRequest;
  try {
    anthropicReq = JSON.parse(rawBody.toString("utf8")) as AnthropicMessagesRequest;
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "request body is not valid JSON" } }));
    return;
  }

  await proxyOpenAITranslated(res, baseUrl, authToken, anthropicReq, profile.modelOverrideEnvVar);
}

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const HOP_BY_HOP_REQUEST_HEADERS = new Set(["host", "content-length", "connection", "x-api-key", "authorization"]);

function buildUpstreamRequestHeaders(req: IncomingMessage, authToken: string): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || HOP_BY_HOP_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  // The only header this proxy actually rewrites: every other Anthropic
  // header the CLI sent (anthropic-version, anthropic-beta, ...) passes
  // through untouched so version/beta-gated behavior on the real backend
  // keeps working exactly as it did with v0.8's direct routing.
  headers.set("x-api-key", authToken);
  return headers;
}

const HOP_BY_HOP_RESPONSE_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding", "connection"]);

function upstreamResponseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    // fetch() transparently decompresses the response body, so a relayed
    // content-encoding/content-length from the upstream would no longer
    // describe the bytes actually being written below.
    if (HOP_BY_HOP_RESPONSE_HEADERS.has(key.toLowerCase())) return;
    out[key] = value;
  });
  return out;
}

async function pipeUpstreamBody(upstream: Response, res: ServerResponse): Promise<void> {
  if (!upstream.body) {
    res.end();
    return;
  }
  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    res.end();
  }
}

async function passthroughToAnthropic(
  req: IncomingMessage,
  res: ServerResponse,
  baseUrl: string,
  authToken: string,
  pathAndQuery: string,
  rawBody: Buffer
): Promise<void> {
  const upstream = await fetch(`${baseUrl.replace(/\/$/, "")}${pathAndQuery}`, {
    method: "POST",
    headers: buildUpstreamRequestHeaders(req, authToken),
    body: new Uint8Array(rawBody),
  });
  res.writeHead(upstream.status, upstreamResponseHeaders(upstream.headers));
  await pipeUpstreamBody(upstream, res);
}

async function proxyOpenAITranslated(
  res: ServerResponse,
  baseUrl: string,
  authToken: string,
  anthropicReq: AnthropicMessagesRequest,
  modelOverrideEnvVar: string | undefined
): Promise<void> {
  const { request: openaiReq, droppedTools } = anthropicRequestToOpenAI(anthropicReq);
  if (droppedTools.length > 0) {
    console.warn(
      `[ai-office proxy] dropped ${droppedTools.length} Anthropic-native tool(s) with no OpenAI function-calling equivalent: ${droppedTools.join(", ")}`
    );
  }

  // v0.11: req.model at this point is still whatever Anthropic model id the
  // `claude` CLI sent (e.g. "claude-3-5-sonnet-...") — meaningless to a real
  // OpenAI-format backend with its own model namespace. anthropicReq.model
  // (used below to build the translated response) is left untouched, so the
  // CLI still sees the model id it asked for, matching translate.ts's
  // documented echo-back behavior.
  const modelOverride = modelOverrideEnvVar && process.env[modelOverrideEnvVar]?.trim();
  if (modelOverride) openaiReq.model = modelOverride;

  const upstream = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${authToken}` },
    body: JSON.stringify(openaiReq),
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    res.writeHead(upstream.status, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: { type: "upstream_error", message: `openai-chat-completions backend returned ${upstream.status}: ${text.slice(0, 2000)}` },
      })
    );
    return;
  }

  if (anthropicReq.stream) {
    await streamOpenAIToAnthropic(upstream, res, anthropicReq.model);
    return;
  }

  const openaiResp = (await upstream.json()) as OpenAIChatResponse;
  const anthropicResp = openAIResponseToAnthropic(openaiResp, anthropicReq.model);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(anthropicResp));
}

async function streamOpenAIToAnthropic(upstream: Response, res: ServerResponse, model: string): Promise<void> {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });

  const translator = new OpenAIStreamToAnthropicTranslator(model);
  const writeEvents = (events: AnthropicSSEEvent[]) => {
    for (const evt of events) res.write(`event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`);
  };

  if (!upstream.body) {
    writeEvents(translator.finish());
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sepIndex: number;
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        if (payload === "[DONE]" || payload === "") continue;
        try {
          writeEvents(translator.chunk(JSON.parse(payload) as OpenAIChatStreamChunk));
        } catch {
          // Malformed SSE chunk from the backend — skip it rather than
          // aborting the whole stream. Best-effort, documented.
        }
      }
    }
  } finally {
    writeEvents(translator.finish());
    res.end();
  }
}
