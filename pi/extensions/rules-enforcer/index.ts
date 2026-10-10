/**
 * rules-enforcer: generalize xias-enforcer into one gate/routing enforcement
 * extension.
 *
 * Covers two domains, both as one-time system-prompt nudges plus a single
 * refuse-to-settle per mode. Read-only: it never edits, never loops.
 *
 *   1. Delegation non-negotiables (from the `agent-routing` skill):
 *      bug fix -> `bug-detective`; first repo contact -> `surveyor`;
 *      shared/public/unfamiliar edits -> `blast-radius`; infra -> `foreman`;
 *      refactors -> `blast-radius` + `safety-net`.
 *      Each trigger fires at most once per session.
 *
 *   2. UI gates (all xias-enforcer behavior, unchanged):
 *      skill-routing nudge + refuse-to-settle without the mode's gate set
 *      (`ui` full set, `prototype` cheap pair). Sessions driven by the
 *      `ui-sdlc` orchestrator are held to the same settle-gate.
 *
 * The token-budget guideline is deliberately NOT enforced: it stays prose
 * in AGENTS.md because nudge fatigue would hurt more than it helps.
 */
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";

const KIT_ROOT = join(homedir(), ".agents", "ux-ui-agent-skills");
const KIT_SCRIPTS = join(KIT_ROOT, "scripts");
const KIT_TOKENS = join(KIT_ROOT, "tokens");

type Mode = "ui" | "prototype";

const CHEAP_GATES = [
	"validate_tokens.py",
	"validate_contrast.py",
	"lint_hardcodes.py",
	"check_no_emoji.py",
	"lint_native_select.py",
	"validate_theme_refs.py",
	"validate_component_spec.py",
	"lint_taste.py",
];

const RENDER_GATES = [
	"measure_render.mjs",
	"verify_states.mjs",
	"axe_audit.mjs",
	"verify_responsive.mjs",
	"verify_interactive.mjs",
	"verify_keyboard.mjs",
	"verify_target_size.mjs",
	"verify_mobile_first.mjs",
	"verify_focustrap.mjs",
	"verify_overflow.mjs",
	"verify_reduced_motion.mjs",
	"verify_rtl.mjs",
	"verify_screen_economy.mjs",
	"lint_intent.mjs",
	"slop_tells.mjs",
	"taste_audit.mjs",
];

/** The throwaway prototype's cheap short pair, enforced as a pair. */
const PROTOTYPE_REQUIRED = ["lint_hardcodes.py", "check_no_emoji.py"];

const UI_EXT = new Set([
	".html",
	".htm",
	".css",
	".scss",
	".vue",
	".svelte",
	".tsx",
	".jsx",
	".swift",
	".dart",
]);

const UI_RE =
	/\b(ui|ux|dashboards?|screens?|pages?|components?|themes?|design|frontend|landing|contrast|accessibilit(?:y|ies)|prototype)\b/i;

// A ui-sdlc-driven session is UI work even when the prompt that starts a
// turn carries no UI keyword.
const UI_SDL_RE = /\bui-sdlc\b/i;

const PROTOTYPE_KEYWORDS = [
	"prototype",
	"throwaway",
	"quick mock",
	"mockup",
	"mock-up",
	"skeleton",
	"spike",
	"sanity check",
];

const PROMOTE_KEYWORDS = [
	"production",
	"ship it",
	"make it real",
	"build it properly",
];

// Delegation triggers (agent-routing non-negotiables). Each fires at most
// once per session.
const BUG_RE = /\b(bug|regression|stack trace|traceback|throws|crash|broken|fails?)\b/i;
const INFRA_RE =
	/\b(infra|terraform|k8s|kubernetes|docker|ci\/cd|pipeline|deploy|aws|gcp|azure|iac|ansible|helm)\b/i;
const REFACTOR_RE = /\b(refactor|restructure|reorganize|cleanup|tech debt)\b/i;

