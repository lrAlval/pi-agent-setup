/**
 * efficient-pi-ask-user config — fully local, no upstream dependency.
 *
 * Every value that was a hardcoded constant in rpiv-ask-user-question
 * (question/option caps, length limits, feature flags, prompt copy) lives
 * here and is read from `~/.pi/agent/efficient-pi-ask-user.json`
 * (`$PI_CODING_AGENT_DIR` is honored when set), with a legacy fallback to
 * `~/.config/efficient-pi-ask-user/config.json`.
 *
 * Caps are frozen at extension-load time (restart Pi after changing them);
 * collapseKey/guidance are re-read per tool call like upstream.
 * Invalid values warn once and fall back to the default — never a broken session.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Key spec for the overlay collapse/expand shortcut, e.g. `"ctrl+]"` or `"alt+o"`. */
export type CollapseKeySpec = string;

export const DEFAULT_COLLAPSE_KEY: CollapseKeySpec = "ctrl+]";
export const COLLAPSE_KEY_OFF: CollapseKeySpec = "off";

export interface GuidanceFields {
	description?: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
}

export interface EfficientAskUserConfig {
	/** Max questions per invocation. Default 6. Range 1-12. */
	maxQuestions?: number;
	/** Min options per question. Default 2. Range 1-4. */
	minOptions?: number;
	/** Max options per question. Default 4. Range 1-8. */
	maxOptions?: number;
	/** Max header chip length. Default 16. Range 4-64. */
	maxHeaderLength?: number;
	/** Max option label length. Default 60. Range 10-200. */
	maxLabelLength?: number;
	/** Expose the multiSelect flag. Default true. */
	allowMultiSelect?: boolean;
	/** Expose the preview field. Default true. */
	allowPreview?: boolean;
	/** Lean-style declaration: strip schema descriptions, one-line tool
	 * description, empty prompt snippet, single guideline line. Default true. */
	compactSchema?: boolean;
	/** Collapse/expand key spec, or "off". Default "ctrl+]". */
	collapseKey?: CollapseKeySpec;
	/** Tool declaration overrides. */
	guidance?: GuidanceFields;
}

export interface ResolvedEfficientAskUserConfig {
	maxQuestions: number;
	minOptions: number;
	maxOptions: number;
	maxHeaderLength: number;
	maxLabelLength: number;
	allowMultiSelect: boolean;
	allowPreview: boolean;
	compactSchema: boolean;
	collapseKey: CollapseKeySpec;
	guidance: GuidanceFields;
}

const DEFAULTS = {
	maxQuestions: 6,
	minOptions: 2,
	maxOptions: 4,
	maxHeaderLength: 16,
	maxLabelLength: 60,
	allowMultiSelect: true,
	allowPreview: true,
	compactSchema: true,
} as const;

export const CONFIG_FILE_NAME = "efficient-pi-ask-user.json";

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
		console.warn(
			`efficient-pi-ask-user: invalid JSON at ${path}, ignoring — ${(err as Error).message}`,
		);
		return {};
	}
}

function clampInt(raw: unknown, field: string, min: number, max: number, fallback: number): number {
	if (typeof raw !== "number" || !Number.isInteger(raw) || raw < min || raw > max) {
		if (raw !== undefined) {
			console.warn(
				`efficient-pi-ask-user: config field "${field}" must be an integer ${min}-${max}, ` +
					`got ${JSON.stringify(raw)} — using ${fallback}`,
			);
		}
		return fallback;
	}
	return raw;
}

function clampBool(raw: unknown, field: string, fallback: boolean): boolean {
	if (typeof raw !== "boolean") {
		if (raw !== undefined) {
			console.warn(
				`efficient-pi-ask-user: config field "${field}" must be a boolean, ` +
					`got ${JSON.stringify(raw)} — using ${fallback}`,
			);
		}
		return fallback;
	}
	return raw;
}

function loadRawConfig(): Record<string, unknown> {
	const legacy = readJsonFile(join(homedir(), ".config", "efficient-pi-ask-user", "config.json"));
	const primary = readJsonFile(join(agentDir(), CONFIG_FILE_NAME));
	return { ...legacy, ...primary };
}

