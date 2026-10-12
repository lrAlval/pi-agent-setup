/**
 * spine-enforcer: lazy stack-aware context injection + staleness nudges.
 * Pattern follows xias-enforcer: nudge + refuse-to-settle, at most once per
 * check per session, never loops. Judgment rules live in AGENTS.md; only
 * deterministic checks live here.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

const GLOBAL_OPINIONS = join(homedir(), ".pi", "agent", "OPINIONS.md");
const BUDGET = 2000;

interface State { injected: boolean; warnedVision: boolean; nudgedStale: boolean; }
function fresh(): State { return { injected: false, warnedVision: false, nudgedStale: false }; }
function safeRead(p: string, cap = BUDGET): string {
  try { return readFileSync(p, "utf8").slice(0, cap); } catch { return ""; }
}
function mtime(p: string): number {
  try { return statSync(p).mtimeMs; } catch { return 0; }
}
function detectStack(cwd: string, techStack: string): string {
  const hay = techStack.toLowerCase();
  const has = (f: string) => existsSync(join(cwd, f));
  if (has("Directory.Build.props") || /dotnet|\.csproj/.test(hay)) return "dotnet";
  if (has("package.json") || /node|typescript/.test(hay)) return "node";
  if (has("pyproject.toml") || has("requirements.txt") || /python|fastapi|django/.test(hay)) return "python";
  if (has("go.mod")) return "go";
  if (has("Cargo.toml")) return "rust";
  return "";
}
function section(md: string, name: string): string {
  const m = md.match(new RegExp(`^## ${name}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, "m"));
  return m ? m[1].trim() : "";
}
function summarizeState(yaml: string): string {
  const pick = (k: string) => yaml.match(new RegExp(`^${k}:(.*)$`, "m"))?.[1].trim() ?? "?";
  return `goal=${pick("goal")} current=${pick("current-slice")} blockers=${pick("blockers")}`;
}
function recentCommits(cwd: string): boolean {
  try {
    const out = execSync("git log --oneline -5 -- .", { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return out.length > 0;
  } catch { return false; }
}
function backlogStalled(cwd: string): boolean {
  const dir = join(cwd, "backlog");
  if (!existsSync(dir)) return false;
  let files: string[] = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".md")); } catch { return false; }
  if (!files.length) return false;
  const done = files.filter((f) => /status:\s*done/.test(safeRead(join(dir, f)))).length;
  return done < files.length && recentCommits(cwd);
}

export default function spineEnforcer(pi: ExtensionAPI): void {
  let state = fresh();
  const cwd = resolve(".");
  pi.on("session_start", () => { state = fresh(); });
  pi.on("session_shutdown", () => { state = fresh(); });

  pi.on("before_agent_start", (event, _ctx: ExtensionContext) => {
    void _ctx;
    if (state.injected) return;
    state.injected = true;
    const tech = safeRead(join(cwd, "specs", "tech-stack.md"));
    const stack = detectStack(cwd, tech);
    const parts: string[] = [];
    if (stack) {
      const g = section(safeRead(GLOBAL_OPINIONS), stack);
      const proj = safeRead(join(cwd, "OPINIONS.md"), 700);
      const combo = `${g}\nOverride: ${proj}`.slice(0, 700);
      if (g || proj) parts.push(`[spine] stack=${stack} conventions: ${combo}`);
    }
    const vision = safeRead(join(cwd, "VISION.md"), 600);
    if (vision) parts.push(`[spine] vision: ${vision}`);
    else if (!state.warnedVision) {
      state.warnedVision = true;
      parts.push("[spine] VISION.md missing: run /vision once via seed-conventions (warns once per session).");
    }
    const st = safeRead(join(cwd, "specs", "state.yaml"), 500);
    if (st) parts.push(`[spine] state: ${summarizeState(st)}`);
    const total = parts.join("\n").slice(0, BUDGET);
    if (total) event.systemPromptOptions.promptGuidelines.push(total);
  });

  pi.on("agent_before_settle", (event, ctx) => {
    if (state.nudgedStale) return;
    const notes: string[] = [];
    if (backlogStalled(cwd)) notes.push("backlog stalled: commits landed with no slice status movement");
    const st = safeRead(join(cwd, "specs", "state.yaml"), 500);
    if (st && /done:\s*\[.+\]/.test(st) && !existsSync(join(cwd, "specs", "decisions.md")))
      notes.push("decisions.md missing while state.yaml shows progress");
    if (!notes.length) return;
    state.nudgedStale = true;
    const content = `[spine-enforcer] stale spine state (one nudge per session): ${notes.join("; ")}`;
    if (!event.canContinue) { ctx.ui.notify(content, "warning"); return; }
    return { continue: true, entries: [{ type: "custom_message", customType: "spine-stale", content, display: true }] };
  });

  pi.registerCommand("spine-status", {
    description: "Show spine-enforcer injection and staleness state",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`[spine-enforcer]\ninjected: ${state.injected}\nvision-warned: ${state.warnedVision}\nstale-nudged: ${state.nudgedStale}\ncwd: ${cwd}`, "info");
    },
  });
}
