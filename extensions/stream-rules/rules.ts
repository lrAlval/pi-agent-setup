/**
 * stream-rules — bounded turn-boundary rule corrections.
 *
 * Rules live as JSONL (one rule per line) in:
 *   ~/.pi/agent/stream-rules.jsonl   (global)
 *   <cwd>/.pi/stream-rules.jsonl      (project, optional)
 *
 * A rule fires when its regex matches the last assistant message at
 * turn_end (or agent_before_settle fallback). The correction is injected
 * as a custom_message entry carrying the rule name, so it survives
 * compaction and never double-fires for the same rule within its cap.
 * Default cap: maxCorrections = 1 per rule per turn.
 */

import { readFileSync } from "node:fs";

export interface StreamRule {
  name: string;
  regex: string;
  rule: string;
  maxCorrections?: number;
  enabled?: boolean;
}

export interface ParseError {
  src: string;
  lineNo: number;
  line: string;
  error: string;
}

export interface CompiledRule extends StreamRule {
  pattern: RegExp;
  maxCorrections: number;
  enabled: boolean;
}

export function parseRuleLine(line: string, src: string, lineNo: number): StreamRule | ParseError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (e) {
    return { src, lineNo, line: line.slice(0, 200), error: `invalid JSON: ${(e as Error).message}` };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { src, lineNo, line: line.slice(0, 200), error: "rule must be a JSON object" };
  }
  const r = parsed as Record<string, unknown>;
  if (typeof r["name"] !== "string" || !r["name"]) {
    return { src, lineNo, line: line.slice(0, 200), error: 'missing required "name"' };
  }
  if (typeof r["regex"] !== "string" || !r["regex"]) {
    return { src, lineNo, line: line.slice(0, 200), error: 'missing required "regex"' };
  }
  if (typeof r["rule"] !== "string" || !r["rule"]) {
    return { src, lineNo, line: line.slice(0, 200), error: 'missing required "rule"' };
  }
  let pattern: RegExp;
  try {
    pattern = new RegExp(r["regex"] as string, "u");
  } catch (e) {
    return { src, lineNo, line: line.slice(0, 200), error: `bad regex: ${(e as Error).message}` };
  }
  void pattern;
  const out: StreamRule = {
    name: r["name"] as string,
    regex: r["regex"] as string,
    rule: r["rule"] as string,
  };
  if (typeof r["maxCorrections"] === "number" && Number.isFinite(r["maxCorrections"])) {
    out.maxCorrections = Math.max(1, Math.floor(r["maxCorrections"] as number));
  }
  if (typeof r["enabled"] === "boolean") out.enabled = r["enabled"] as boolean;
  return out;
}

export function compileRule(rule: StreamRule): CompiledRule {
  return {
    ...rule,
    pattern: new RegExp(rule.regex, "u"),
    maxCorrections: rule.maxCorrections ?? 1,
    enabled: rule.enabled ?? true,
  };
}

export function loadRulesFromText(
  text: string,
  src: string,
): { rules: CompiledRule[]; errors: ParseError[] } {
  const rules: CompiledRule[] = [];
  const errors: ParseError[] = [];
  const lines = text.split("\n");
  lines.forEach((raw, i) => {
    const line = raw.trim();
    // Skip blanks and the legacy empty-seed marker.
    if (!line || line === "[]") return;
    const parsed = parseRuleLine(line, src, i + 1);
    if ("error" in parsed) {
      errors.push(parsed);
      return;
    }
    try {
      rules.push(compileRule(parsed));
    } catch (e) {
      errors.push({ src, lineNo: i + 1, line: line.slice(0, 200), error: `compile failed: ${(e as Error).message}` });
    }
  });
  return { rules, errors };
}

export function loadRules(paths: [string, string]): { rules: CompiledRule[]; errors: ParseError[] } {
  const rules: CompiledRule[] = [];
  const errors: ParseError[] = [];
  for (const p of paths) {
    let text: string;
    try {
      text = readFileSync(p, "utf8");
    } catch {
      continue; // missing file = zero rules, not an error
    }
    const loaded = loadRulesFromText(text, p);
    rules.push(...loaded.rules);
    errors.push(...loaded.errors);
  }
  return { rules, errors };
}
