import "server-only";
import type { ToolSpec } from "./spec";

/** Minimal Claude Messages API client (server only). The key never leaves the server. */
type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
type ApiMsg = { role: "user" | "assistant"; content: string | Array<Record<string, unknown>> };

export interface ClaudeResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  model: string;
}

export function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

async function call(body: Record<string, unknown>) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("The AI assistant isn't configured (ANTHROPIC_API_KEY missing).");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    content?: Block[];
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: { message?: string; type?: string };
  };
  if (!res.ok) {
    const msg =
      res.status === 429
        ? "The AI service is busy — try again in a minute."
        : res.status === 401
          ? "The AI key is invalid."
          : json.error?.message;
    throw new Error(msg ?? `AI request failed (${res.status}).`);
  }
  return json;
}

/**
 * Run a conversation with optional tools. `runTool` executes a tool and returns a string result.
 * Stops after `maxRounds` tool rounds so a confused model can't loop forever.
 */
export async function runClaude(opts: {
  model: string;
  system: string;
  messages: ApiMsg[];
  tools?: ToolSpec[];
  runTool?: (name: string, input: Record<string, unknown>) => Promise<string>;
  maxTokens?: number;
  maxRounds?: number;
}): Promise<ClaudeResult> {
  const msgs: ApiMsg[] = [...opts.messages];
  let inputTokens = 0,
    outputTokens = 0,
    toolCalls = 0;
  for (let round = 0; round <= (opts.maxRounds ?? 5); round++) {
    const res = await call({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1200,
      system: opts.system,
      messages: msgs,
      ...(opts.tools?.length ? { tools: opts.tools } : {}),
    });
    inputTokens += res.usage?.input_tokens ?? 0;
    outputTokens += res.usage?.output_tokens ?? 0;
    const blocks = res.content ?? [];
    const uses = blocks.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !uses.length || !opts.runTool || round === (opts.maxRounds ?? 5)) {
      const text = blocks
        .filter((b): b is Extract<Block, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return {
        text: text || "I couldn't put an answer together — try asking more specifically.",
        inputTokens,
        outputTokens,
        toolCalls,
        model: opts.model,
      };
    }
    msgs.push({ role: "assistant", content: blocks as unknown as Array<Record<string, unknown>> });
    const results = [];
    for (const u of uses) {
      toolCalls++;
      let content: string;
      try {
        content = await opts.runTool(u.name, u.input ?? {});
      } catch (e) {
        content = JSON.stringify({ error: e instanceof Error ? e.message : "Tool failed" });
      }
      results.push({ type: "tool_result", tool_use_id: u.id, content });
    }
    msgs.push({ role: "user", content: results });
  }
  return {
    text: "That needed too many lookups — please ask a narrower question.",
    inputTokens,
    outputTokens,
    toolCalls,
    model: opts.model,
  };
}
