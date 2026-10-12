/**
 * local-patch-guard — generic local-patch re-applier for pi extensions.
 *
 * Reads ~/.pi/agent/patches/patch-registry.json. Each entry declares:
 *   name     - label for notifications
 *   package  - npm package whose installed files are patched (skipped if absent)
 *   target   - where the patched file lives:
 *              { file: "dist/index.ts" }                        direct, relative to package root
 *              { dirScan: "dist/chunks", anchors: [...] }       first file containing ALL anchors
 *   steps    - ordered patch scripts (relative to ~/.pi/agent/patches/) with a
 *              marker that proves that patch level is still applied.
 *
 * At session start: for every entry, if the target file lacks any step marker,
 * run exactly the missing steps (scripts must be idempotent). Success reports
 * "info"; script failure, missing script, or target drift reports "warning".
 * Everything patched -> silent.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface RegistryStep {
	script: string;
	marker: string;
}

interface RegistryEntry {
	name: string;
	package: string;
	target: { file?: string; dirScan?: string; anchors?: string[] };
	steps: RegistryStep[];
}

interface Registry {
	versions?: { registry?: number };
	entries: RegistryEntry[];
}

const AGENT_DIR = join(homedir(), ".pi", "agent");
const PATCH_DIR = join(AGENT_DIR, "patches");
const REGISTRY_FILE = join(PATCH_DIR, "patch-registry.json");
const NODE_MODULES = join(AGENT_DIR, "npm", "node_modules");

/** Resolve the file(s) a registry entry guards. Returns absolute path(s). */
function resolveTargets(pkgRoot: string, entry: RegistryEntry): string[] {
	const t = entry.target;
	if (t.file) return [join(pkgRoot, t.file)];
	if (t.dirScan) {
		const dir = join(pkgRoot, t.dirScan);
		if (!existsSync(dir)) return [];
		for (const f of readdirSync(dir)) {
			if (!f.endsWith(".ts") && !f.endsWith(".js")) continue;
			const p = join(dir, f);
			try {
				const text = readFileSync(p, "utf8");
				if (t.anchors && t.anchors.length && t.anchors.every((a) => text.includes(a))) return [p];
			} catch {
				// unreadable: keep scanning
			}
		}
		return [];
	}
	return [];
}

interface RunRecord {
	label: string;
	ok: boolean;
	detail: string;
}

function runSteps(entry: RegistryEntry, targetText: string, missing: RegistryStep[]): RunRecord[] {
	const records: RunRecord[] = [];
	for (const step of missing) {
		const script = join(PATCH_DIR, step.script);
		const label = entry.name + ":" + step.script;
		if (!existsSync(script)) {
			records.push({ label, ok: false, detail: "patch script missing" });
			continue;
		}
		const r = spawnSync("node", [script], { encoding: "utf8", timeout: 30000 });
		if (r.status !== 0) {
			const tail = r.stderr ? r.stderr.trim().split(String.fromCharCode(10)).slice(-3).join(" | ") : "exit " + r.status;
			records.push({ label, ok: false, detail: tail });
		} else {
			const last = r.stdout ? r.stdout.trim().split(String.fromCharCode(10)).pop() : "";
			records.push({ label, ok: true, detail: last ?? "done" });
		}
	}
	return records;
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		try {
			let registry: Registry;
			try {
				registry = JSON.parse(readFileSync(REGISTRY_FILE, "utf8")) as Registry;
			} catch {
				return; // no registry -> nothing to guard
			}
			if (!Array.isArray(registry.entries) || !registry.entries.length) return;

			const records: RunRecord[] = [];
			for (const entry of registry.entries) {
				const pkgRoot = entry.package ? join(NODE_MODULES, entry.package) : join(NODE_MODULES);
				if (entry.package && !existsSync(join(pkgRoot, "package.json"))) continue; // not installed
				const targets = resolveTargets(pkgRoot, entry);
				if (!targets.length) {
					records.push({ label: entry.name, ok: false, detail: "target file not found (upstream drift)" });
					continue;
				}
				for (const target of targets) {
					const text = readFileSync(target, "utf8");
					const missing = entry.steps.filter((s) => !text.includes(s.marker));
					if (!missing.length) continue; // fully patched
					records.push(...runSteps(entry, text, missing));
				}
			}
			if (!records.length) return; // everything already patched: silent

			const failed = records.filter((r) => !r.ok).length > 0;
			const summary = "local-patch-guard: " + records.map((r) => (r.ok ? "OK " : "FAILED ") + r.label + " - " + r.detail).join(" ; ");
			ctx.ui.notify?.(summary, failed ? "warning" : "info");
		} catch (err) {
			ctx.ui.notify?.("local-patch-guard: error " + String(err), "warning");
		}
	});
}
