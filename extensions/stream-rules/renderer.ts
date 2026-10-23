/**
 * renderer — pure text shaping for the correction card.
 * The TUI component wrapper lives in index.ts (registerMessageRenderer).
 */
import type { MatchResult } from "./matcher.ts";

export interface CorrectionDetails {
  kind: "stream-rule-correction";
  ruleName: string;
  ruleText: string;
  matchCount: number;
  maxCorrections: number;
  timestamp: string;
}

export const CORRECTION_CUSTOM_TYPE = "stream-rule-correction";
export const CORRECTION_KIND = "stream-rule-correction";

/** Compact muted card. File order of matches preserved by caller. */
export function renderRuleCorrection(matches: MatchResult[], turnIndex: number): string {
  const lines = matches.map((m, i) => {
    const cap = `${i + 1} of ${m.rule.maxCorrections}`;
    return `[rule] ${m.rule.name}: ${m.rule.rule} (match ${cap})`;
  });
  return lines.join("\n") + `\n(turn ${turnIndex})`;
}

export function buildCorrectionDetails(match: MatchResult): CorrectionDetails {
  return {
    kind: CORRECTION_KIND,
    ruleName: match.rule.name,
    ruleText: match.rule.rule,
    matchCount: 1,
    maxCorrections: match.rule.maxCorrections,
    timestamp: new Date().toISOString(),
  };
}
