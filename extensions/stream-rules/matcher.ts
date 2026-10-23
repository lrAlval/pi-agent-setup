/**
 * matcher — scan assistant text for rule hits within hard bounds.
 *
 * Bounds: text scan capped at 200k chars (tail only past that),
 * max 5 matches per message, disabled and already-corrected rules skipped.
 */
import type { CompiledRule } from "./rules.ts";

export interface MatchResult {
  rule: CompiledRule;
  matchIndex: number;
  excerpt: string;
}

/** Max assistant chars scanned per message. Past that, scan the tail. */
export const MAX_SCAN_CHARS = 200_000;
/** Max rule matches returned per message. */
export const MAX_MATCHES = 5;

export function extractAssistantText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") parts.push(part);
    else if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
      parts.push((part as { text: string }).text);
    }
  }
  return parts.join("\n");
}

/** Last assistant message text from an llmMessages-style array. */
export function lastAssistantText(llmMessages: unknown): string {
  if (!Array.isArray(llmMessages)) return "";
  for (let i = llmMessages.length - 1; i >= 0; i--) {
    const m = llmMessages[i] as { role?: unknown };
    if (m && typeof m === "object" && m.role === "assistant") {
      return extractAssistantText(m);
    }
  }
  return "";
}

export function matchRules(
  rules: CompiledRule[],
  assistantText: string,
  corrected: Set<string>,
): MatchResult[] {
  const out: MatchResult[] = [];
  if (!assistantText) return out;
  const haystack =
    assistantText.length > MAX_SCAN_CHARS ? assistantText.slice(-MAX_SCAN_CHARS) : assistantText;
  for (const rule of rules) {
    if (out.length >= MAX_MATCHES) break;
    if (!rule.enabled) continue;
    if (corrected.has(rule.name)) continue;
    let m: RegExpExecArray | null;
    try {
      rule.pattern.lastIndex = 0;
      m = rule.pattern.exec(haystack);
    } catch {
      continue; // a rule that throws on exec never blocks the turn
    }
    if (!m) continue;
    const at = Math.max(0, (m.index ?? 0) - 60);
    const excerpt = haystack.slice(at, (m.index ?? 0) + 120).replace(/\s+/g, " ").trim().slice(0, 160);
    out.push({ rule, matchIndex: m.index ?? 0, excerpt });
  }
  return out;
}
