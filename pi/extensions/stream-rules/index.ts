/**
 * stream-rules — bounded turn-boundary rule corrections.
 *
 * Fires on turn_end: scans the last assistant message, injects at most one
 * combined correction card (file order, max 5 rules), per-rule cap
 * (default 1/turn). Entries carry the rule name in details so later turns
 * never double-fire after compaction.
 *
 * /stream-rules list | reload | test <text> | on | off
 */
import type {
  ExtensionAPI,
  ExtensionContext,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadRules, type CompiledRule, type ParseError } from "./rules.ts";
import { lastAssistantText, matchRules, type MatchResult } from "./matcher.ts";
import {
  CORRECTION_CUSTOM_TYPE,
  CORRECTION_KIND,
  buildCorrectionDetails,
  renderRuleCorrection,
} from "./renderer.ts";

function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
}

function rulePaths(cwd: string): [string, string] {
  return [join(agentDir(), "stream-rules.jsonl"), join(resolve(cwd), ".pi", "stream-rules.jsonl")];
}

interface State {
  enabled: boolean;
  rules: CompiledRule[];
  errors: ParseError[];
  /** per-rule correction counts, reset every turn */
  counts: Map<string, number>;
  /** rules already corrected this turn (compaction-safe double-fire guard) */
  correctedThisTurn: Set<string>;
}

export default function streamRules(pi: ExtensionAPI): void {
  const state: State = { enabled: true, rules: [], errors: [], counts: new Map(), correctedThisTurn: new Set() };
  const cwd = resolve(".");

  function reload(): void {
    const loaded = loadRules(rulePaths(cwd));
    state.rules = loaded.rules;
    state.errors = loaded.errors;
    state.counts.clear();
    state.correctedThisTurn.clear();
  }
  reload();

  function assistantTextOf(event: TurnEndEvent): string {
    const fromCtx = lastAssistantText(
      (event.context as { llmMessages?: unknown } | undefined)?.llmMessages,
    );
    if (fromCtx) return fromCtx;
    // Fallback: the turn's own message (usually the last assistant message).
    const msg = (event as { message?: unknown }).message;
    if (msg && typeof msg === "object" && (msg as { role?: unknown }).role === "assistant") {
      const content = (msg as { content?: unknown }).content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content
          .map((p) => (typeof p === "string" ? p : (p as { text?: unknown }).text))
          .filter((t): t is string => typeof t === "string")
          .join("\n");
      }
    }
    return "";
  }

  function handleBoundary(event: TurnEndEvent): { entries?: unknown[]; continue?: boolean } | undefined {
    if (!state.enabled) return undefined;
    if (state.rules.length === 0) return undefined;
    const outcome = (event as { outcome?: string }).outcome;
    if (outcome === "aborted") {
      // User escaped: reset counters, never force a recontinue.
      state.counts.clear();
      state.correctedThisTurn.clear();
      return undefined;
    }
    const ctx = event.context as { canContinue?: boolean } | undefined;
    const topCanContinue = (event as unknown as { canContinue?: boolean }).canContinue;
    if (ctx?.canContinue === false && topCanContinue === false) return undefined;

    const text = assistantTextOf(event);
    if (!text) return undefined;
    const matches = matchRules(state.rules, text, state.correctedThisTurn);
    const fresh = matches.filter((m) => (state.counts.get(m.rule.name) ?? 0) < m.rule.maxCorrections);
    if (fresh.length === 0) return undefined;

    const turnIndex =
      typeof (event as { turnIndex?: unknown }).turnIndex === "number"
        ? ((event as { turnIndex?: unknown }).turnIndex as number)
        : 0;
    const content = renderRuleCorrection(fresh, turnIndex);
    for (const m of fresh) {
      state.counts.set(m.rule.name, (state.counts.get(m.rule.name) ?? 0) + 1);
      state.correctedThisTurn.add(m.rule.name);
    }
    const first: MatchResult = fresh[0];
    return {
      entries: [
        {
          type: "custom_message",
          customType: CORRECTION_CUSTOM_TYPE,
          content,
          display: true,
          details: {
            ...buildCorrectionDetails(first),
            matchCount: fresh.length,
            ruleNames: fresh.map((m) => m.rule.name),
          },
        },
      ],
      continue: true,
    };
  }

  pi.on("turn_start", () => {
    state.counts.clear();
    state.correctedThisTurn.clear();
  });
  pi.on("session_start", () => {
    state.counts.clear();
    state.correctedThisTurn.clear();
    reload();
  });
  pi.on("turn_end", (event) => handleBoundary(event) as never);
  pi.on("agent_before_settle", (event) => {
    // Safety net: if turn_end did not fire, apply the same logic once.
    if (state.correctedThisTurn.size > 0) return undefined;
    return handleBoundary(event as unknown as TurnEndEvent) as never;
  });

  pi.registerMessageRenderer(CORRECTION_CUSTOM_TYPE, (message, _options, theme) => {
    const details = (message.details ?? {}) as { ruleName?: unknown };
    const label =
      typeof details.ruleName === "string" && details.ruleName
        ? `[rule:${details.ruleName}]`
        : "[rule]";
    const body = typeof message.content === "string" ? message.content : "";
    // Literal component: no @earendil-works/pi-tui value import needed.
    return {
      render: (width: number) => [`${theme.fg("dim", label)} ${theme.fg("muted", body)}`.slice(0, width)],
      invalidate: () => {},
    } as never;
  });
  void CORRECTION_KIND;

  pi.registerCommand("stream-rules", {
    description: "List, reload, test, or toggle stream-rules corrections",
    handler: async (args, ctx: ExtensionContext) => {
      const [sub, ...rest] = (args || "").trim().split(/\s+/).filter(Boolean);
      const notify = (msg: string, type: "info" | "warning" | "error" = "info"): void => {
        if (ctx.mode === "tui" || ctx.hasUI) ctx.ui.notify(msg, type);
        else console.log(msg);
      };
      switch (sub ?? "list") {
        case "list": {
          if (state.rules.length === 0 && state.errors.length === 0) {
            notify("[stream-rules] 0 rules (empty set: handler passes through untouched)");
            break;
          }
          const rows = state.rules.map(
            (r) => `- ${r.name} ${r.enabled ? "" : "(disabled) "}/.../${r.regex.length > 60 ? r.regex.slice(0, 60) + "..." : r.regex} max=${r.maxCorrections}`,
          );
          const errs = state.errors.map((e) => `! ${e.src}:${e.lineNo}: ${e.error}`);
          notify(`[stream-rules] ${state.enabled ? "on" : "off"}\n${[...rows, ...errs].join("\n") || "(none)"}`);
          break;
        }
        case "reload": {
          reload();
          notify(`[stream-rules] reloaded: ${state.rules.length} rules, ${state.errors.length} errors`);
          break;
        }
        case "test": {
          const text = rest.join(" ");
          if (!text) {
            notify("[stream-rules] usage: /stream-rules test <text>", "warning");
            break;
          }
          const matches = matchRules(state.rules, text, new Set());
          notify(
            matches.length === 0
              ? "[stream-rules] no rule matched"
              : `[stream-rules] matched:\n${matches.map((m) => `- ${m.rule.name}: ${m.excerpt}`).join("\n")}`,
          );
          break;
        }
        case "on":
          state.enabled = true;
          notify("[stream-rules] on");
          break;
        case "off":
          state.enabled = false;
          notify("[stream-rules] off (session untouched from here on)");
          break;
        default:
          notify("[stream-rules] usage: /stream-rules list|reload|test <text>|on|off", "warning");
      }
    },
  });
}
