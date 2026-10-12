// pi-agent-setup patch v4 for @narumitw/pi-plan-mode (local bundle, NOT upstream).
// Re-run after updates:  node /home/aiden/.pi/agent/patches/fix-plan-mode-v4.mjs
// Requires v3 patch. Idempotent via newStr/marker presence. Fails loud on drift.
import { readFileSync, readdirSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
function resolvePolicyChunk() {
  const root = typeof PKG === "string" ? PKG : "/home/aiden/.pi/agent/npm/node_modules/@narumitw/pi-plan-mode";
  const dir = root + "/dist/chunks";
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".ts")) continue;
    const t = readFileSync(dir + "/" + f, "utf8");
    if (t.includes("matchesConfiguredSafeSubcommand") && t.includes("function findBlockedCommandSegment")) return dir + "/" + f;
  }
  throw new Error("pi-plan-mode policy chunk not found under " + dir);
}
const CHUNK = resolvePolicyChunk();
const MARK_V4 = "pi-agent-setup patch v4: wildcard subcommands + gh RO validators + git extend";
const EDITS = [
 [
  "gh ro validators",
  "\nvar GH_VALIDATORS = {",
  "\nvar isUnsafeGhMutationArg = function(argument) {\n  if (isUnsafeGhReadArgument(argument)) return true;\n  const l = argument.toLowerCase();\n  return argument === \"-f\" || argument === \"-F\" || l === \"--field\" || l.startsWith(\"--field=\") || l === \"--input\" || l.startsWith(\"--input=\") || argument === \"-X\" || l === \"--method\" || l.startsWith(\"--method=\") || l === \"--project\" || l.startsWith(\"--project=\");\n};\nvar isSafeGhReadOnlyArgs = function(args) {\n  for (const a of args) if (isUnsafeGhMutationArg(a)) return false;\n  return true;\n};\nvar isSafeGhApiArgs = function(args) {\n  for (const a of args) if (a === \"--field\" || a === \"--input\" || a === \"--method\") return false;\n  for (const a of args) if (typeof a === \"string\" && /^(-f|-F|-X|--method=|--field=|--input=)/u.test(a)) return false;\n  return true;\n};\nvar GH_RO_LIST = [\n  \"alias\", \"auth status\", \"cache list\", \"codespace list\", \"config get\", \"config list\",\n  \"gist list\", \"gist view\", \"issue status\", \"label list\", \"licenses\", \"org list\", \"pr checks\",\n  \"pr diff\", \"pr status\", \"project field-list\", \"project item-list\", \"project list\", \"project view\",\n  \"release list\", \"release view\", \"repo list\", \"repo view\", \"ruleset list\", \"ruleset view\",\n  \"run list\", \"run view\", \"run watch\", \"search\", \"secret list\", \"skill list\", \"ssh-key list\",\n  \"status\", \"variable list\", \"version\", \"workflow list\", \"workflow view\", \"extension list\", \"extension search\", \"help\", \"gpg-key list\"\n];\nvar GH_RO_VALIDATORS = {};\nfor (const ghPath of GH_RO_LIST) GH_RO_VALIDATORS[ghPath] = isSafeGhReadOnlyArgs;\nGH_RO_VALIDATORS[\"api\"] = isSafeGhApiArgs;\nvar GH_VALIDATORS = {",
  "\"workflow view\", \"extension list\", \"extension search\", \"help\", \"gpg-key list\""
 ],
 [
  "gh lookup",
  "const validator = GH_VALIDATORS[path];",
  "const validator = GH_VALIDATORS[path] ?? GH_RO_VALIDATORS[path];",
  "?? GH_RO_VALIDATORS[path1];"
 ],
 [
  "git validators",
  "var CONFIGURABLE_GIT_VALIDATORS = {\n  \"rev-parse\": allowReadOnlyArguments,\n  blame: allowReadOnlyArguments,\n  describe: allowReadOnlyArguments,\n  \"merge-base\": allowReadOnlyArguments,\n  \"ls-tree\": allowReadOnlyArguments,\n  \"cat-file\": isSafeGitCatFileArguments\n};",
  "var isSafeGitTagArgs = function(args) {\n  if (args.includes(\"-l\") || args.includes(\"--list\")) return true;\n  return !args.some((a) => !a.startsWith(\"-\"));\n};\nvar isSafeGitStashArgs = function(args) {\n  if (args[0] !== \"list\") return false;\n  return !args.slice(1).some((a) => !a.startsWith(\"-\"));\n};\nvar isSafeGitWorktreeArgs = function(args) {\n  return args[0] === \"list\";\n};\nvar CONFIGURABLE_GIT_VALIDATORS = {\n  \"rev-parse\": allowReadOnlyArguments,\n  blame: allowReadOnlyArguments,\n  describe: allowReadOnlyArguments,\n  \"merge-base\": allowReadOnlyArguments,\n  \"ls-tree\": allowReadOnlyArguments,\n  \"cat-file\": isSafeGitCatFileArguments,\n  \"ls-remote\": allowReadOnlyArguments,\n  tag: isSafeGitTagArgs,\n  stash: isSafeGitStashArgs,\n  worktree: isSafeGitWorktreeArgs\n};",
  "\"ls-remote\": allowReadOnlyArguments,"
 ],
 [
  "configurable list",
  "var CONFIGURABLE_SAFE_GIT_SUBCOMMANDS = [\n  \"rev-parse\",\n  \"blame\",\n  \"describe\",\n  \"merge-base\",\n  \"ls-tree\",\n  \"cat-file\"\n];",
  "var CONFIGURABLE_SAFE_GIT_SUBCOMMANDS = [\n  \"rev-parse\",\n  \"blame\",\n  \"describe\",\n  \"merge-base\",\n  \"ls-tree\",\n  \"cat-file\",\n  \"ls-remote\",\n  \"tag\",\n  \"stash\",\n  \"worktree\"\n];",
  "  \"worktree\""
 ],
 [
  "matcher skip git/gh",
  "    ([configuredCommand, subcommands]) => subcommands?.some((subcommand) => {\n      const isWild = subcommand.trim() === \"*\";",
  "    ([configuredCommand, subcommands]) => subcommands?.some((subcommand) => {\n      if (configuredCommand.trim() === \"git\" || configuredCommand.trim() === \"gh\") return false;\n      const isWild = subcommand.trim() === \"*\";",
  "if (configuredCommand.trim() === \"git\" || configuredCommand.trim() === \"gh\") return false;"
 ],
 [
  "matcher wildcard fix",
  "      const isWild = subcommand.trim() === \"*\";\n      const prefix = isWild ? `${configuredCommand.trim()} ` : `${configuredCommand.trim()} ${subcommand.trim()}`;\n      if (!configuredCommand.trim() || (!subcommand.trim() && !isWild) || !candidate.startsWith(prefix)) {\n        return false;\n      }\n      const boundary = candidate[prefix.length];\n      return boundary === void 0 || /[\\s;&|<>()]/.test(boundary);",
  "      const cmdTrim = configuredCommand.trim();\n      if (!cmdTrim) return false;\n      if (subcommand.trim() === \"*\") return candidate === cmdTrim || candidate.startsWith(`${cmdTrim} `);\n      if (!subcommand.trim()) return false;\n      const prefix = `${cmdTrim} ${subcommand.trim()}`;\n      if (!candidate.startsWith(prefix)) return false;\n      const boundary = candidate[prefix.length];\n      return boundary === void 0 || /[\\s;&|<>()]/.test(boundary);",
  "if (subcommand.trim() === \"*\") return candidate === cmdTrim"
 ],
 [
  "gh single-word + fallback",
  "  const group = args[0]?.toLowerCase();\n  if (!group || group.startsWith(\"-\")) return false;\n  if (!args[1] || args[1].startsWith(\"-\")) {\n    const path1 = group;\n    if (!safeSubcommands.gh?.includes(path1)) return false;\n    const validator1 = GH_VALIDATORS[path1] ?? GH_RO_VALIDATORS[path1];\n    return validator1?.(args.slice(1)) ?? false;\n  }\n  const action = args[1].toLowerCase();\n  if (action.startsWith(\"-\")) return false;\n  const path = `${group} ${action}`;\n  if (!safeSubcommands.gh?.includes(path)) return false;\n  const validator = GH_VALIDATORS[path] ?? GH_RO_VALIDATORS[path];\n  return validator?.(args.slice(2)) ?? false;",
  "  const group = args[0]?.toLowerCase();\n  if (!group || group.startsWith(\"-\")) return false;\n  if (!args[1] || args[1].startsWith(\"-\")) {\n    const path1 = group;\n    if (!safeSubcommands.gh?.includes(path1)) return false;\n    const validator1 = GH_VALIDATORS[path1] ?? GH_RO_VALIDATORS[path1];\n    return validator1?.(args.slice(1)) ?? false;\n  }\n  const action = args[1].toLowerCase();\n  if (action.startsWith(\"-\")) return false;\n  const path = `${group} ${action}`;\n  const validator = safeSubcommands.gh?.includes(path) ? (GH_VALIDATORS[path] ?? GH_RO_VALIDATORS[path]) : undefined;\n  if (validator) return validator(args.slice(2));\n  const path1 = group;\n  if (!safeSubcommands.gh?.includes(path1)) return false;\n  const validator1 = GH_VALIDATORS[path1] ?? GH_RO_VALIDATORS[path1];\n  return validator1?.(args.slice(1)) ?? false;"
 ],
 [
  "glob tolerance git/gh",
  "  if (hasShellExpansion(segment, READ_ONLY_COMMANDS.has(command))) {\n    return false;\n  }",
  "  if (hasShellExpansion(segment, READ_ONLY_COMMANDS.has(command) || command === \"git\" || command === \"gh\")) {\n    return false;\n  }",
  "READ_ONLY_COMMANDS.has(command) || command === \"git\" || command === \"gh\""
 ]
];
let text = readFileSync(CHUNK, "utf8");
if (!text.includes("pi-agent-setup patch v3")) { console.error("v3 patch missing"); process.exit(1); }
let missed = [];
let appliedAny = false;
for (const [label, oldStr, newStr, marker] of EDITS) {
  if (text.includes(newStr) || (marker && text.includes(marker))) { console.log("already [" + label + "]"); continue; }
  const n = text.split(oldStr).length - 1;
  if (n !== 1) { missed.push(label + "(" + n + ")"); continue; }
  text = text.replace(oldStr, newStr);
  appliedAny = true;
  console.log("applied [" + label + "]");
}
if (missed.length) {
  for (const m of missed) console.error("MISS " + m);
  if (appliedAny) { console.error("partial: wrote applied subset only"); }
  else { console.error("no edits applied; NOT WRITTEN"); process.exit(1); }
}
if (!existsSync(CHUNK + ".v4orig")) copyFileSync(CHUNK, CHUNK + ".v4orig");
writeFileSync(CHUNK, text);
console.log("patched (v4): " + CHUNK);
