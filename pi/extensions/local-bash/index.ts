/**
 * local-bash — plan-mode-friendly shell tool with a destructive-command denylist.
 *
 * Unlike pi-plan-mode's built-in bash policy (a read-only whitelist that also
 * rejects shell syntax such as for-loops, $() and pipes), this tool allows
 * arbitrary shell composition and blocks only commands that destroy, mutate
 * outside stdout, escalate privilege, or execute remote code.
 *
 * Loops, $(...), backticks, pipes, && / || / ; chains are all FINE.
 * rm/mv/cp, redirects to files, sudo, git push, gh create, npm install are BLOCKED.
 *
 * The denylist is data + user-extensible via `local-bash.json`
 * (`extraBlocked` regexes, `allowedPrefixes` escape hatches). Fail-closed:
 * anything unscannable or matching is rejected with a reason.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { Type } from "typebox";

export const LOCAL_BASH_TOOL_NAME = "local_bash";
export const CONFIG_FILE_NAME = "local-bash.json";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface LocalBashConfig {
	/** Extra blocked patterns (regex strings, case-sensitive) on top of the built-in denylist. */
	extraBlocked?: string[];
	/** Exact command prefixes that bypass the denylist. Use sparingly. */
	allowedPrefixes?: string[];
	/** Kill the command after this many ms. Default 60000. */
	timeoutMs?: number;
	/** Truncate captured output to this many bytes. Default 51200. */
	maxOutputBytes?: number;
	reviewScratch?: boolean;
	sandboxAllowFallback?: boolean;
	sandbox?: {
		allowNetwork?: boolean;
	};
}

export interface ResolvedLocalBashConfig {
	extraBlocked: RegExp[];
	allowedPrefixes: string[];
	timeoutMs: number;
	maxOutputBytes: number;
	reviewScratch: boolean;
	sandboxAllowFallback: boolean;
	sandboxAllowNetwork: boolean;
}

function agentDir(): string {
	const env = process.env.PI_CODING_AGENT_DIR?.trim();
	if (env) return env;
	return join(homedir(), ".pi", "agent");
}

function readJsonFile(path: string): Record<string, unknown> {
	if (!existsSync(path)) return {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return parsed as Record<string, unknown>;
	} catch (err) {
		console.warn(`local-bash: invalid JSON at ${path}, ignoring — ${(err as Error).message}`);
		return {};
	}
}

export function loadLocalBashConfig(): ResolvedLocalBashConfig {
	const legacy = readJsonFile(join(homedir(), ".config", "local-bash", "config.json"));
	const primary = readJsonFile(join(agentDir(), CONFIG_FILE_NAME));
	const raw = { ...legacy, ...primary };
	const extraBlocked: RegExp[] = [];
	if (raw.extraBlocked !== undefined) {
		if (Array.isArray(raw.extraBlocked) && raw.extraBlocked.every((s) => typeof s === "string")) {
			for (const src of raw.extraBlocked as string[]) {
				try {
					extraBlocked.push(new RegExp(src));
				} catch {
					console.warn(`local-bash: ignoring invalid regex in extraBlocked: ${JSON.stringify(src)}`);
				}
			}
		} else {
			console.warn(`local-bash: config field "extraBlocked" must be string[] — ignoring`);
		}
	}
	let allowedPrefixes: string[] = [];
	if (raw.allowedPrefixes !== undefined) {
		if (Array.isArray(raw.allowedPrefixes) && raw.allowedPrefixes.every((s) => typeof s === "string")) {
			allowedPrefixes = raw.allowedPrefixes as string[];
		} else {
			console.warn(`local-bash: config field "allowedPrefixes" must be string[] — ignoring`);
		}
	}
	const timeoutMs =
		typeof raw.timeoutMs === "number" && Number.isInteger(raw.timeoutMs) && raw.timeoutMs >= 1000
			? raw.timeoutMs
			: 60000;
	const maxOutputBytes =
		typeof raw.maxOutputBytes === "number" &&
		Number.isInteger(raw.maxOutputBytes) &&
		raw.maxOutputBytes >= 1024
			? raw.maxOutputBytes
			: 51200;
	const reviewScratch = raw.reviewScratch === true;
	const sandboxAllowFallback = raw.sandboxAllowFallback === true;
	let sandboxAllowNetwork = true;
	if (raw.sandbox !== undefined) {
		if (raw.sandbox !== null && typeof raw.sandbox === "object" && !Array.isArray(raw.sandbox)) {
			const opts = raw.sandbox as Record<string, unknown>;
			if (opts.allowNetwork !== undefined) {
				if (typeof opts.allowNetwork === "boolean") sandboxAllowNetwork = opts.allowNetwork;
				else console.warn("local-bash: config field sandbox.allowNetwork must be boolean - ignoring");
			}
		} else {
			console.warn("local-bash: config field sandbox must be an object - ignoring");
		}
	}
	return { extraBlocked, allowedPrefixes, timeoutMs, maxOutputBytes, reviewScratch, sandboxAllowFallback, sandboxAllowNetwork };
}

// ---------------------------------------------------------------------------
// Quote-aware code extraction
// ---------------------------------------------------------------------------

/**
 * Return the command with quoted literal spans blanked to spaces, so denylist
 * patterns don't false-positive on prose (e.g. `grep "rm -rf" file`, `echo "a > b"`).
 * `$(...)` and backtick spans stay as code (they execute), everywhere — even
 * inside double quotes. `eval`/`source`/dot-sourcing are blocked as tokens
 * because they execute quoted content.
 */
