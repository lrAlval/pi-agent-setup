/**
 * token-trail — pre-injection hard cap + per-turn token audit log.
 *
 * Covers tool outputs rtk-optimizer doesn't (ast_grep, wiki_*, mcp/*,
 * subagent/delegate results, search/recall): anything over MAX_CHARS is cut
 * to a head+tail excerpt with a `[token-trail: truncated N chars]` marker.
 *
 * Every tool_result appends one JSONL row to ~/.pi/agent/token-trail.jsonl:
 * {ts, tool, inChars, outChars, truncated}. agent_end rows carry model
 * usage when the host provides it ({ts, model, input, output, cached}).
 * The log feeds the before/after session audit (>=30% input reduction goal).
 *
 * No footer of its own: use the pi-footer preset widgets (context-length,
 * tokens, cost, cache-hit-rate).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_CHARS = 30_000;
const HEAD_CHARS = 20_000;
const TAIL_CHARS = 8_000;

// Tools rtk-optimizer already compacts; leave them alone.
const RTK_COVERED = new Set([
  "bash",
  "read",
  "grep",
  "find",
  "ls",
  "edit",
  "write",
]);

function agentDir(): string {
  const env = process.env.PI_CODING_AGENT_DIR?.trim();
  if (env) return env;
  return join(homedir(), ".pi", "agent");
}

function logPath(): string {
  return join(agentDir(), "token-trail.jsonl");
}

function logRow(row: Record<string, unknown>): void {
  try {
    appendFileSync(logPath(), JSON.stringify({ ts: new Date().toISOString(), ...row }) + "\n");
  } catch {
    // audit logging never breaks the session
  }
}

function contentText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === "string") parts.push(part);
      else if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        parts.push((part as { text: string }).text);
      }
    }
    return parts.length > 0 ? parts.join("\n") : undefined;
  }
  return undefined;
}

function cap(text: string): { text: string; truncated: number } {
  if (text.length <= MAX_CHARS) return { text, truncated: 0 };
  const head = text.slice(0, HEAD_CHARS);
  const tail = text.slice(text.length - TAIL_CHARS);
  const truncated = text.length - HEAD_CHARS - TAIL_CHARS;
  return {
    text: `${head}\n\n[token-trail: truncated ${truncated} chars]\n\n${tail}`,
    truncated,
  };
}

export default function (pi: ExtensionAPI): void {
  pi.on("tool_result", async (event) => {
    const record = event as unknown as Record<string, unknown>;
    const toolName = String(record["toolName"] ?? "");
    if (RTK_COVERED.has(toolName)) return {};

    const text = contentText(record["content"]);
    const inChars = JSON.stringify(record["input"] ?? "").length;
    if (text === undefined) {
      logRow({ kind: "tool", tool: toolName, inChars, outChars: 0, truncated: 0 });
      return {};
    }
    if (text.length <= MAX_CHARS) {
      logRow({ kind: "tool", tool: toolName, inChars, outChars: text.length, truncated: 0 });
      return {};
    }
    const { text: capped, truncated } = cap(text);
    logRow({ kind: "tool", tool: toolName, inChars, outChars: text.length, truncated });
    return { content: capped };
  });

  pi.on("agent_end", async (event) => {
    const record = (event ?? {}) as unknown as Record<string, unknown>;
    const usage = record["usage"] as Record<string, unknown> | undefined;
    if (usage && typeof usage === "object") {
      logRow({
        kind: "turn",
        model: String(record["model"] ?? record["modelId"] ?? ""),
        input: Number(usage["input"] ?? 0),
        output: Number(usage["output"] ?? 0),
        cached: Number(usage["cacheRead"] ?? usage["cached"] ?? 0),
      });
    } else {
      logRow({ kind: "turn" });
    }
  });
}
