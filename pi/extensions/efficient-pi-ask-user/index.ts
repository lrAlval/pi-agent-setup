/**
 * efficient-pi-ask-user — local fork of rpiv-ask-user-question 2.12.0 (MIT).
 * Registers the `ask_user_question` tool: a structured option selector with
 * an automatically appended `Type something.` custom-answer row.
 *
 * Fork deltas vs upstream (see FORK_OVERRIDES.md):
 * - every former hardcoded cap (questions, options, lengths, flags) is read
 *   from `efficient-pi-ask-user.json` — defaults: 6 questions, 2-4 options
 * - lean-style compact declaration by default (stripped schema descriptions,
 *   one-line tool description, empty prompt snippet, single guideline)
 * - zero npm dependencies: own config loader, English-only UI
 *   (locales/ kept on disk should an i18n SDK ever be wired back in).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAskUserQuestionTool } from "./ask-user-question.js";
import { registerAskUserQuestionReconciler } from "./reconcile.js";

export {
	ASK_USER_BLOCKED_EVENT,
	ASK_USER_PROMPT_EVENT,
	type AskUserBlockedEventPayload,
	type AskUserPromptEventPayload,
	type AskUserPromptOption,
	type AskUserPromptQuestion,
} from "./events.js";

export default function (pi: ExtensionAPI) {
	registerAskUserQuestionTool(pi);
	registerAskUserQuestionReconciler(pi);
}
