/**
 * codegraph-gate — hard edit-gate: no edit/write until codegraph_explore
 * has run once this session (or a healthy index exists).
 *
 * - Passes when: codegraph_explore called once this session, OR
 *   `<root>/.codegraph/codegraph.db` exists (pi-codegraph-auto-init
 *   healthy index). Lanes inherit the gate via loadToolsImplicitly default.
 * - Root resolution: git toplevel when inside a repo, else session cwd.
 *   Non-git substantial dirs (>20 files AND depth>=2) hard-block like repos.
 * - Fails OPEN (allow + loud notify) on: tiny/ineligible dirs, blocklisted
 *   absolute roots (/, $HOME, /tmp, /etc, /usr), unrecovered init
 *   failure / indexer unavailable, gate errors. Never silently wedges.
 * - Escape: PI_NO_CODEGRAPH_GATE=1 disables the gate entirely.
 * - Plans must cite codegraph evidence before proposing edits (AGENTS.md).
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

const OPT_OUT = "PI_NO_CODEGRAPH_GATE";

export type RootKind = "git" | "plain";

interface State {
  explored: boolean;
  notifiedOpen: boolean;
}

function fresh(): State {
  return { explored: false, notifiedOpen: false };
}

export function isBlockedRoot(abs: string): boolean {
  const p = resolve(abs);
  if (p === sep) return true;
  const home = resolve(homedir());
  if (p === home) return true;
  if (p === "/tmp" || p.startsWith("/tmp/")) return true;
  if (p === "/etc" || p.startsWith("/etc/")) return true;
  if (p === "/usr" || p.startsWith("/usr/")) return true;
  return false;
}

export function resolveRoot(cwd: string): { kind: RootKind; root: string } {
  try {
    const out = execSync("git rev-parse --show-toplevel", {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000,
    })
      .toString()
      .trim();
    if (out) return { kind: "git", root: out };
  } catch {
    // not a git repo — fall through to plain root
  }
  return { kind: "plain", root: resolve(cwd) };
}

/** Substantial dir: >20 files AND max depth>=2 (root/a/file). Capped walk. */
export function isEligible(root: string): boolean {
  try {
    if (isBlockedRoot(root)) return false;
    let files = 0;
    let maxDepth = 0;
    let visited = 0;
    const MAX_VISIT = 2000;
    const stack: string[] = [resolve(root)];
    while (stack.length > 0) {
      if (++visited > MAX_VISIT) return files > 20;
      const dir = stack.pop()!;
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return false; // EACCES etc -> ineligible (fail open upstream)
      }
      for (const name of entries) {
        if (name === ".git" || name === ".codegraph") continue;
        const full = join(dir, name);
        let st;
        try {
          st = statSync(full);
        } catch {
          return false;
        }
        if (st.isDirectory()) {
          stack.push(full);
        } else if (st.isFile()) {
          files++;
          const rel = relative(resolve(root), full);
          const depth = rel.split(sep).length;
          if (depth > maxDepth) maxDepth = depth;
          if (files > 20 && maxDepth >= 2) return true;
        }
      }
    }
    return files > 20 && maxDepth >= 2;
  } catch {
    return false;
  }
}

function hasHealthyIndex(root: string): boolean {
  try {
    return existsSync(join(root, ".codegraph", "codegraph.db"));
  } catch {
    return false;
  }
}

export function lockPathFor(root: string, kind: RootKind, gitDir?: string): string {
  if (kind === "git" && gitDir) return join(gitDir, "pi-codegraph-init.lock");
  if (kind === "git") {
    try {
      const out = execSync("git rev-parse --absolute-git-dir", {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10000,
      })
        .toString()
        .trim();
      if (out) return join(out, "pi-codegraph-init.lock");
    } catch {
      // fall through to plain-style lock
    }
  }
  return join(root, ".codegraph", "init.lock");
}

function lockPresent(root: string, kind: RootKind): boolean {
  try {
    return existsSync(lockPathFor(root, kind));
  } catch {
    return false;
  }
}

