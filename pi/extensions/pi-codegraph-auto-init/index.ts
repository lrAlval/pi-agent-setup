/**
 * pi-codegraph-auto-init — companion to @henryqw/pi-codegraph.
 *
 * Closes upstream gap: pi-codegraph only builds a worktree index when the
 * primary checkout already has `.codegraph/codegraph.db`. A repo with no
 * initial index is never initialized (`○ CG` dead end). This companion
 * auto-initializes the PRIMARY checkout in the background on session start.
 *
 * Scope:
 * - Primary checkouts only. Linked worktrees stay with pi-codegraph's
 *   lock-protected flow (root !== primary worktree -> idle).
 * - Non-git substantial dirs (>20 files AND depth>=2, session cwd as root)
 *   are initialized with a file lock at `<root>/.codegraph/init.lock`.
 *   Tiny dirs and blocklisted absolutes (/, $HOME, /tmp, /etc, /usr)
 *   are never initialized (by design).
 * - No nested-monorepo auto-detection; init runs at the repo root.
 * - No post-edit resync; upstream safely omits stale files from explore output.
 * - Same `pi-codegraph-init.lock` protocol as upstream for git repos, so an
 *   interrupted companion init is recoverable with the documented upstream
 *   steps. Never auto-removes a lock it did not create.
 *
 * Opt-out: PI_CODEGRAPH_AUTO_INIT=0 disables this companion entirely.
 * pi-codegraph itself is untouched.
 */

