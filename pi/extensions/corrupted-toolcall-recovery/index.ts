/**
 * corrupted-toolcall-recovery - detect + recover from malformed tool-call markup.
 *
 * Some models (observed: muse-spark) occasionally emit tool-call markup as
 * mangled plain text (e.g. `<atem:function_calls>` / `<atem:invoke ...>`)
 * instead of a native function call. The agent loop then ends the turn with
 * no toolCall to execute and the session silently stalls.
 *
 * This extension watches agent_end: when the final assistant message has no
 * real toolCall item but contains corrupted markup text, it notifies the
 * user, appends one JSONL evidence line to
 * ~/.pi/agent/logs/corrupted-toolcalls.jsonl (best-effort), and queues a
 * corrective follow-up prompt asking the model to re-issue the same call via
 * the native mechanism. Bounded at 2 consecutive auto-repairs; a third
 * consecutive hit notifies and stops (manual re-prompt needed). Any clean
 * assistant turn resets the counter.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CORRUPTED_MARKUP_RE = /<[a-z]{3,4}m:function_calls|<[a-z]{3,4}m:invoke\s+name=/;

const REPAIR_PROMPT =
  "Your previous response contained malformed tool-call markup (e.g. <atem:function_calls>) written as plain text instead of using the native function-call format. Re-issue the exact same tool call using the proper function calling mechanism. Do not write tool-call XML tags in your text output.";

const MAX_REPAIRS = 2;

function agentDir(): string {
  const env = process.env.PI_CODING_AGENT_DIR?.trim();
  if (env) return env;
  return join(homedir(), ".pi", "agent");
}

function logEvidence(row: Record<string, unknown>): void {
  try {
    mkdirSync(join(agentDir(), "logs"), { recursive: true });
    appendFileSync(
      join(agentDir(), "logs", "corrupted-toolcalls.jsonl"),
      JSON.stringify({ ts: new Date().toISOString(), ...row }) + "\n",
    );
  } catch {
    // evidence is best-effort; recovery must not depend on it
  }
}

function textParts(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const part of content) {
    if (typeof part === "string") out.push(part);
    else if (
      part &&
      typeof part === "object" &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      out.push((part as { text: string }).text);
    }
  }
  return out;
}

let repairCount = 0;

export default function (pi: ExtensionAPI): void {
  pi.on("agent_end", async (event, ctx) => {
    const record = (event ?? {}) as unknown as Record<string, unknown>;
    const messages = record["messages"];
    if (!Array.isArray(messages) || messages.length === 0) return;
    const last = messages[messages.length - 1] as Record<string, unknown>;
    if (last?.["role"] !== "assistant") return;

    const items = Array.isArray(last?.["content"]) ? (last["content"] as unknown[]) : [];
    if (
      items.some(
        (i) => typeof i === "object" && i !== null && (i as { type?: unknown }).type === "toolCall",
      )
    ) {
      repairCount = 0;
      return;
    }

    const hit = textParts(last?.["content"]).find((t) => CORRUPTED_MARKUP_RE.test(t));
    if (hit === undefined) {
      repairCount = 0;
      return;
    }
    const snippet = hit.slice(0, 200);

    if (repairCount >= MAX_REPAIRS) {
      try {
        ctx.ui.notify(
          "Malformed tool-call markup persists after 2 repair attempts - manual re-prompt needed.",
          "warning",
        );
      } catch {
        // notify must never break the loop
      }
      logEvidence({ kind: "corrupted-toolcall", gaveUp: true, snippet });
      return;
    }

    repairCount++;
    try {
      ctx.ui.notify("Model emitted malformed tool-call markup; requesting re-issue...", "warning");
    } catch {
      // notify must never break the loop
    }
    logEvidence({
      kind: "corrupted-toolcall",
      attempt: repairCount,
      model: String(record["model"] ?? record["modelId"] ?? ""),
      snippet,
    });
    try {
      pi.sendUserMessage(REPAIR_PROMPT, { deliverAs: "followUp" });
    } catch (err) {
      logEvidence({
        kind: "corrupted-toolcall",
        repairError: err instanceof Error ? err.message : String(err),
        snippet,
      });
      try {
        ctx.ui.notify("Tool-call repair re-issue failed: " + String(err), "error");
      } catch {
        // notify must never break the loop
      }
    }
  });
}
