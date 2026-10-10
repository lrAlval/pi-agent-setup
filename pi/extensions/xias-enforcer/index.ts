/**
 * xias-enforcer: make the XIAS UI kit's "measure it or say you did not" rule
 * happen instead of asking the model to remember it.
 *
 * The kit's AGENTS.md surface has no hooks - every rule there is a request.
 * This extension ports the intent of the kit's Claude Code hooks to pi:
 *
 *   - route the model to the right skill with a one-time system-prompt nudge,
 *   - remember which UI files were edited and which gates actually ran,
 *   - refuse to let a UI session settle once without the gates that mode needs.
 *
 * Modes:
 *   - "ui"        (default)  full gate set: cheap gates plus browser render gates.
 *   - "prototype" (throwaway) cheap short pair only: lint_hardcodes + check_no_emoji,
 *                             with skipped render gates logged as a tradeoff.
 *
 * The block fires at most once per mode per session, so it can never loop.
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
		"[xias-enforcer] UI files were edited in this session but the gates this mode needs have not run.",
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

export default function xiasEnforcer(pi: ExtensionAPI): void {
	let state = freshState();

	pi.on("session_start", (_event, ctx) => {
		state = freshState();
		state.kitWarning = checkKit();
		if (state.kitWarning) {
			// Fail loud, but only once UI work actually shows up, so non-UI
			// sessions stay quiet.
			ctx.ui.setStatus("xias", "kit incomplete");
		} else {
			ctx.ui.setStatus("xias", undefined);
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		ctx.ui.setStatus("xias", undefined);
		state = freshState();
	});

	pi.on("before_agent_start", (event, ctx) => {
		const prompt = event.prompt || "";
		const lower = prompt.toLowerCase();
		const modeBefore = state.mode;

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
		// the prompt that triggered it carries no UI keyword.
		if (!UI_RE.test(prompt) && state.mode === modeBefore) return;

		if (state.kitWarning && !state.warnedKit) {
			state.warnedKit = true;
			ctx.ui.notify(`[xias-enforcer] ${state.kitWarning}`, "warning");
		}

		if (!state.nudgedModes.has(state.mode)) {
			state.nudgedModes.add(state.mode);
			event.systemPromptOptions.promptGuidelines.push(
				routingGuideline(state.mode),
			);
		}
	});

	pi.on("tool_call", (event) => {
		if (event.toolName === "write" || event.toolName === "edit") {
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
				`[xias-enforcer] gates missing but the run cannot continue: ${missing.join("; ")}`,
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
					customType: "xias-gate-reminder",
					content: reminder(state, missing),
					display: true,
				},
			],
		};
	});

	pi.registerCommand("xias-status", {
		description: "Show xias-enforcer mode, edited UI files, and gates seen",
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
			ctx.ui.notify(`[xias-enforcer]\n${lines.join("\n")}`, "info");
		},
	});
}
