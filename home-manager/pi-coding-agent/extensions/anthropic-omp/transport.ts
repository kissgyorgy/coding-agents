// Adapted from can1357/oh-my-pi at 35c5fc5f9a; see LICENSE and README.md.
import { createHash } from "node:crypto";
import type { FetchFunction } from "@earendil-works/pi-ai";
import { rewritePiDocumentation } from "./system-prompt.ts";
import { xxhash64 } from "./xxhash.ts";

export const API_ORIGIN = "https://api.anthropic.com";
export const CLAUDE_CODE_VERSION = "2.1.280";
const SDK_VERSION = "0.112.1";
const IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
const BILLING_PREFIX = "x-anthropic-billing-header:";
const CCH_SEED = 0x4d659218e32a3268n;
const encoder = new TextEncoder();
const BUILTIN_TOOLS = new Set([
  "web_search",
  "code_execution",
  "text_editor",
  "computer",
]);
const BETAS = [
  "claude-code-20250219",
  "oauth-2025-04-20",
  "interleaved-thinking-2025-05-14",
  "thinking-token-count-2026-05-13",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "mid-conversation-system-2026-04-07",
  "effort-2025-11-24",
  "fallback-credit-2026-06-01",
];

export interface WireIdentity {
  sessionId: string;
  deviceId: string;
  accountId?: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function deviceId(installId: string, accountId?: string): string {
  const input = accountId
    ? `omp-claude-device-id-v2\0${installId}\0${accountId}`
    : `omp-claude-device-id-v1:${installId}`;
  return createHash("sha256").update(input).digest("hex");
}

export function claudeVersion(): string {
  const version = process.env.PI_AI_CLAUDE_CODE_VERSION || CLAUDE_CODE_VERSION;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("PI_AI_CLAUDE_CODE_VERSION must be a semantic version");
  }
  return version;
}

export function oauthHeaders(token: string): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    "anthropic-beta": "oauth-2025-04-20",
    "user-agent": `claude-cli/${claudeVersion()} (external, cli)`,
    authorization: `Bearer ${token}`,
  };
}

function prefixTool(name: string): string {
  return BUILTIN_TOOLS.has(name.toLowerCase()) ? name : `_${name}`;
}

function prefixDefinition(value: unknown): void {
  if (
    isRecord(value) &&
    typeof value.name === "string" &&
    (value.type === undefined || value.type === "custom")
  ) {
    value.name = prefixTool(value.name);
  }
}

function prefixContent(content: unknown): void {
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (
      (block.type === "tool_use" || block.type === "tool_reference") &&
      typeof block.name === "string"
    ) {
      block.name = prefixTool(block.name);
    }
    if (block.type === "tool_addition" && isRecord(block.tool)) {
      prefixDefinition(block.tool.definition);
    }
    if (block.type === "tool_removal" && isRecord(block.tool)) {
      prefixContent([block.tool]);
    }
    // Never walk input_schema or tool input: those belong to the user's tool.
    if (Array.isArray(block.content)) prefixContent(block.content);
  }
}

function adaptSystemBlock(block: unknown): unknown {
  if (
    isRecord(block) &&
    block.type === "text" &&
    typeof block.text === "string"
  ) {
    return { ...block, text: rewritePiDocumentation(block.text) };
  }
  return block;
}

function firstUserText(messages: unknown[]): string {
  for (const message of messages) {
    if (!isRecord(message) || message.role !== "user") continue;
    if (typeof message.content === "string" && message.content.trim()) {
      return message.content;
    }
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (
        isRecord(block) &&
        block.type === "text" &&
        typeof block.text === "string" &&
        block.text.trim()
      ) {
        return block.text;
      }
    }
    if (
      message.content.some((block) => isRecord(block) && block.type === "image")
    )
      return "";
  }
  return "";
}

