/**
 * complexity-nudge — deterministic simplification trigger (spine-enforcer pattern).
 *
 * After implementation turns, computes metrics over changed files:
 *   - total ΔLOC (added + deleted) > deltaLoc (default 600), OR
 *   - per-file cyclomatic estimate > perFileCyclomatic (default 15), OR
 *   - per-file new LOC > perFileNewLoc (default 400).
 * Above threshold -> at-most-maxNudges (default 2) nudge per session
 * recommending the `simplify-review` skill. Never loops, never blocks.
 * Non-git dirs and git failures stay silent. pi-dcp stays primary pruning;
 * caveman/ponytail own YAGNI + terse prose (unchanged).
 *
 * Escape: PI_NO_COMPLEXITY_NUDGE=1. Thresholds live in ./config.json.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const OPT_OUT = "PI_NO_COMPLEXITY_NUDGE";

interface Thresholds {
  deltaLoc: number;
  perFileCyclomatic: number;
  perFileNewLoc: number;
  maxNudges: number;
}

const DEFAULTS: Thresholds = { deltaLoc: 600, perFileCyclomatic: 15, perFileNewLoc: 400, maxNudges: 2 };

function loadThresholds(): Thresholds {
  try {
    const raw = JSON.parse(
      readFileSync(join(homedir(), ".pi", "agent", "extensions", "complexity-nudge", "config.json"), "utf8"),
    ) as Partial<Thresholds>;
    return {
      deltaLoc: typeof raw.deltaLoc === "number" ? raw.deltaLoc : DEFAULTS.deltaLoc,
      perFileCyclomatic: typeof raw.perFileCyclomatic === "number" ? raw.perFileCyclomatic : DEFAULTS.perFileCyclomatic,
      perFileNewLoc: typeof raw.perFileNewLoc === "number" ? raw.perFileNewLoc : DEFAULTS.perFileNewLoc,
      maxNudges: typeof raw.maxNudges === "number" ? raw.maxNudges : DEFAULTS.maxNudges,
    };
  } catch {
    return DEFAULTS;
  }
}

/** added+deleted per file from numstat output. Binary files show "-\t-". */
function numstat(cwd: string, args: string[]): Map<string, { added: number; deleted: number }> {
  const out = execSync(`git ${args.join(" ")}`, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15000,
    maxBuffer: 8 * 1024 * 1024,
  })
    .toString()
    .trim();
  const m = new Map<string, { added: number; deleted: number }>();
  if (!out) return m;
  for (const line of out.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [a, d, f] = parts;
    if (a === "-" || d === "-") continue;
    const added = Number(a);
    const deleted = Number(d);
    if (!Number.isFinite(added) || !Number.isFinite(deleted)) continue;
    const prev = m.get(f) ?? { added: 0, deleted: 0 };
    m.set(f, { added: prev.added + added, deleted: prev.deleted + deleted });
  }
  return m;
}

function changedFiles(cwd: string): Map<string, { added: number; deleted: number }> {
  try {
    const merged = numstat(cwd, ["diff", "--numstat", "HEAD"]);
    if (merged.size) return merged;
    // No HEAD (fresh repo) or empty: fall back to staged + unstaged + untracked.
    const staged = numstat(cwd, ["diff", "--cached", "--numstat"]);
    const unstaged = numstat(cwd, ["diff", "--numstat"]);
    for (const [f, v] of unstaged) {
      const prev = staged.get(f) ?? { added: 0, deleted: 0 };
      staged.set(f, { added: prev.added + v.added, deleted: prev.deleted + v.deleted });
    }
    return staged;
  } catch {
    return new Map();
  }
}

/** Bundled cyclomatic estimate, no new deps: branch keywords + boolean ops + ternary. */
export function estimateCyclomatic(source: string): number {
  const hits = source.match(/\b(if|for|while|case|catch)\b|&&|\|\||\?/g);
  return 1 + (hits ? hits.length : 0);
}

function tripped(
  cwd: string,
  files: Map<string, { added: number; deleted: number }>,
  t: Thresholds,
): string[] {
  let delta = 0;
  for (const v of files.values()) delta += v.added + v.deleted;
  const reasons: string[] = [];
  if (delta > t.deltaLoc) reasons.push(`ΔLOC ${delta} > ${t.deltaLoc}`);
  for (const [f, v] of files) {
    if (v.added > t.perFileNewLoc) {
      reasons.push(`${f}: +${v.added} new LOC > ${t.perFileNewLoc}`);
      continue;
    }
    const abs = resolve(cwd, f);
    if (!existsSync(abs)) continue;
    let src = "";
    try {
      src = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (src.length > 1024 * 1024) continue;
    const c = estimateCyclomatic(src);
    if (c > t.perFileCyclomatic) reasons.push(`${f}: cyclomatic ~${c} > ${t.perFileCyclomatic}`);
  }
  return reasons;
}

export default function complexityNudge(pi: ExtensionAPI): void {
  let nudges = 0;
  const cwd = resolve(".");

  pi.on("session_start", () => {
    nudges = 0;
  });
  pi.on("session_shutdown", () => {
    nudges = 0;
  });

  pi.on("agent_before_settle", (event, ctx: ExtensionContext) => {
    if (process.env[OPT_OUT] === "1") return;
    const t = loadThresholds();
    if (nudges >= t.maxNudges) return;
    let reasons: string[] = [];
    try {
      const files = changedFiles(cwd);
      if (!files.size) return; // silent on non-git / no changes
      reasons = tripped(cwd, files, t);
    } catch {
      return; // git failure: silent
    }
    if (!reasons.length) return;
    nudges++;
    const content =
      `[complexity-nudge ${nudges}/${t.maxNudges}] complexity threshold tripped (${reasons.slice(0, 4).join("; ")}) ` +
      `-> run the \`simplify-review\` skill (ponytail simplification pass); fix findings or dismiss with reason.`;
    if (!event.canContinue) {
      ctx.ui.notify?.(content, "warning");
      return;
    }
    return {
      continue: true,
      entries: [{ type: "custom_message", customType: "complexity-nudge", content, display: true }],
    };
  });

  pi.registerCommand("complexity-nudge-status", {
    description: "Show complexity-nudge thresholds and nudges used this session",
    handler: async (_args, ctx) => {
      const t = loadThresholds();
      ctx.ui.notify(
        `[complexity-nudge]\nudges: ${nudges}/${t.maxNudges}\nΔLOC>${t.deltaLoc} cyclomatic>${t.perFileCyclomatic} file-new-LOC>${t.perFileNewLoc}\nopt-out: ${process.env[OPT_OUT] === "1" ? "ON" : "off"}`,
        "info",
      );
    },
  });
}
