// Local patch for @nguyenquangthai/pi-omp-theme (installed bundle, NOT upstream).
// Re-run after every `npm update` / reinstall of the package:
//   node /home/aiden/.pi/agent/patches/apply-omp-theme-plan-complete.mjs
// Idempotent: exits 0 with "already patched" when the marker is present.
// Fails loud (non-zero + which pattern missed) on version drift — the caller
// (local-patch-guard) treats that as drift: record only, never patch blind.
//
// Intent (orphan omp-theme patch, still wanted): plan_mode_complete in full
// (non-partial) mode renders the ENTIRE plan output instead of truncating to
// MAX_FALLBACK_PREVIEW_LINES. Source: pi-omp-theme-plan-complete-result.patch.
// Test override: OMP_THEME_FILE=/tmp/copy.ts (used by the wipe drill).
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";

const FILE = process.env.OMP_THEME_FILE ??
  "/home/aiden/.pi/agent/npm/node_modules/@nguyenquangthai/pi-omp-theme/dist/extensions/pi-omp-theme.ts";

const MARK = "isPlanCompleteFull";

const EDITS = [
  ["func-signature",
    "function renderFallbackResult(_toolName, result, options, theme, context) {",
    "function renderFallbackResult(toolName, result, options, theme, context) {"],
  ["full-budget",
    "  const maxLines = expanded ? getToolsRenderConfig().maxExpandedLines : MAX_FALLBACK_PREVIEW_LINES;",
    `  const isPlanCompleteFull = toolName === "plan_mode_complete" && !options.isPartial;\n  const maxLines = isPlanCompleteFull ? Infinity : expanded ? getToolsRenderConfig().maxExpandedLines : MAX_FALLBACK_PREVIEW_LINES;`],
  ["expand-hint",
    '  const expandHint = !expanded && omitted > 0 ? toolExpandHint() : "";',
    '  const expandHint = !expanded && !isPlanCompleteFull && omitted > 0 ? toolExpandHint() : "";'],
  ["line-budget",
    "      renderLineBudget: maxLines,",
    "      ...isPlanCompleteFull ? {} : { renderLineBudget: maxLines },"],
  ["inline-delegation",
    "  if (isInlineChrome()) return renderInlineFallbackResult(result, options, theme, context);",
    "  if (isInlineChrome()) return renderInlineFallbackResult(result, options, theme, context, toolName);"],
  ["inline-signature",
    "function renderInlineFallbackResult(result, options, theme, context) {",
    "function renderInlineFallbackResult(result, options, theme, context, toolName) {"],
  ["inline-budget",
    "  const { rows, omitted } = inlinePreview(output, expanded ? config.maxExpandedLines : config.maxCollapsedLines);",
    `  const isPlanCompleteFull = toolName === "plan_mode_complete" && !options.isPartial;\n  const { rows, omitted } = inlinePreview(output, isPlanCompleteFull ? Infinity : expanded ? config.maxExpandedLines : config.maxCollapsedLines);`],
];

if (!existsSync(FILE)) {
  console.error(`apply-omp-theme-plan-complete: target not found: ${FILE}`);
  process.exit(1);
}
let text = readFileSync(FILE, "utf8");

// Dry-run gate first: every hunk must match either its old (stock) or new
// (patched) form. Anything else = upstream drift -> record only, exit non-zero.
const drifted = EDITS.filter(([label, oldStr, newStr]) =>
  !text.includes(oldStr) && !text.includes(newStr)).map(([label]) => label);
if (drifted.length) {
  console.error(`apply-omp-theme-plan-complete: DRIFT, no change made (unmatched: ${drifted.join(", ")})`);
  process.exit(1);
}
if (EDITS.every(([, , newStr]) => text.includes(newStr))) {
  console.log("already patched");
  process.exit(0);
}
if (!existsSync(FILE + ".orig")) copyFileSync(FILE, FILE + ".orig");
for (const [label, oldStr, newStr] of EDITS) {
  if (text.includes(newStr)) { console.log(`already [${label}]`); continue; }
  text = text.replace(oldStr, newStr);
}
writeFileSync(FILE, text);
console.log("patched isPlanCompleteFull (plan_mode_complete full render)");