export function loadConfig(): ResolvedEfficientAskUserConfig {
	const raw = loadRawConfig();
	const minOptions = clampInt(raw.minOptions, "minOptions", 1, 4, DEFAULTS.minOptions);
	const maxOptions = clampInt(raw.maxOptions, "maxOptions", minOptions, 8, DEFAULTS.maxOptions);
	return {
		maxQuestions: clampInt(raw.maxQuestions, "maxQuestions", 1, 12, DEFAULTS.maxQuestions),
		minOptions,
		maxOptions,
		maxHeaderLength: clampInt(raw.maxHeaderLength, "maxHeaderLength", 4, 64, DEFAULTS.maxHeaderLength),
		maxLabelLength: clampInt(raw.maxLabelLength, "maxLabelLength", 10, 200, DEFAULTS.maxLabelLength),
		allowMultiSelect: clampBool(raw.allowMultiSelect, "allowMultiSelect", DEFAULTS.allowMultiSelect),
		allowPreview: clampBool(raw.allowPreview, "allowPreview", DEFAULTS.allowPreview),
		compactSchema: clampBool(raw.compactSchema, "compactSchema", DEFAULTS.compactSchema),
		collapseKey:
			typeof raw.collapseKey === "string" && raw.collapseKey.trim() !== ""
				? raw.collapseKey
				: DEFAULT_COLLAPSE_KEY,
		guidance: validateGuidanceFields(raw.guidance),
	};
}

// Named keys accepted by pi-tui's `matchesKey` (keys.js switch on the parsed base key).
// parseKeyId lowercases the id before matching, so lowercase spellings are canonical.
const SPECIAL_KEYS = new Set([
	"escape",
	"esc",
	"enter",
	"return",
	"tab",
	"space",
	"backspace",
	"delete",
	"insert",
	"clear",
	"home",
	"end",
	"pageup",
	"pagedown",
	"up",
	"down",
	"left",
	"right",
	...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
]);

const MODIFIERS = new Set(["ctrl", "shift", "alt", "super"]);

function isValidCollapseKeySpec(spec: string): boolean {
	if (!spec) return false;
	if (spec.startsWith("+") || spec.endsWith("+") || spec.includes("++")) return false;
	const parts = spec.split("+");
	const base = parts[parts.length - 1] ?? "";
	const modifiers = parts.slice(0, -1);
	if (modifiers.length !== new Set(modifiers).size) return false;
	if (!modifiers.every((m) => MODIFIERS.has(m))) return false;
	return base.length === 1 ? /[a-z0-9_\-!@#$%^&*()|~`'":;,./<>?[\]{}=\\]/.test(base) : SPECIAL_KEYS.has(base);
}

export function resolveCollapseKey(config: Pick<ResolvedEfficientAskUserConfig, "collapseKey">): CollapseKeySpec {
	const raw = config.collapseKey?.trim().toLowerCase();
	if (raw === undefined || raw === "") return DEFAULT_COLLAPSE_KEY;
	if (raw === COLLAPSE_KEY_OFF) return COLLAPSE_KEY_OFF;
	return isValidCollapseKeySpec(raw) ? raw : DEFAULT_COLLAPSE_KEY;
}

// The only compound-word names in SPECIAL_KEYS — first-letter capitalization
// alone would render them "Pageup"/"Pagedown".
const COMPOUND_KEY_DISPLAY: Record<string, string> = {
	pageup: "PageUp",
	pagedown: "PageDown",
};

/**
 * Pretty-print a resolved key spec for UI copy. Display-only — key matching
 * always uses the raw lowercase spec, so never feed the result back into it.
 */
export function formatKeySpecForDisplay(spec: CollapseKeySpec): string {
	return spec
		.split("+")
		.map(
			(part) =>
				COMPOUND_KEY_DISPLAY[part] ??
				(part.length <= 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)),
		)
		.join("+");
}

/**
 * Validate the guidance override block: string fields must be strings,
 * promptGuidelines must be an array of strings. Malformed fields are dropped
 * (with a warning) so a typo in config can never break tool registration.
 */
export function validateGuidanceFields(raw: unknown): GuidanceFields {
	if (raw === undefined || raw === null) return {};
	if (typeof raw !== "object" || Array.isArray(raw)) {
		console.warn(`efficient-pi-ask-user: config field "guidance" must be an object — ignoring`);
		return {};
	}
	const g = raw as Record<string, unknown>;
	const out: GuidanceFields = {};
	if (g.description !== undefined) {
		if (typeof g.description === "string") out.description = g.description;
		else console.warn(`efficient-pi-ask-user: guidance.description must be a string — ignoring`);
	}
	if (g.promptSnippet !== undefined) {
		if (typeof g.promptSnippet === "string") out.promptSnippet = g.promptSnippet;
		else console.warn(`efficient-pi-ask-user: guidance.promptSnippet must be a string — ignoring`);
	}
	if (g.promptGuidelines !== undefined) {
		if (Array.isArray(g.promptGuidelines) && g.promptGuidelines.every((s) => typeof s === "string")) {
			out.promptGuidelines = g.promptGuidelines as string[];
		} else {
			console.warn(`efficient-pi-ask-user: guidance.promptGuidelines must be string[] — ignoring`);
		}
	}
	return out;
}