const DELEGATION_GUIDELINES: Record<string, string> = {
	bug: "Delegation rule: never propose a bug fix before delegating to `bug-detective`. Load the `agent-routing` skill for mechanics.",
	infra:
		"Delegation rule: never suggest infrastructure changes before delegating to `foreman`. Load the `agent-routing` skill for mechanics.",
	refactor:
		"Delegation rule: for refactors, get input from `blast-radius` and `safety-net` first. Load the `agent-routing` skill for mechanics.",
	unownedEdit:
		"Delegation rule: you are editing code with no recorded subagent delegation this session - before touching shared, public, or unfamiliar-ownership code, delegate to `blast-radius`. On first contact with a repo, delegate discovery to `surveyor`. Load the `agent-routing` skill for mechanics.",
};

interface State {
	mode: Mode;
	promoted: boolean;
	uiDirty: boolean;
	editedFiles: Set<string>;
	gatesSeen: Set<string>;
	nudgedModes: Set<Mode>;
	blockedModes: Set<Mode>;
	kitWarning: string | undefined;
	warnedKit: boolean;
	// Delegation domain.
	delegated: boolean;
	firedTriggers: Set<string>;
	editsWithoutDelegation: boolean;
}

function freshState(): State {
	return {
		mode: "ui",
		promoted: false,
		uiDirty: false,
		editedFiles: new Set(),
		gatesSeen: new Set(),
		nudgedModes: new Set(),
		blockedModes: new Set(),
		kitWarning: undefined,
		warnedKit: false,
		delegated: false,
		firedTriggers: new Set(),
		editsWithoutDelegation: false,
	};
}

function checkKit(): string | undefined {
	const problems: string[] = [];
	if (!existsSync(KIT_TOKENS)) {
		problems.push(`kit tokens dir missing: ${KIT_TOKENS}`);
	}
	const missing = [...CHEAP_GATES, ...RENDER_GATES].filter(
		(script) => !existsSync(join(KIT_SCRIPTS, script)),
	);
	if (missing.length) {
		problems.push(`gate scripts missing under ${KIT_SCRIPTS}: ${missing.join(", ")}`);
	}
	return problems.length ? problems.join("; ") : undefined;
}

function hasBrowser(): boolean {
	const home = homedir();
	return (
		existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") ||
		existsSync(join(home, "Library/Caches/ms-playwright")) ||
		existsSync(join(home, ".cache/ms-playwright")) ||
		existsSync("/usr/bin/google-chrome") ||
		existsSync("/usr/bin/chromium") ||
		existsSync("/usr/bin/chromium-browser")
	);
}

function routingGuideline(mode: Mode): string {
	const shared =
		"XIAS kit is active for this session. Read the design-doctrine skill first, then the routed skill from the AGENTS.md UI routing table, before writing UI code. Kit at ~/.agents/ux-ui-agent-skills; scripts in scripts/; docs/GUIDE.md and docs/AGENTS-SETUP.md.";
	if (mode === "prototype") {
		return `${shared} Mode: prototype (throwaway). Gate obligation: the cheap short pair only - lint_hardcodes.py plus check_no_emoji.py, adding validate_contrast.py if tokens were used. Render gates are skipped and must be logged in one line as a deliberate tradeoff. Say "production" to re-enable the full gate set.`;
	}
	return `${shared} Mode: ui. Gate obligation: run the applicable gate set before finishing - cheap gates at minimum plus browser render gates. Prefix a single render gate with DS_REQUIRE_BROWSER=1 so a SKIPPED result fails loudly instead of reading as a pass.`;
}

function missingGates(state: State): string[] {
	const missing: string[] = [];
	if (state.mode === "prototype") {
		for (const script of PROTOTYPE_REQUIRED) {
			if (!state.gatesSeen.has(script)) missing.push(script);
		}
		return missing;
	}
	if (!CHEAP_GATES.some((script) => state.gatesSeen.has(script))) {
		missing.push("a cheap gate (e.g. lint_hardcodes.py)");
	}
	if (hasBrowser()) {
		if (!RENDER_GATES.some((script) => state.gatesSeen.has(script))) {
			missing.push("a render gate (e.g. verify_states.mjs, axe_audit.mjs)");
		}
	} else {
		missing.push("render gates are unavailable here (no browser) - state the result is UNMEASURED");
	}
	return missing;
}