export function adaptPayload(
  payload: unknown,
  identity: WireIdentity,
  version = claudeVersion(),
): Uint8Array<ArrayBuffer> {
  if (!isRecord(payload) || !Array.isArray(payload.messages)) {
    throw new Error("Anthropic OMP received an invalid Messages payload");
  }
  const firstText = firstUserText(payload.messages);
  const seed = [4, 7, 20].map((index) => firstText[index] ?? "0").join("");
  const suffix = createHash("sha256")
    .update(`59cf53e54c78${seed}${version}`)
    .digest("hex")
    .slice(0, 3);
  const system = Array.isArray(payload.system)
    ? payload.system
    : typeof payload.system === "string"
      ? [{ type: "text", text: payload.system }]
      : [];
  const existingIdentity = system.find(
    (block) => isRecord(block) && block.text === IDENTITY,
  );
  payload.system = [
    {
      type: "text",
      text: `${BILLING_PREFIX} cc_version=${version}.${suffix}; cc_entrypoint=cli; cch=00000;`,
    },
    {
      type: "text",
      text: IDENTITY,
      ...(isRecord(existingIdentity) && existingIdentity.cache_control
        ? { cache_control: existingIdentity.cache_control }
        : {}),
    },
    ...system
      .filter(
        (block) =>
          !isRecord(block) ||
          typeof block.text !== "string" ||
          (block.text !== IDENTITY && !block.text.startsWith(BILLING_PREFIX)),
      )
      .map(adaptSystemBlock),
  ];
  payload.metadata = {
    ...(isRecord(payload.metadata) ? payload.metadata : {}),
    user_id: JSON.stringify({
      device_id: identity.deviceId,
      session_id: identity.sessionId,
      ...(identity.accountId ? { account_uuid: identity.accountId } : {}),
    }),
  };
  if (Array.isArray(payload.tools)) payload.tools.forEach(prefixDefinition);
  for (const message of payload.messages) {
    if (!isRecord(message)) continue;
    if (message.role === "system") {
      if (typeof message.content === "string") {
        message.content = rewritePiDocumentation(message.content);
      } else if (Array.isArray(message.content)) {
        message.content = message.content.map(adaptSystemBlock);
      }
    }
    prefixContent(message.content);
  }
  if (
    isRecord(payload.tool_choice) &&
    payload.tool_choice.type === "tool" &&
    typeof payload.tool_choice.name === "string"
  ) {
    payload.tool_choice.name = prefixTool(payload.tool_choice.name);
  }

  const bytes = encoder.encode(JSON.stringify(payload));
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const marker = `"system":[{"type":"text","text":"${BILLING_PREFIX}`;
  const start = view.indexOf(marker);
  const offset =
    start < 0 ? -1 : view.indexOf("cch=00000", start + marker.length);
  if (offset < 0 || offset - start > 200) {
    throw new Error("Anthropic OMP could not locate its billing attestation");
  }
  const hash = (xxhash64(bytes, CCH_SEED) & 0xfffffn)
    .toString(16)
    .padStart(5, "0");
  view.write(hash, offset + 4, 5, "ascii");
  return bytes;
}

function decodeToolLine(line: string): string {
  if (!line.startsWith("data:")) return line;
  let event: unknown;
  try {
    event = JSON.parse(line.slice(5));
  } catch {
    return line;
  }
  if (
    !isRecord(event) ||
    event.type !== "content_block_start" ||
    !isRecord(event.content_block)
  )
    return line;
  const block = event.content_block;
  if (
    block.type !== "tool_use" ||
    typeof block.name !== "string" ||
    !block.name.startsWith("_")
  )
    return line;
  block.name = block.name.slice(1);
  return `data: ${JSON.stringify(event)}${line.endsWith("\r") ? "\r" : ""}`;
}

function decodeToolStream(
  body: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let pending = "";
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });
        let end: number;
        let output = "";
        while ((end = pending.indexOf("\n")) >= 0) {
          output += `${decodeToolLine(pending.slice(0, end))}\n`;
          pending = pending.slice(end + 1);
        }
        if (output) controller.enqueue(encoder.encode(output));
      },
      flush(controller) {
        pending += decoder.decode();
        if (pending)
          controller.enqueue(encoder.encode(decodeToolLine(pending)));
      },
    }),
  );
}

export function ompFetch(
  base: FetchFunction,
  token: string,
  identity: WireIdentity,
  observe: (headers: Headers) => void,
): FetchFunction {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (
      url.origin !== API_ORIGIN ||
      url.pathname !== "/v1/messages" ||
      request.method !== "POST"
    ) {
      throw new Error(
        "Anthropic OMP only sends credentials to https://api.anthropic.com/v1/messages",
      );
    }
    request.signal.throwIfAborted();
    const payload: unknown = JSON.parse(await request.text());
    const version = claudeVersion();
    const body = adaptPayload(payload, identity, version);
    const headers = new Headers(request.headers);
    headers.delete("x-api-key");
    headers.delete("content-length");
    headers.set("authorization", `Bearer ${token}`);
    headers.set("content-type", "application/json");
    headers.set("accept", "application/json");
    headers.set("user-agent", `claude-cli/${version} (external, cli)`);
    headers.set("x-app", "cli");
    headers.set("x-claude-code-session-id", identity.sessionId);
    headers.set("anthropic-version", "2023-06-01");
    headers.set("anthropic-dangerous-direct-browser-access", "true");
    headers.set("x-stainless-package-version", SDK_VERSION);
    headers.set("x-stainless-runtime", "node");
    headers.set("x-stainless-runtime-version", "v26.3.0");
    headers.set("x-stainless-lang", "js");
    headers.set("x-stainless-retry-count", "0");
    headers.set("x-stainless-timeout", "600");
    // Preserve Pi's model-specific betas, but never opt subscription tokens into paid long context.
    headers.set(
      "anthropic-beta",
      [
        ...new Set([
          ...BETAS,
          ...(headers.get("anthropic-beta") ?? "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        ]),
      ]
        .filter((beta) => beta !== "context-1m-2025-08-07")
        .join(","),
    );
    request.signal.throwIfAborted();
    const response = await base(
      new Request(request, {
        body,
        headers,
        redirect: "error",
      }),
    );
    observe(response.headers);
    if (
      !response.ok ||
      !response.body ||
      !response.headers.get("content-type")?.includes("text/event-stream")
    ) {
      return response;
    }
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-length");
    responseHeaders.delete("content-encoding");
    return new Response(decodeToolStream(response.body), {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  };
}
