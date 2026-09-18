import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AgentRole, BackendProfile, BackendProfileRegistry } from "@ai-office/core";
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
 *    auth header (replaced with this profile's own credential) and, if
 *    roleModelMap/fallbackModel resolve to something, the body's `model`
 *    field (v0.15 introduced this rewrite, v0.21 moved it onto
 *    resolveRoleModel — see passthroughToAnthropic).
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

  // v0.21: a profile whose wire format was never picked (see
  // BackendProfile.apiFormat's "unset" doc comment) is caught here, before
  // any credential lookup — a clear configuration error, not a guess at
  // which branch below to send its bytes down.
  if (profile.apiFormat === "unset") {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: {
          message: `Backend profile "${profileId}" has no API format selected yet — pick "Anthropic Messages API" or "OpenAI Chat Completions" for it in the Backend & Credentials panel before dispatching a task through it.`,
        },
      })
    );
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
    await passthroughToAnthropic(req, res, baseUrl, authToken, rest + url.search, rawBody, profile);
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

  await proxyOpenAITranslated(res, baseUrl, authToken, anthropicReq, profile);
}

/**
 * v0.21: resolves which upstream model id to actually send for this request,
 * given the model the `claude` CLI itself asked for. Priority order:
 * 1. An exact family match in roleModelMap (sonnet/opus/haiku/fable),
 *    matched by case-insensitive substring against `requestedModel` — a
 *    real wire-level signal, see RoleModelMap's own doc comment.
 * 2. roleModelMap.subagent, as the catch-all for a requested model that
 *    matched none of the four families above — documented best-effort, not
 *    genuine subagent detection (again, see RoleModelMap's comment).
 * 3. profile.fallbackModel.
 * 4. undefined — no rewrite, forward `requestedModel` unchanged.
 */
function resolveRoleModel(profile: BackendProfile, requestedModel: string | undefined): string | undefined {
  const lower = requestedModel?.toLowerCase() ?? "";
  const roleMap = profile.roleModelMap;
  if (roleMap) {
    const families: Array<[string, AgentRole]> = [
      ["sonnet", "sonnet"],
      ["opus", "opus"],
      ["fable", "fable"],
      ["haiku", "haiku"],
    ];
    for (const [needle, role] of families) {
      if (lower.includes(needle) && roleMap[role]) return roleMap[role];
    }
    if (roleMap.subagent) return roleMap.subagent;
  }
  return profile.fallbackModel || undefined;
}

/** v0.21: shallow-merges a profile's customBodyOverride into a parsed request body, after model resolution — see CustomBodyOverride's doc comment. */
function applyCustomBody<T extends Record<string, unknown>>(body: T, override: Record<string, unknown> | undefined): T {
  if (!override) return body;
  return { ...body, ...override };
}

/** v0.21: adds a profile's extra static headers on top of whatever's already set — see CustomHeaders' doc comment for why the auth/host headers themselves are never eligible (enforced at validation time, not here, but this stays defensive). */
function applyCustomHeaders(headers: Headers, custom: Record<string, string> | undefined): Headers {
  if (!custom) return headers;
  for (const [key, value] of Object.entries(custom)) {
    const lower = key.toLowerCase();
    if (lower === "x-api-key" || lower === "authorization" || lower === "host") continue;
    headers.set(key, value);
  }
  return headers;
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
  rawBody: Buffer,
  profile: BackendProfile
): Promise<void> {
  // v0.15: was a byte-for-byte pass-through with no way to redirect which
  // model id an "anthropic" apiFormat profile's key actually requests —
  // unlike the openai-chat-completions path below, which has always
  // rewritten `model`. v0.21: goes through resolveRoleModel (role mapping >
  // fallbackModel) plus customBodyOverride. Only parses/rewrites the body
  // when there's actually something to change; with none of those
  // configured, this still forwards `rawBody` completely unmodified, so a
  // profile that never opts in keeps the exact byte-passthrough behavior
  // documented above.
  let body: Buffer = rawBody;
  if (profile.roleModelMap || profile.fallbackModel || profile.customBodyOverride) {
    try {
      const parsed = JSON.parse(rawBody.toString("utf8")) as { model?: string } & Record<string, unknown>;
      const resolvedModel = resolveRoleModel(profile, parsed.model);
      if (resolvedModel) parsed.model = resolvedModel;
      const withOverride = applyCustomBody(parsed, profile.customBodyOverride);
      body = Buffer.from(JSON.stringify(withOverride), "utf8");
    } catch {
      // Not JSON — fall back to the original bytes rather than fail the
      // request over an optional override.
    }
  }

  const upstream = await fetch(`${baseUrl.replace(/\/$/, "")}${pathAndQuery}`, {
    method: "POST",
    headers: applyCustomHeaders(buildUpstreamRequestHeaders(req, authToken), profile.customHeaders),
    body: new Uint8Array(body),
  });
  res.writeHead(upstream.status, upstreamResponseHeaders(upstream.headers));
  await pipeUpstreamBody(upstream, res);
}

async function proxyOpenAITranslated(
  res: ServerResponse,
  baseUrl: string,
  authToken: string,
  anthropicReq: AnthropicMessagesRequest,
  profile: BackendProfile
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
  // documented echo-back behavior. v0.21: resolution now goes through
  // resolveRoleModel (role mapping > fallbackModel), and customBodyOverride
  // is shallow-merged in afterward.
  const resolvedModel = resolveRoleModel(profile, anthropicReq.model);
  if (resolvedModel) openaiReq.model = resolvedModel;
  const openaiReqWithOverride = applyCustomBody(openaiReq as unknown as Record<string, unknown>, profile.customBodyOverride);

  const upstream = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: applyCustomHeaders(
      new Headers({ "content-type": "application/json", authorization: `Bearer ${authToken}` }),
      profile.customHeaders
    ),
    body: JSON.stringify(openaiReqWithOverride),
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