function reminder(state: State, missing: string[]): string {
	const edited = [...state.editedFiles];
	const lines: string[] = [
		"[rules-enforcer] UI files were edited in this session but the gates this mode needs have not run.",
		`Mode: ${state.mode}. Missing: ${missing.join("; ")}.`,
		`Edited: ${edited.length ? edited.join(", ") : "(none recorded)"}`,
		"Run before finishing:",
		`  cheap:  python3 ${join(KIT_SCRIPTS, "lint_hardcodes.py")} <path>`,
		`          python3 ${join(KIT_SCRIPTS, "check_no_emoji.py")} <path>`,
		`  render: DS_REQUIRE_BROWSER=1 node ${join(KIT_SCRIPTS, "verify_states.mjs")} <file>`,
		`          DS_REQUIRE_BROWSER=1 node ${join(KIT_SCRIPTS, "axe_audit.mjs")} <file>`,
	];
	if (state.mode === "prototype") {
		lines.push(
			"Throwaway prototype: only the cheap pair is required; log the skipped render gates as a tradeoff.",
		);
	} else {
		lines.push(
			"Full UI work: cheap gates plus at least one render gate; disposition every finding.",
		);
	}
	if (state.kitWarning) {
		lines.push(`Kit warning: ${state.kitWarning}`);
	}
	lines.push("This is the one reminder for this mode; it will not repeat.");
	return lines.join("\n");
}

function fireTrigger(
	state: State,
	key: string,
	ctx: ExtensionContext,
	push: (text: string) => void,
): void {
	if (state.firedTriggers.has(key)) return;
	state.firedTriggers.add(key);
	push(DELEGATION_GUIDELINES[key]);
	ctx.ui.notify(`[rules-enforcer] ${DELEGATION_GUIDELINES[key]}`, "warning");
}