import { mkdir, rmdir, stat, readFile, appendFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const INIT_TIMEOUT_MS = 10 * 60_000;
const STATUS_KEY = "pi-codegraph-auto-init";
const OPT_OUT = "PI_CODEGRAPH_AUTO_INIT";

async function hasIndex(root: string): Promise<boolean> {
	try {
		return (await stat(join(root, ".codegraph", "codegraph.db"))).isFile();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

function isBlockedRoot(abs: string): boolean {
	const p = resolve(abs);
	if (p === sep) return true;
	if (p === resolve(homedir())) return true;
	if (p === "/tmp" || p.startsWith("/tmp/")) return true;
	if (p === "/etc" || p.startsWith("/etc/")) return true;
	if (p === "/usr" || p.startsWith("/usr/")) return true;
	return false;
}

/** Substantial dir: >20 files AND max depth>=2. Capped walk; EACCES -> false. */
async function isEligible(root: string): Promise<boolean> {
	try {
		if (isBlockedRoot(root)) return false;
		const base = resolve(root);
		let files = 0;
		let maxDepth = 0;
		let visited = 0;
		const stack: string[] = [base];
		while (stack.length > 0) {
			if (++visited > 2000) return files > 20;
			const dir = stack.pop()!;
			let entries;
			try {
				entries = await readdir(dir, { withFileTypes: true });
			} catch {
				return false;
			}
			for (const e of entries) {
				if (e.name === ".git" || e.name === ".codegraph") continue;
				const full = join(dir, e.name);
				if (e.isDirectory()) {
					stack.push(full);
				} else if (e.isFile()) {
					files++;
					const depth = relative(base, full).split(sep).length;
					if (depth > maxDepth) maxDepth = depth;
					if (files > 20 && maxDepth >= 2) return true;
				} else if (e.isSymbolicLink()) {
					try {
						const st = await stat(full);
						if (st.isDirectory()) stack.push(full);
						else if (st.isFile()) {
							files++;
							const depth = relative(base, full).split(sep).length;
							if (depth > maxDepth) maxDepth = depth;
							if (files > 20 && maxDepth >= 2) return true;
						}
					} catch {
						return false;
					}
				}
				// sockets/fifos: ignore
			}
		}
		return files > 20 && maxDepth >= 2;
	} catch {
		return false;
	}
}

async function git(pi: ExtensionAPI, cwd: string, args: string[], signal: AbortSignal): Promise<string> {
	const result = await pi.exec("git", args, { cwd, timeout: 10_000, signal });
	signal.throwIfAborted();
	if (result.code !== 0 || result.killed) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim() || `exit ${result.code}`}`);
	}
	return result.stdout.replace(/\r?\n$/, "");
}

async function ensureLocalExclude(root: string, gitDir: string): Promise<void> {
	const excludeFile = join(gitDir, "info", "exclude");
	let current = "";
	try {
		current = await readFile(excludeFile, "utf-8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const lines = current.split("\n").map((l) => l.trim());
	if (lines.includes(".codegraph/") || lines.includes(".codegraph")) return;
	const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
	await appendFile(excludeFile, `${prefix}.codegraph/\n`, "utf-8");
}

async function autoInitPlain(pi: ExtensionAPI, ctx: ExtensionContext, signal: AbortSignal): Promise<void> {
	const root = resolve(ctx.cwd);
	if (isBlockedRoot(root)) return;
	if (!(await isEligible(root))) return;
	if (await hasIndex(root)) return;
	if (process.env.CODEGRAPH_DIR && process.env.CODEGRAPH_DIR !== ".codegraph") {
		throw new Error("pi-codegraph requires the default CODEGRAPH_DIR (.codegraph). Unset CODEGRAPH_DIR before launching Pi.");
	}

	await mkdir(join(root, ".codegraph"), { recursive: true });
	const lock = join(root, ".codegraph", "init.lock");
	try {
		await mkdir(lock);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		const message =
			`pi-codegraph-auto-init: CodeGraph init lock exists, skipping auto-init (another session may be initializing).\nIf no initializer is running, recover: cd ${root} && codegraph index && rmdir ${lock}\nThen /reload.`;
		if (ctx.hasUI) ctx.ui.notify(message, "warning");
		else console.warn(message);
		return;
	}

	let attempted = false;
	let indexed = false;
	try {
		if (await hasIndex(root)) {
			indexed = true;
			return;
		}
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", `⠋ CG · indexing`));
		attempted = true;
		const result = await pi.exec("codegraph", ["init", "--yes", root], { cwd: root, timeout: INIT_TIMEOUT_MS, signal });
		signal.throwIfAborted();
		if (result.code !== 0 || result.killed || !(await hasIndex(root))) {
			throw new Error(
				`CodeGraph init failed (${result.killed ? "timed out or killed" : `exit ${result.code}`}): ${(result.stderr || result.stdout).trim().slice(-2000)}\nInspect CodeGraph in ${root}. If no initializer is running, run codegraph index in that directory, then remove ${lock} with rmdir and /reload.`,
			);
		}
		indexed = true;
		if (ctx.hasUI) ctx.ui.notify("CodeGraph index ready — codegraph_explore usable", "info");
	} finally {
		// A failed or interrupted init stays locked for explicit recovery.
		if (!attempted || indexed) {
			try {
				await rmdir(lock);
			} catch {
				// Lock already gone; nothing to recover.
			}
		}
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
	}
}

async function autoInitGit(pi: ExtensionAPI, ctx: ExtensionContext, signal: AbortSignal, root: string): Promise<void> {
	// Already indexed -> silent, nothing to do.
	if (await hasIndex(root)) return;

	if (process.env.CODEGRAPH_DIR && process.env.CODEGRAPH_DIR !== ".codegraph") {
		throw new Error("pi-codegraph requires the default CODEGRAPH_DIR (.codegraph). Unset CODEGRAPH_DIR before launching Pi.");
	}
	const gitDir = await git(pi, root, ["rev-parse", "--absolute-git-dir"], signal);
	if (!gitDir) throw new Error("Git returned an empty metadata directory.");
	const lock = join(gitDir, "pi-codegraph-init.lock");

	// Linked worktrees stay with pi-codegraph's flow; companion handles primary only.
	const worktrees = await git(pi, root, ["worktree", "list", "--porcelain", "-z"], signal);
	const first = worktrees.split("\0", 1)[0];
	if (!first.startsWith("worktree ")) throw new Error("Git returned an invalid primary worktree.");
	const primary = first.slice("worktree ".length);
	if (primary !== root) return;

	// Same lock protocol as upstream. Never wait, never hang: on contention
	// warn once with the documented recovery command and move on.
	try {
		await mkdir(lock);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		const message =
			`pi-codegraph-auto-init: CodeGraph init lock exists, skipping auto-init (another session may be initializing).\nIf no initializer is running, recover: cd ${root} && codegraph index && rmdir ${lock}\nThen /reload.`;
		if (ctx.hasUI) ctx.ui.notify(message, "warning");
		else console.warn(message);
		return;
	}

	let attempted = false;
	let indexed = false;
	try {
		// Re-check under lock: upstream may have indexed concurrently.
		if (await hasIndex(root)) {
			indexed = true;
			return;
		}
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", `⠋ CG · indexing`));
		attempted = true;
		const result = await pi.exec("codegraph", ["init", "--yes", root], { cwd: root, timeout: INIT_TIMEOUT_MS, signal });
		signal.throwIfAborted();
		if (result.code !== 0 || result.killed || !(await hasIndex(root))) {
			throw new Error(
				`CodeGraph init failed (${result.killed ? "timed out or killed" : `exit ${result.code}`}): ${(result.stderr || result.stdout).trim().slice(-2000)}\nInspect CodeGraph in ${root}. If no initializer is running, run codegraph index in that directory, then remove ${lock} with rmdir and /reload.`,
			);
		}
		indexed = true;
		await ensureLocalExclude(root, gitDir);
		if (ctx.hasUI) ctx.ui.notify("CodeGraph index ready — codegraph_explore usable", "info");
	} finally {
		// A failed or interrupted init stays locked for explicit recovery (same as upstream).
		if (!attempted || indexed) {
			try {
				await rmdir(lock);
			} catch {
				// Lock already gone; nothing to recover.
			}
		}
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
	}
}

async function autoInit(pi: ExtensionAPI, ctx: ExtensionContext, signal: AbortSignal): Promise<void> {
	if (process.env[OPT_OUT] === "0") return;

	// Prerequisite retry (upstream gap: PATH failure skips setup until restart).
	const version = await pi.exec("codegraph", ["--version"], { cwd: ctx.cwd, timeout: 10_000, signal });
	signal.throwIfAborted();
	if (version.code !== 0 || version.killed) {
		const message =
			`pi-codegraph-auto-init: setup skipped.\ncodegraph --version failed. Install CodeGraph: npm install -g @colbymchenry/codegraph. If already installed, check that codegraph runs on Pi's PATH.\nThen restart Pi or /reload.`;
		if (ctx.hasUI) ctx.ui.notify(message, "warning");
		else console.warn(message);
		return;
	}

	const rootResult = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd: ctx.cwd, timeout: 10_000, signal });
	signal.throwIfAborted();
	if (rootResult.code !== 0 || rootResult.killed) {
		if (!rootResult.killed && rootResult.stderr.includes("not a git repository")) {
			return autoInitPlain(pi, ctx, signal);
		}
		throw new Error(`Cannot locate Git worktree: ${rootResult.stderr.trim() || `exit ${rootResult.code}`}`);
	}
	const root = rootResult.stdout.replace(/\r?\n$/, "");
	if (!root) throw new Error("Git returned an empty worktree root.");
	return autoInitGit(pi, ctx, signal, root);
}

export default function autoInitExtension(pi: ExtensionAPI): void {
	let initializer: AbortController | undefined;
	let setup: Promise<void> | undefined;
	pi.on("session_shutdown", () => {
		initializer?.abort();
		return setup;
	});
	pi.on("session_start", (_event, ctx) => {
		if (setup) return ctx.mode === "tui" ? undefined : setup;
		const controller = (initializer = new AbortController());
		setup = autoInit(pi, ctx, controller.signal)
			.catch((error) => {
				if (controller.signal.aborted) return;
				const message = `pi-codegraph-auto-init: ${error instanceof Error ? error.message : String(error)}`;
				if (ctx.hasUI) ctx.ui.notify(message, "error");
				else throw new Error(message, { cause: error });
			})
			.finally(() => {
				setup = undefined;
				initializer = undefined;
			});
		// Never blocks session start in TUI; awaited in non-TUI so one-shot runs complete.
		if (ctx.mode !== "tui") return setup;
	});
}