function takeBalancedParens(cmd: string, openIdx: number): { inner: string; end: number; closed: boolean } {
	let depth = 0;
	let i = openIdx;
	const n = cmd.length;
	while (i < n) {
		const c = cmd[i];
		if (c === "'" && cmd[i - 1] !== "$") {
			const j = cmd.indexOf("'", i + 1);
			i = j === -1 ? n : j + 1;
			continue;
		}
		if (c === '"') {
			i++;
			while (i < n && cmd[i] !== '"') i += cmd[i] === "\\" ? 2 : 1;
			i++;
			continue;
		}
		if (c === "\\") {
			i += 2;
			continue;
		}
		if (c === "(") depth++;
		else if (c === ")") {
			depth--;
			if (depth === 0) return { inner: cmd.slice(openIdx + 1, i), end: i + 1, closed: true };
		}
		i++;
	}
	return { inner: cmd.slice(openIdx + 1), end: n, closed: false };
}

export function codeOnly(cmd: string): string {
	let out = "";
	let i = 0;
	const n = cmd.length;
	while (i < n) {
		const c = cmd[i];
		if (c === "'" && (i === 0 || /[\s;&|()$`<>]/.test(cmd[i - 1] ?? "") || cmd[i - 1] === "=")) {
			// Single-quoted literal (incl. $'...'): blank it. A bare ' mid-word
			// (e.g. don't) is left alone.
			const j = cmd.indexOf("'", i + 1);
			const end = j === -1 ? n : j + 1;
			out += " ".repeat(end - i);
			i = end;
		} else if (c === '"') {
			out += " ";
			i++;
			while (i < n && cmd[i] !== '"') {
				if (cmd[i] === "\\") {
					out += "  ";
					i += 2;
				} else if (cmd[i] === "$" && cmd[i + 1] === "(") {
					const { inner, end } = takeBalancedParens(cmd, i + 1);
					out += "$(" + codeOnly(inner) + ")";
					i = end;
				} else if (cmd[i] === "`") {
					const j = cmd.indexOf("`", i + 1);
					const inner = j === -1 ? cmd.slice(i + 1) : cmd.slice(i + 1, j);
					out += "`" + codeOnly(inner) + "`";
					i = j === -1 ? n : j + 1;
				} else {
					out += " ";
					i++;
				}
			}
			out += " ";
			if (i < n) i++;
		} else if (c === "`") {
			const j = cmd.indexOf("`", i + 1);
			const inner = j === -1 ? cmd.slice(i + 1) : cmd.slice(i + 1, j);
			out += "`" + codeOnly(inner) + "`";
			i = j === -1 ? n : j + 1;
		} else if (c === "$" && cmd[i + 1] === "(") {
			if (cmd[i + 2] === "(") {
				// Arithmetic $(( ... )) cannot execute commands — blank it so
				// `>` / `>>` / `<<` comparisons don't trip the redirect rule.
				const { end } = takeBalancedParens(cmd, i + 1);
				out += " ".repeat(end - i);
				i = end;
			} else {
				const { inner, end } = takeBalancedParens(cmd, i + 1);
				out += "$(" + codeOnly(inner) + ")";
				i = end;
			}
		} else if (c === "(" && cmd[i + 1] === "(") {
			// Arithmetic `(( ... ))` cannot execute commands — blank it so `>`
			// comparisons don't trip the redirect rule. Unbalanced (fail-closed):
			// leave the text in place so nothing is hidden from the scan.
			const { end, closed } = takeBalancedParens(cmd, i);
			if (closed) {
				out += " ".repeat(end - i);
				i = end;
			} else {
				out += c;			i++;
			}
		} else {
			out += c;
			i++;
		}
	}
	return out;
}
// ---------------------------------------------------------------------------
// Denylist
// ---------------------------------------------------------------------------

interface BlockRule {
	pattern: RegExp;
	reason: string;
}

/** Command-position token: start, or after a separator/quote/backtick/$ — so `my-rm` and `warm` don't match. */
const T = String.raw`(?:^|[;&|()\s"'\`$=])`;

// Reason strings shared between BLOCKED entries and the scratch-relief check.
const MKDIR_REASON = "filesystem mutation (mv/cp/ln/tee/mkdir)";
const TOUCH_REASON = "filesystem mutation (install/touch/patch command)";
const REDIRECT_REASON = "file redirect / heredoc (writes files or feeds code to commands)";