export default function rulesEnforcer(pi: ExtensionAPI): void {
	let state = freshState();

	pi.on("session_start", (_event, ctx) => {
		state = freshState();
		state.kitWarning = checkKit();
		if (state.kitWarning) {
			// Fail loud, but only once UI work actually shows up, so non-UI
			// sessions stay quiet.
			ctx.ui.setStatus("rules", "kit incomplete");
		} else {
			ctx.ui.setStatus("rules", undefined);
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		ctx.ui.setStatus("rules", undefined);
		state = freshState();
	});

	pi.on("before_agent_start", (event, ctx) => {
		const prompt = event.prompt || "";
		const lower = prompt.toLowerCase();
		const modeBefore = state.mode;
		const push = (text: string): void => {
			event.systemPromptOptions.promptGuidelines.push(text);
		};

		// Delegation domain: keyword triggers, each at most once per session.
		if (BUG_RE.test(prompt)) fireTrigger(state, "bug", ctx, push);
		if (INFRA_RE.test(prompt)) fireTrigger(state, "infra", ctx, push);
		if (REFACTOR_RE.test(prompt)) fireTrigger(state, "refactor", ctx, push);
		// Edits started with no recorded delegation: nudge once, on the
		// next turn boundary where a guideline can actually be attached.
		if (state.editsWithoutDelegation && !state.delegated) {
			fireTrigger(state, "unownedEdit", ctx, push);
		}

		// UI domain (xias-enforcer behavior, unchanged).
		if (PROMOTE_KEYWORDS.some((keyword) => lower.includes(keyword))) {
			state.promoted = true;
			state.mode = "ui";
		} else if (
			!state.promoted &&
			PROTOTYPE_KEYWORDS.some((keyword) => lower.includes(keyword))
		) {
			state.mode = "prototype";
		}

		// A mode flip is itself a UI signal, so promotion re-nudges even when
		// the prompt that triggered it carries no UI keyword. A ui-sdlc
		// mention is likewise a UI signal.
		const uiSignal =
			UI_RE.test(prompt) ||
			UI_SDL_RE.test(prompt) ||
			state.mode !== modeBefore;
		if (!uiSignal) return;

		if (state.kitWarning && !state.warnedKit) {
			state.warnedKit = true;
			ctx.ui.notify(`[rules-enforcer] ${state.kitWarning}`, "warning");
		}

		if (!state.nudgedModes.has(state.mode)) {
			state.nudgedModes.add(state.mode);
			push(routingGuideline(state.mode));
		}
	});

	pi.on("tool_call", (event) => {
		// Any subagent delegation records that the session delegated.
		if (event.toolName === "Agent") {
			state.delegated = true;
			return;
		}
		if (event.toolName === "write" || event.toolName === "edit") {
			if (!state.delegated) state.editsWithoutDelegation = true;
			const input = event.input as Record<string, unknown>;
			const path = input.path;
			if (typeof path === "string" && UI_EXT.has(extname(path).toLowerCase())) {
				state.uiDirty = true;
				state.editedFiles.add(path);
			}
			return;
		}
		if (event.toolName === "bash") {
			const input = event.input as Record<string, unknown>;
			const command = input.command;
			if (typeof command !== "string") return;
			for (const script of [...CHEAP_GATES, ...RENDER_GATES]) {
				if (command.includes(script)) state.gatesSeen.add(script);
			}
		}
	});

	pi.on("agent_before_settle", (event, ctx) => {
		if (!state.uiDirty) return;
		if (state.blockedModes.has(state.mode)) return;

		const missing = missingGates(state);
		if (!missing.length) return;

		if (!event.canContinue) {
			ctx.ui.notify(
				`[rules-enforcer] gates missing but the run cannot continue: ${missing.join("; ")}`,
				"warning",
			);
			return;
		}

		state.blockedModes.add(state.mode);
		return {
			continue: true,
			entries: [
				{
					type: "custom_message",
					customType: "rules-gate-reminder",
					content: reminder(state, missing),
					display: true,
				},
			],
		};
	});

	pi.registerCommand("rules-status", {
		description: "Show rules-enforcer mode, edited UI files, gates seen, and delegation state",
		handler: async (_args, ctx) => {
			const lines = [
				`mode: ${state.mode}${state.promoted ? " (promoted)" : ""}`,
				`ui-dirty: ${state.uiDirty}`,
				`edited: ${[...state.editedFiles].join(", ") || "(none)"}`,
				`gates seen: ${[...state.gatesSeen].join(", ") || "(none)"}`,
				`blocked modes: ${[...state.blockedModes].join(", ") || "(none)"}`,
				`delegated: ${state.delegated}`,
				`triggers fired: ${[...state.firedTriggers].join(", ") || "(none)"}`,
				`browser: ${hasBrowser() ? "present" : "absent"}`,
				`kit: ${state.kitWarning ? state.kitWarning : "ok"}`,
			];
			ctx.ui.notify(`[rules-enforcer]\n${lines.join("\n")}`, "info");
		},
	});

	// Kept for sessions that learned the old name.
	pi.registerCommand("xias-status", {
		description: "Alias of rules-status (xias-enforcer superseded by rules-enforcer)",
		handler: async (_args, ctx) => {
			const lines = [
				`mode: ${state.mode}${state.promoted ? " (promoted)" : ""}`,
				`ui-dirty: ${state.uiDirty}`,
				`edited: ${[...state.editedFiles].join(", ") || "(none)"}`,
				`gates seen: ${[...state.gatesSeen].join(", ") || "(none)"}`,
				`blocked modes: ${[...state.blockedModes].join(", ") || "(none)"}`,
				`browser: ${hasBrowser() ? "present" : "absent"}`,
				`kit: ${state.kitWarning ? state.kitWarning : "ok"}`,
			];
			ctx.ui.notify(`[rules-enforcer]\n${lines.join("\n")}`, "info");
		},
	});
}
