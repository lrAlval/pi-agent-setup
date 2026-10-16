// Verification for apply-omp-theme-plan-complete.mjs. Run:
//   node /home/aiden/.pi/agent/patches/verify-omp-theme-plan-complete.mjs
// Fails loud (non-zero + reason) on any miss. Pass line for the guard:
//   "OMP PLAN-COMPLETE ASSERTIONS PASSED"
// Test override: OMP_THEME_FILE=/tmp/copy.ts.
import { readFileSync, existsSync } from "node:fs";

const FILE = process.env.OMP_THEME_FILE ??
  "/home/aiden/.pi/agent/npm/node_modules/@nguyenquangthai/pi-omp-theme/dist/extensions/pi-omp-theme.ts";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} [${label}]${detail ? " - " + detail : ""}`);
  if (!ok) failures++;
};

if (!existsSync(FILE)) {
  console.error(`FAIL [target exists] - ${FILE} missing`);
  process.exit(1);
}
const text = readFileSync(FILE, "utf8");
check("marker present", text.includes("isPlanCompleteFull"));
check("signature renamed", text.includes("function renderFallbackResult(toolName, result, options, theme, context)"));
check("full budget", text.includes('const isPlanCompleteFull = toolName === "plan_mode_complete" && !options.isPartial'));
check("Infinity budget", text.includes("const maxLines = isPlanCompleteFull ? Infinity"));
check("expand hint gated", text.includes("!expanded && !isPlanCompleteFull && omitted > 0"));
check("line budget gated", text.includes("...isPlanCompleteFull ? {} : { renderLineBudget: maxLines }"));
check("inline delegation passes tool", text.includes("return renderInlineFallbackResult(result, options, theme, context, toolName)"));
check("inline signature takes tool", text.includes("function renderInlineFallbackResult(result, options, theme, context, toolName)"));
check("inline budget bypass", text.includes("inlinePreview(output, isPlanCompleteFull ? Infinity"));
check("no stale signature", !text.includes("function renderFallbackResult(_toolName,"));
check("single gate", text.split("isPlanCompleteFull").length - 1 === 7,
  `found ${text.split("isPlanCompleteFull").length - 1} occurrences, want 7`);

if (failures) {
  console.error(`verify-omp-theme-plan-complete: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("OMP PLAN-COMPLETE ASSERTIONS PASSED");