const BLOCKED: BlockRule[] = [
	{ pattern: new RegExp(`${T}(sudo|doas|su|runas)\\b`), reason: "privilege escalation" },
	{ pattern: new RegExp(`${T}(rm|rmdir|shred|unlink)\\b`), reason: "file deletion" },	{ pattern: new RegExp(`${T}dd\\b`), reason: "raw disk write (dd)" },
	{ pattern: new RegExp(`${T}mkfs(\\.\\w+)?\\b`), reason: "filesystem creation (mkfs)" },
	{ pattern: new RegExp(`${T}(truncate|mkfifo)\\b`), reason: "destructive file operation" },

	{
		pattern: new RegExp(`${T}(mv|cp|ln|tee|mkdir)\\b`),
		reason: MKDIR_REASON,
	},
	{
		// `install`, `touch`, `patch` are also ordinary English words — match
		// them only as the segment's command so prose doesn't false-positive.
		pattern: /(^|[;&|()\n])\s*(install|touch|patch)\b/,
		reason: TOUCH_REASON,
	},
	{
		// `at` is an English word — match only as the segment's command.
		// `crontab -l` (list) is allowed; every other crontab form mutates.
		pattern: /(^|[;&|()\n])\s*(at|batch)\b|\bcrontab\b(?!\s+-l\b)/,
		reason: "job scheduling (persistent side effect)",
	},
	{ pattern: new RegExp(`${T}(chmod|chown|chgrp|setfacl)\\b`), reason: "permission/ownership change" },
	{ pattern: new RegExp(`${T}(kill|killall|pkill)\\b`), reason: "process kill" },
	{
		pattern: new RegExp(`${T}(reboot|shutdown|halt|poweroff)\\b`),
		reason: "machine power control",
	},
	{ pattern: new RegExp(`${T}(ssh|scp|sftp|rsync|ftp|telnet)\\b`), reason: "remote execution / network copy" },
	{ pattern: /\|\s*(sh|bash|zsh|fish|dash|ksh)\b/, reason: "piping into a shell" },
	{
		pattern: /["']?\$\(\s*(curl|wget)\b/,
		reason: "command substitution fetching remote code — download first, inspect, then run",
	},
	{
		// File redirects: `>f`, `>>f`, `> f` — but NOT fd dups (`2>&1`, `>&2`)
		// and NOT /dev/null sinks. Heredocs/herestrings (`<<`, `<<<`) feed code
		// to commands, so they are blocked too.
		pattern: />{1,2}(?!\s*(?:&\d|&-|>|\/dev\/null\b))|<{1,2}<(?!<)/,
		reason: REDIRECT_REASON,
	},
	{
		pattern: /\bsed\b[^|;&]*\s-i\b/,
		reason: "in-place file edit (sed -i)",
	},
	{
		pattern: /\bfind\b[\s\S]*?\s-(delete|exec(dir)?|ok|fls|fprint)\b/,
		reason: "find with executing/writing action (-delete/-exec/...)",
	},
	{
		pattern: /\bxargs\b[\s\S]*?\b(sh|bash|zsh|fish)\b/,
		reason: "xargs shell execution",
	},
	{
		pattern: new RegExp(`${T}(eval|source)\\b`),
		reason: "dynamic sourcing (eval/source) executes quoted content",
	},
	{
		pattern: /\b(PATH|LD_PRELOAD|LD_LIBRARY_PATH|PYTHONPATH|NODE_PATH|PERL5LIB|RUBYLIB)\s*=/,
		reason: "loader/search-path override (binary hijack risk)",
	},

	{
		pattern: new RegExp(`${T}(mount|umount|iptables|nft|firewall-cmd|ufw)\\b`),
		reason: "system/network configuration change",
	},
	{
		pattern: /\breg\s+(add|delete|copy|save|restore|load|unload)\b|\bdefaults\s+(write|delete)\b/,
		reason: "registry/defaults mutation",
	},
];

// git: allowlist of read-only subcommands (bare `git stash` pushes — blocked).
const GIT_READ: Record<string, RegExp | null> = {
	status: null,
	log: null,
	diff: null,
	show: null,
	"ls-files": null,
	grep: null,
	"rev-parse": null,
	blame: null,
	describe: null,
	"merge-base": null,
	"ls-tree": null,
	"cat-file": null,
	fetch: null,
	"ls-remote": null,
	"count-objects": null,
	fsck: null,
	"verify-pack": null,
	var: null,
	version: null,
	help: null,
	shortlog: null,
	remote: /^$|^(-v|--verbose)$|^show\b|^get-url\b/,
	branch: /^$|^(-a|--all|-r|--remotes|--list|-v|--verbose|--show-current)$/,
	tag: /^$|^(-l|--list|-n)$/,
	stash: /^(list|show\b.*)$/,
	worktree: /^(list)$/,
	config: /^$|^--get\b|^--get-regexp\b|^(-l|--list)$|^--show-origin\b/,
};

// gh: allowlist. `gh api` allowed only for GET (default or explicit).
const GH_READ: Record<string, RegExp | null> = {
	"issue|pr": /^(view|list)$/,
	search: /^.*$/,
	"repo view": null,
	"release view": null,
	"run view|run list": null,
	browse: null,
	status: null,
};

// ---------------------------------------------------------------------------
// Command-position checks (no false positives on argument words)
// ---------------------------------------------------------------------------

// Package managers: matched ONLY as the segment command (or via xargs),
// so which-npm style inspection and prose pass. cargo install and
// go install are two-word forms.
const PACKAGE_MANAGERS: ReadonlySet<string> = new Set([
	'npm', 'npx', 'pnpm', 'yarn', 'bun', 'pip', 'pipx', 'uv', 'poetry',
	'brew', 'apt', 'apt-get', 'dnf', 'yum', 'pacman', 'zypper', 'apk',
	'snap', 'flatpak', 'choco', 'winget', 'scoop',
]);

const PM_REASON =
	'package install / remote execution - inspect-only here; rerun with sandbox:true for installs and self-tests';

// Interpreters for the inline-exec (-c/-e) check, matched at head position.
const INTERPRETERS: ReadonlySet<string> = new Set([
	'python', 'node', 'deno', 'ruby', 'perl', 'php', 'rscript',
]);

// Shells for the script-execution check (bash install.sh runs opaque code).
const SHELLS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh']);

// First token of a segment after env assignments and command/env wrappers.
export function headOf(segment: string): { head: string; rest: string[] } {
	const toks = tokensOf(segment).filter((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
	let i = 0;
	while (i < toks.length && (toks[i]!.toLowerCase() === 'command' || toks[i]!.toLowerCase() === 'env')) i++;
	const raw = toks[i] ?? '';
	const head = raw.replace(/^["']|["']$/g, '').toLowerCase();
	return { head, rest: toks.slice(i + 1) };
}

export function checkCommandPosition(code: string): string | null {
	for (const seg of splitSegments(code)) {
		const seen = headOf(seg);
		const head = seen.head;
		const rest = seen.rest;
		if (!head) continue;
		if (PACKAGE_MANAGERS.has(head)) return PM_REASON;
		if ((head === 'cargo' || head === 'go') && (rest[0] ?? '').toLowerCase() === 'install') return PM_REASON;
		if (head === 'xargs') {
			for (const t of rest) {
				const w = t.replace(/^["']|["']$/g, '').toLowerCase();
				if (!w || w.charAt(0) === '-') continue;
				if (PACKAGE_MANAGERS.has(w)) return PM_REASON;
			}
		}
		// Dot-sourcing only counts as a command: a bare dot elsewhere
		// (e.g. a grep pattern argument) is harmless.
		if (head === '.' && rest.length > 0) return 'dynamic sourcing (. script) executes quoted content';
		const interp = head.replace(/[0-9.]+$/, '');
		if (INTERPRETERS.has(interp)) {
			for (const t of rest) {
				if (t === '--eval' || t === '--execute' || /^-[a-z]*[ce][a-z]*$/.test(t)) {
					return 'inline code execution via interpreter -c/-e flag';
				}
			}
		}
		// sh/bash script.sh runs opaque file content: sandbox lane only.
		// Flag-only invocations (bash --version, bash -c ...) still pass and
		// their inline code keeps getting scanned normally.
		if (SHELLS.has(head)) {
			for (let k = 0; k < rest.length; k++) {
				const t = rest[k]!;
				if (t === '-c' || t === '--command') { k++; continue; }
				if (t === '-' || (t.charAt(0) === '-' && t.length > 1)) continue;
				if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue;
				const target = t.replace(/^["']|["']$/g, '');
				if (target) return 'shell script execution (' + head + ' ' + target + ') runs opaque file content - inspect the script, then rerun with sandbox:true';
			}
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Review-mode /tmp scratch allowance (opt-in via reviewScratch:true)
// ---------------------------------------------------------------------------

// Variables assigned from mktemp (or /tmp literals) earlier in the command.
export function collectScratchVars(cmd: string): Record<string, string> {
	const vars: Record<string, string> = {};
	const tmpRoot = process.env.TMPDIR && process.env.TMPDIR.charAt(0) === '/' ? process.env.TMPDIR : '/tmp';
	const re = /(?:^|[\s;])(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(\$\(mktemp[^)]*\)|"[^"]*"|'[^']*'|[^\s;&|]+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(cmd)) !== null) {
		const name = m[1]!;
		let val: string = m[2]!;
		if (val.length >= 2 && val.charAt(0) === val.charAt(val.length - 1) && (val.charAt(0) === '"' || val.charAt(0) === "'")) {
			val = val.slice(1, -1);
		}
		if (/^\$\(mktemp\b/.test(val)) {
			const inner = val.replace(/^\$\(/, '').replace(/\)$/, '').replace(/^mktemp\b\s*/, '').trim();
			const parts = inner.split(/\s+/).filter((p) => p && p.charAt(0) !== '-');
			let ok = true;
			for (const p of parts) {
				if (expandScratchTarget(p, vars, {}) === null) { ok = false; break; }
			}
			if (ok) vars[name] = tmpRoot + '/.pi-mktemp-dynamic';
		} else if (val.charAt(0) === '/' || val.charAt(0) === '$' || val.charAt(0) === '~') {
			vars[name] = val;
		}
	}
	return vars;
}

export function expandScratchTarget(
	raw: string,
	vars: Record<string, string>,
	envOverride: Record<string, string | undefined>,
): string | null {
	let s = raw.trim().replace(/^['"]|['"]$/g, '');
	const env: Record<string, string | undefined> = {};
	for (const k of Object.keys(process.env)) env[k] = process.env[k];
	for (const k of Object.keys(envOverride)) env[k] = envOverride[k];
	for (const k of Object.keys(vars)) env[k] = vars[k];
	for (let i = 0; i < 5; i++) {
		const next = s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (mm: string, a: string | undefined, b: string | undefined) => {
			const key = (a !== undefined ? a : b) as string;
			const v = env[key];
			return v === undefined ? mm : v;
		});
		if (next === s) break;
		s = next;
	}
	if (s === '~') s = env.HOME !== undefined ? env.HOME : homedir();
	else if (s.length > 1 && s.charAt(0) === '~' && s.charAt(1) === '/') s = (env.HOME !== undefined ? env.HOME : homedir()) + s.slice(1);
	if (s.indexOf('$') !== -1) return null;
	if (/[*?[\]{}]/.test(s)) return null;
	const roots: string[] = ['/tmp'];
	const td = env.TMPDIR;
	if (td !== undefined && td.charAt(0) === '/') roots.push(td);
	const norm = normalize(s);
	for (const r of roots) {
		const rn = normalize(r);
		if (norm === rn || norm.slice(0, rn.length + 1) === rn + '/') return norm;
	}
	return null;
}

// Redirect write targets of one quote-blanked segment (no heredocs here).
export function redirectWrites(codeSeg: string): { targets: string[]; heredoc: boolean } {
	const targets: string[] = [];
	const heredoc = /<<<|<<-?/.test(codeSeg);
	const re = /(>>?|&>>?)\s*(\S+)/g;
	let m: RegExpExecArray | null;	while ((m = re.exec(codeSeg)) !== null) {
		const op: string = m[1]!;
		const target: string = m[2]!;
		if (/^\/dev\/null\b/.test(target)) continue;
		if (target.charAt(0) === '&') {
			// >&N / >&- are fd dups; >&file is a real write (bash >&file == &>file).
			if (/^&(\d+|-)?$/.test(target)) continue;
			if (op === '>' || op === '>>') { targets.push(target.slice(1)); continue; }
			continue;
		}
		if ((op === '&>' || op === '&>>') && /^\d+$/.test(target)) continue;
		targets.push(target);
	}
	return { targets, heredoc };
}

function skipFlagValues(rest: string[], flags: Record<string, boolean>): string[] {
	const out: string[] = [];
	for (let i = 0; i < rest.length; i++) {
		const t = rest[i]!;
		if (flags[t] || /^--mode=/.test(t) || /^--date=/.test(t) || /^--reference=/.test(t)) {
			if (t.indexOf('=') === -1) i++;
			continue;
		}
		out.push(t);
	}
	return out;
}

function scratchRelievesSegment(seg: string, reasons: string[], vars: Record<string, string>): boolean {
	for (const reason of reasons) {
		if (reason === MKDIR_REASON) {
			const seen = headOf(seg);
			if (seen.head !== 'mkdir') return false;
			const args = skipFlagValues(seen.rest, { '-m': true, '--mode': true });
			for (const a of args) {
				if (a.charAt(0) === '-') continue;
				if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) continue;
				if (expandScratchTarget(a, vars, {}) === null) return false;
			}
		} else if (reason === TOUCH_REASON) {
			const seen = headOf(seg);
			if (seen.head !== 'touch') return false;
			const args = skipFlagValues(seen.rest, { '-d': true, '--date': true, '-r': true, '--reference': true, '-t': true });
			for (const a of args) {
				if (a.charAt(0) === '-') continue;
				if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) continue;
				if (expandScratchTarget(a, vars, {}) === null) return false;
			}
		} else if (reason === REDIRECT_REASON) {
			const w = redirectWrites(seg);
			if (w.heredoc) return false;
			if (w.targets.length === 0) return false;
			for (const t of w.targets) {
				if (expandScratchTarget(t, vars, {}) === null) return false;
			}
		} else {
			return false;
		}
	}
	return reasons.length > 0;
}

// True when reviewScratch is on and every denylist hit against the command
// is a mkdir/touch/redirect whose targets all resolve under the scratch area.
export function checkScratchAllows(cmd: string, code: string, cfg: ResolvedLocalBashConfig): boolean {
	if (!cfg.reviewScratch) return false;
	const vars = collectScratchVars(cmd);
	let anyHit = false;
	for (const rule of BLOCKED) {
		if (!rule.pattern.test(code)) continue;
		anyHit = true;
		let relieved = false;
		for (const seg of splitSegments(code)) {
			if (!rule.pattern.test(seg)) continue;
			const per: string[] = [];
			for (const r of BLOCKED) {
				if ((r.reason === MKDIR_REASON || r.reason === TOUCH_REASON || r.reason === REDIRECT_REASON) && r.pattern.test(seg)) per.push(r.reason);
			}
			if (per.length > 0 && scratchRelievesSegment(seg, per, vars)) relieved = true;
		}
		if (!relieved) return false;
	}
	return anyHit;
}

function remedyFor(reason: string): string {
	if (reason === MKDIR_REASON || reason === TOUCH_REASON || reason === REDIRECT_REASON) {
		return ' - for /tmp scratch writes set reviewScratch:true in local-bash.json, or rerun with sandbox:true';
	}
	return '';
}
// ---------------------------------------------------------------------------
// Sandbox lane (bwrap): OS-enforced containment for installs / self-tests
// ---------------------------------------------------------------------------

export function bwrapPath(): string | null {
	const candidates = ['/usr/bin/bwrap', '/bin/bwrap'];
	for (const p of candidates) {
		try {
			if (existsSync(p)) return p;
		} catch {
			// ignore - treat as missing
		}
	}
	return null;
}

export function buildSandboxArgs(command: string, cwd: string, scratch: string, allowNetwork: boolean): string[] {
	const args: string[] = ['--die-with-parent'];
	const roBinds = ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc', cwd];
	for (const p of roBinds) {
		try {
			if (existsSync(p)) args.push('--ro-bind', p, p);
		} catch {
			// ignore - skip missing paths
		}
	}
	args.push('--bind', scratch, scratch, '--bind', '/tmp', '/tmp');
	args.push('--proc', '/proc', '--dev', '/dev');
	args.push('--setenv', 'HOME', scratch, '--setenv', 'TMPDIR', scratch);
	args.push('--setenv', 'PATH', '/usr/local/bin:/usr/bin:/bin');
	for (const k of Object.keys(process.env)) {
		const v = process.env[k];
		if (k.slice(0, 9) === 'PI_SETUP_' && v !== undefined) args.push('--setenv', k, v);
	}
	if (!allowNetwork) args.push('--unshare-net');
	const bash = existsSync('/bin/bash') ? '/bin/bash' : '/usr/bin/bash';
	args.push('--chdir', cwd, bash, '-c', command);
	return args;
}

// Denylist subset that still applies INSIDE the sandbox: privilege, remote
// execution, dynamic sourcing and loader hijacks are never routine, and file
// writes must stay under the scratch area (bwrap enforces at OS level too).
const SANDBOX_ALWAYS_BLOCKED: BlockRule[] = [
	{ pattern: new RegExp(T + '(sudo|doas|su|runas)\\b'), reason: 'privilege escalation' },
	{ pattern: new RegExp(T + '(ssh|scp|sftp|rsync|ftp|telnet)\\b'), reason: 'remote execution / network copy' },
	{ pattern: /\|\s*(sh|bash|zsh|fish|dash|ksh)\b/, reason: 'piping into a shell' },
	{ pattern: /["']?\$\(\s*(curl|wget)\b/, reason: 'command substitution fetching remote code' },
	{ pattern: new RegExp(T + '(eval|source)\\b'), reason: 'dynamic sourcing (eval/source) executes quoted content' },
	{ pattern: /\b(PATH|LD_PRELOAD|LD_LIBRARY_PATH|PYTHONPATH|NODE_PATH|PERL5LIB|RUBYLIB)\s*=/, reason: 'loader/search-path override (binary hijack risk)' },
];

export function checkSandboxCommand(cmd: string, code: string): DenyResult {
	const trimmed = cmd.trim();
	if (!trimmed) return { ok: false, reason: 'empty command' };
	for (const rule of SANDBOX_ALWAYS_BLOCKED) {
		if (rule.pattern.test(code)) return { ok: false, reason: 'blocked (sandbox): ' + rule.reason };
	}
	const vars = collectScratchVars(cmd);
	for (const seg of splitSegments(code)) {
		const seen = headOf(seg);
		if (seen.head === '.' && seen.rest.length > 0) {
			return { ok: false, reason: 'blocked (sandbox): dynamic sourcing (. script)' };
		}
		const w = redirectWrites(seg);
		if (w.heredoc) return { ok: false, reason: 'blocked (sandbox): heredoc feeds code to commands' };
		for (const t of w.targets) {
			if (expandScratchTarget(t, vars, { HOME: '/tmp' }) === null) {
				return { ok: false, reason: 'blocked (sandbox): redirect target outside scratch area: ' + t };
			}
		}
	}
	return { ok: true };
}

function runBashSandbox(
	bwrap: string,
	command: string,
	cwd: string,
	timeoutMs: number,
	maxOutputBytes: number,
	allowNetwork: boolean,
	signal?: AbortSignal,
): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean }> {
	return new Promise((resolve) => {
		let scratch = '';
		try {
			scratch = mkdtempSync(join(tmpdir(), 'pi-sandbox-'));
		} catch (err) {
			resolve({ exitCode: null, stdout: '', stderr: 'sandbox setup failed: ' + String(err), timedOut: false, truncated: false });
			return;
		}
		const done = (r: { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean }) => {
			try {
				rmSync(scratch, { recursive: true, force: true });
			} catch {
				// ignore - the /tmp cleaner handles leftovers
			}
			resolve(r);
		};
		const child = spawn(bwrap, buildSandboxArgs(command, cwd, scratch, allowNetwork), { env: process.env });
		const outChunks: Buffer[] = [];
		const errChunks: Buffer[] = [];
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill('SIGKILL');
		}, timeoutMs);
		if (timer.unref) timer.unref();
		const onAbort = () => {
			child.kill('SIGKILL');
		};
		if (signal) signal.addEventListener('abort', onAbort, { once: true });
		child.stdout.on('data', (d: Buffer) => outChunks.push(d));
		child.stderr.on('data', (d: Buffer) => errChunks.push(d));
		child.on('error', (err) => {
			clearTimeout(timer);
			if (signal) signal.removeEventListener('abort', onAbort);
			done({ exitCode: null, stdout: '', stderr: String(err), timedOut, truncated: false });
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			if (signal) signal.removeEventListener('abort', onAbort);
			const out = truncateBytes(Buffer.concat(outChunks), maxOutputBytes);
			const err = truncateBytes(Buffer.concat(errChunks), maxOutputBytes);
			done({
				exitCode: code,
				stdout: out.text,
				stderr: err.text,
				timedOut,
				truncated: out.truncated || err.truncated,
			});
		});
	});
}

async function executeSandboxed(
	command: string,
	cfg: ResolvedLocalBashConfig,
	cwd: string,
	timeout: number,
	signal: AbortSignal | undefined,
) {
	const verdict = checkSandboxCommand(command, codeOnly(command));
	if (!verdict.ok) {
		return {
			content: [{ type: 'text' as const, text: 'Blocked by local-bash sandbox policy: ' + verdict.reason }],
			details: { command, reason: verdict.reason },
			isError: true,
		};
	}
	const bwrap = bwrapPath() as string;
	const result = await runBashSandbox(bwrap, command, cwd, timeout, cfg.maxOutputBytes, cfg.sandboxAllowNetwork, signal);
	const sbHead = ['$ ' + command + ' [sandboxed via bwrap]', 'exit code: ' + String(result.exitCode === null || result.exitCode === undefined ? 'spawn-failed' : result.exitCode)];
	if (result.timedOut) sbHead.push('(killed after ' + timeout + 'ms timeout)');
	if (result.truncated) sbHead.push('(output truncated to ' + cfg.maxOutputBytes + ' bytes per stream)');
	const body: string[] = [...sbHead];
	if (result.stdout) body.push('--- stdout ---', result.stdout.replace(/\s+$/, ''));
	if (result.stderr) body.push('--- stderr ---', result.stderr.replace(/\s+$/, ''));
	if (!result.stdout && !result.stderr) body.push('(no output)');
	return {
		content: [{ type: 'text' as const, text: body.join('\n') }],
		details: { command, exitCode: result.exitCode, timedOut: result.timedOut, sandboxed: true },
		isError: result.exitCode !== 0,
	};
}
function splitSegments(code: string): string[] {
	return code
		.split(/;|&&|\|\||\||&|\(|\)|\r?\n/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/** First non-flag, non-assignment token of a segment (after an optional leading command name). */
function tokensOf(segment: string): string[] {
	const toks: string[] = [];
	let cur = "";
	let quote: string | null = null;
	for (let i = 0; i < segment.length; i++) {
		const c = segment[i]!;
		if (quote) {
			cur += c;
			if (c === quote) quote = null;
		} else if (c === '"' || c === "'") {
			quote = c;
			cur += c;
		} else if (/\s/.test(c)) {
			if (cur) {
				toks.push(cur);
				cur = "";
			}
		} else {
			cur += c;
		}
	}
	if (cur) toks.push(cur);
	return toks;
}

function checkStructuredCommand(cmd: string, code: string): string | null {
	for (const seg of splitSegments(code)) {
		const toks = tokensOf(seg).filter((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
		if (toks.length === 0) continue;
		let head = (toks[0] ?? "").toLowerCase();
		if (head === "command" || head === "env") {
			toks.shift();
			head = (toks[0] ?? "").toLowerCase();
		}
		if (head === "git") {
			// First non-flag token is the subcommand (`-C <dir>` pairs and
			// global flags like --no-pager skipped); everything after it is args.
			let name = "";
			const sub: string[] = [];
			for (let i = 1; i < toks.length; i++) {
				const t = toks[i]!;
			if (!name) {
					if (t === "-C") {
						i++;
						continue;
					}
					if (t.startsWith("-")) continue;
					name = t.toLowerCase();
					continue;
				}
				sub.push(t);
			}
			const rule = GIT_READ[name];
			if (rule === undefined) return `git ${name || "(no subcommand)"} is not on the read-only allowlist`;
			if (rule !== null) {
				const args = sub.join(" ").trim();
				if (!rule.test(args)) return `git ${name} ${args} is not a read-only invocation`;
			}
		} else if (head === "gh") {			const sub1 = (toks[1] ?? "").toLowerCase();
			const sub2 = (toks[2] ?? "").toLowerCase();
			if (sub1 === "api") {
				const m = seg.match(/(?:-X|--method)\s+([A-Za-z]+)/);
				const method = (m?.[1] ?? "GET").toUpperCase();
				if (method !== "GET") return `gh api with ${method} mutates — read-only GET only`;
			} else {
				const key =
					sub1 === "issue" || sub1 === "pr"
						? "issue|pr"
						: sub1 === "repo" && sub2 === "view"
							? "repo view"
							: sub1 === "release" && sub2 === "view"
								? "release view"
								: sub1 === "run" && (sub2 === "view" || sub2 === "list")
									? "run view|run list"
									: sub1;
				const rule = GH_READ[key];
				if (rule === undefined) return `gh ${sub1} ${sub2} is not on the read-only allowlist`;
				if (rule !== null) {
					const args = sub1 === "issue" || sub1 === "pr" ? sub2 : toks.slice(2).join(" ");
					if (!rule.test(args)) return `gh ${sub1} ${args} is not a read-only invocation`;
				}
			}
		} else if (head === "docker" || head === "podman") {
			const sub = (toks[1] ?? "").toLowerCase();
			if (!/^(ps|images|inspect|logs|stats|top|diff|port|version|info|search|volume\s+ls|network\s+ls)$/.test(sub)) {
				return `${head} ${sub || "(no subcommand)"} is not on the read-only allowlist`;
			}
		} else if (head === "kubectl") {
			const sub = (toks[1] ?? "").toLowerCase();
			if (!/^(get|describe|logs|explain|version|api-resources|top)$/.test(sub)) {
				return `kubectl ${sub || "(no subcommand)"} is not on the read-only allowlist`;
			}
		} else if (head === "systemctl" || head === "service") {
			const sub = (toks[1] ?? "").toLowerCase();
			if (!/^(status|is-active|is-enabled|is-failed|show|list-units|list-unit-files|cat|help)$/.test(sub)) {
				return `${head} ${sub || "(no subcommand)"} changes service state — status inspection only`;
			}
		}
	}	return null;
}

export interface DenyResult {
	ok: boolean;
	reason?: string;
}

export function checkCommand(cmd: string, cfg: ResolvedLocalBashConfig): DenyResult {
	const trimmed = cmd.trim();
	if (!trimmed) return { ok: false, reason: "empty command" };
	for (const prefix of cfg.allowedPrefixes) {
		if (prefix && trimmed.startsWith(prefix)) return { ok: true };
	}
	if (/[\0]/.test(trimmed)) return { ok: false, reason: "NUL byte in command" };
	const code = codeOnly(trimmed);
	// Structured parsers first so git/gh/docker/kubectl/systemctl violations
	// report the precise allowlist reason instead of a generic token hit.
	const structured = checkStructuredCommand(trimmed, code);
	if (structured) return { ok: false, reason: 'blocked: ' + structured };
	const positional = checkCommandPosition(code);
	if (positional) return { ok: false, reason: 'blocked: ' + positional };
	if (checkScratchAllows(trimmed, code, cfg)) return { ok: true };
	for (const rule of BLOCKED) {
		if (rule.pattern.test(code)) return { ok: false, reason: 'blocked: ' + rule.reason + remedyFor(rule.reason) };
	}
	for (const extra of cfg.extraBlocked) {
		if (extra.test(code)) return { ok: false, reason: `blocked by local-bash.json extraBlocked: ${extra.source}` };
	}
	return { ok: true };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function truncateBytes(buf: Buffer, max: number): { text: string; truncated: boolean } {
	if (buf.length <= max) return { text: buf.toString("utf-8"), truncated: false };
	return { text: buf.subarray(0, max).toString("utf-8"), truncated: true };
}

function runBash(
	command: string,
	cwd: string,
	timeoutMs: number,
	maxOutputBytes: number,
	signal?: AbortSignal,
): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; truncated: boolean }> {
	return new Promise((resolve) => {
		const child = spawn("bash", ["-c", command], { cwd, env: process.env });
		const outChunks: Buffer[] = [];
		const errChunks: Buffer[] = [];
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, timeoutMs);
		timer.unref?.();
		const onAbort = () => {
			child.kill("SIGKILL");
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (d: Buffer) => outChunks.push(d));
		child.stderr.on("data", (d: Buffer) => errChunks.push(d));
		child.on("error", (err) => {			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			resolve({ exitCode: null, stdout: "", stderr: String(err), timedOut, truncated: false });
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			const out = truncateBytes(Buffer.concat(outChunks), maxOutputBytes);
			const err = truncateBytes(Buffer.concat(errChunks), maxOutputBytes);
			resolve({
				exitCode: code,
				stdout: out.text,
				stderr: err.text,
				timedOut,
				truncated: out.truncated || err.truncated,
			});
		});
	});
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerLocalBashTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: LOCAL_BASH_TOOL_NAME,
		label: "Local Bash (denylist)",
		description:
			"Run a shell command that was blocked by plan mode's read-only policy. " +
			"Loops, pipes, $(...), && / || / ; chains are allowed; only destructive commands are blocked " +
			"(rm/mv/cp, file redirects, sudo, git/gh mutations, package installs, remote execution). " +
			"Use for inspection (gh issue view, git log, greps in loops). Do NOT use to mutate anything — " +
			"blocked commands return an error naming the rule. " +
			"Pass sandbox:true to run installs and installer self-tests in a bwrap sandbox (scratch HOME).",
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
		parameters: Type.Object({
			command: Type.String({
				description: "Shell command to run via bash -c in the session working directory.",
			}),
			timeoutMs: Type.Optional(
				Type.Number({ description: "Kill the command after this many ms (default 60000, min 1000)." }),
			),
			sandbox: Type.Optional(
				Type.Boolean({ description: 'Run inside a bwrap OS sandbox (scratch HOME, read-only repo/system, /tmp writable). For installs and installer self-tests.' }),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
			const cfg = loadLocalBashConfig();
			const p = params as { command?: unknown; timeoutMs?: unknown; sandbox?: unknown };
			if (typeof p.command !== "string" || !p.command.trim()) {
				return {
					content: [{ type: "text" as const, text: "Error: command must be a non-empty string" }],
					isError: true,
				};
			}
			const timeout =
				typeof p.timeoutMs === "number" && Number.isInteger(p.timeoutMs) && p.timeoutMs >= 1000
					? p.timeoutMs
					: cfg.timeoutMs;
			const wantSandbox = p.sandbox === true;
			if (wantSandbox && bwrapPath() === null && !cfg.sandboxAllowFallback) {
				const msg = 'sandbox:true requested but bwrap is not installed (looked in /usr/bin, /bin) - install bubblewrap, or set sandboxAllowFallback:true to run unsandboxed';
				return {
					content: [{ type: 'text' as const, text: msg }],
					details: { command: p.command, reason: msg },
					isError: true,
				};
			}
			if (wantSandbox && bwrapPath() !== null) {
				return executeSandboxed(p.command, cfg, ctx.cwd || process.cwd(), timeout, ctx.signal);
			}
			const verdict = checkCommand(p.command, cfg);
			if (!verdict.ok) {
				return {
					content: [{ type: "text" as const, text: 'Blocked by local-bash denylist: ' + verdict.reason }],
					details: { command: p.command, reason: verdict.reason },
					isError: true,
				};
			}
			const cwd = ctx.cwd || process.cwd();
			const fallbackNote = wantSandbox ? 'WARNING: bwrap missing, ran unsandboxed (sandboxAllowFallback:true). ' : '';
			const result = await runBash(p.command, cwd, timeout, cfg.maxOutputBytes, ctx.signal);
			const head = ['$ ' + p.command + (fallbackNote ? ' [' + fallbackNote + ']' : ''), 'exit code: ' + String(result.exitCode === null || result.exitCode === undefined ? 'spawn-failed' : result.exitCode)];
			if (result.timedOut) head.push('(killed after ' + timeout + 'ms timeout)');
			if (result.truncated) head.push('(output truncated to ' + cfg.maxOutputBytes + ' bytes per stream)');
			const body: string[] = [...head];
			if (result.stdout) body.push("--- stdout ---", result.stdout.replace(/\s+$/, ""));
			if (result.stderr) body.push("--- stderr ---", result.stderr.replace(/\s+$/, ""));
			if (!result.stdout && !result.stderr) body.push("(no output)");
			return {
				content: [{ type: "text" as const, text: body.join("\n") }],
				details: { command: p.command, exitCode: result.exitCode, timedOut: result.timedOut },
				isError: result.exitCode !== 0,
			};
		},
	});
}

export default function (pi: ExtensionAPI): void {
	registerLocalBashTool(pi);
}