function loud(ctx: ExtensionContext | undefined, msg: string): void {
  try {
    ctx?.ui?.notify?.(msg, "warning");
  } catch {
    // notify is best-effort; the block reason itself carries the message
  }
  console.warn(msg);
}

export default function codegraphGate(pi: ExtensionAPI): void {
  let state = fresh();
  const sessionCwd = (): string => resolve(".");
  // NOTE: cwd resolved lazily so tests can chdir into fixtures.

  pi.on("session_start", () => {
    state = fresh();
  });
  pi.on("session_shutdown", () => {
    state = fresh();
  });

  pi.on("tool_call", (event, ctx) => {
    if (event.toolName === "codegraph_explore") {
      state.explored = true;
      return;
    }
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    if (process.env[OPT_OUT] === "1") return;

    // Gate already satisfied.
    if (state.explored) return;
    const { kind, root } = resolveRoot(sessionCwd());
    if (hasHealthyIndex(root)) {
      state.explored = true;
      return;
    }

    // Fail open with a loud structured error — never silently wedge.
    const input = event.input as Record<string, unknown>;
    const target = typeof input.path === "string" ? input.path : "(unknown path)";
    if (isBlockedRoot(root)) {
      loud(
        ctx as ExtensionContext,
        `[codegraph-gate] FAIL OPEN: blocklisted root ${root}, edit/write allowed without codegraph: ${target}. ` +
          `Bypass recorded. Set ${OPT_OUT}=1 to silence.`,
      );
      return;
    }
    if (kind === "plain" && !isEligible(root)) {
      loud(
        ctx as ExtensionContext,
        `[codegraph-gate] FAIL OPEN: tiny/ineligible directory ${root} (needs >20 files, depth>=2), ` +
          `edit/write allowed without codegraph: ${target}. ` +
          `Bypass recorded. Set ${OPT_OUT}=1 to silence.`,
      );
      return;
    }
    if (lockPresent(root, kind)) {
      loud(
        ctx as ExtensionContext,
        `[codegraph-gate] FAIL OPEN: unrecovered init lock at ${lockPathFor(root, kind)} in ${root} ` +
          `(run: codegraph index from ${kind === "git" ? "the worktree root, then rmdir the lock" : `${root}, then rmdir ${lockPathFor(root, kind)}`}, then /reload). ` +
          `Allowing edit/write: ${target}.`,
      );
      return;
    }
    let indexerMissing = false;
    try {
      execSync("codegraph --version", { stdio: ["ignore", "pipe", "pipe"], timeout: 10000 });
    } catch {
      indexerMissing = true;
    }
    if (indexerMissing) {
      loud(
        ctx as ExtensionContext,
        `[codegraph-gate] FAIL OPEN: codegraph indexer unavailable (codegraph --version failed). ` +
          `Install: npm install -g @colbymchenry/codegraph. Allowing edit/write: ${target}.`,
      );
      return;
    }

    // Hard block: no exploration, no index, indexer present.
    const where = kind === "git" ? `git repo ${root}` : `directory ${root}`;
    return {
      block: true,
      reason:
        `[codegraph-gate] BLOCKED edit/write in ${where}: ` +
        `codegraph_explore has not run this session and no healthy .codegraph index exists. ` +
        `Run codegraph_explore first and cite its evidence in the plan. ` +
        `Target: ${target}. Escape: ${OPT_OUT}=1.`,
    };
  });

  pi.registerCommand("codegraph-gate-status", {
    description: "Show codegraph-gate state (explored this session or not)",
    handler: async (_args, ctx) => {
      const { kind, root } = resolveRoot(sessionCwd());
      ctx.ui.notify(
        `[codegraph-gate]\nexplored: ${state.explored}\nkind: ${kind}\nroot: ${root}\n` +
          `eligible: ${kind === "git" ? "n/a (git)" : String(isEligible(root))}\n` +
          `index: ${hasHealthyIndex(root) ? "healthy" : "absent"}\n` +
          `opt-out: ${process.env[OPT_OUT] === "1" ? "ON" : "off"}`,
        "info",
      );
    },
  });
}
