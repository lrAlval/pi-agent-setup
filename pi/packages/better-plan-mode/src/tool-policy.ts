import { isAbsolute, normalize } from "node:path";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";

export const BUILTIN_SAFE_GIT_SUBCOMMANDS = [
  "status",
  "log",
  "diff",
  "show",
  "branch",
  "remote",
  "ls-files",
  "grep",
] as const;
export const CONFIGURABLE_SAFE_GIT_SUBCOMMANDS = [
  "rev-parse",
  "blame",
  "describe",
  "merge-base",
  "ls-tree",
  "cat-file",
  "ls-remote",
  "tag",
  "stash",
  "worktree",
] as const;
export const SAFE_GIT_SUBCOMMANDS = [...BUILTIN_SAFE_GIT_SUBCOMMANDS, ...CONFIGURABLE_SAFE_GIT_SUBCOMMANDS] as const;
export const SAFE_GH_SUBCOMMAND_PATHS = ["pr view", "pr list", "issue view", "issue list"] as const;

export type BuiltinSafeGitSubcommand = (typeof BUILTIN_SAFE_GIT_SUBCOMMANDS)[number];
export type ConfigurableSafeGitSubcommand = (typeof CONFIGURABLE_SAFE_GIT_SUBCOMMANDS)[number];
export type SafeGitSubcommand = (typeof SAFE_GIT_SUBCOMMANDS)[number];
export type SafeGhSubcommandPath = (typeof SAFE_GH_SUBCOMMAND_PATHS)[number];
export interface SafeSubcommands {
  [command: string]: string[] | undefined;
}

export const SAFE_BUILTIN_PLAN_TOOLS = new Set(["read", "bash", "powershell", "grep", "find", "ls"]);
export type PlanModeToolPolicy = "read-only" | "limited" | "user-opt-in" | "blocked";

const BLOCKED_BUILTIN_TOOLS = new Set(["edit", "write"]);
const MUTATING_COMMANDS = new Set([
  "rm",
  "rmdir",
  "mv",
  "cp",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "chgrp",
  "ln",
  "tee",
  "truncate",
  "dd",
  "sudo",
  "su",
  "kill",
  "pkill",
  "killall",
  "reboot",
  "shutdown",
  "vim",
  "vi",
  "nano",
  "emacs",
  "code",
  "subl",
]);
const READ_ONLY_POWERSHELL_COMMANDS = new Set([
  "format-list",
  "format-table",
  "get-childitem",
  "get-content",
  "get-item",
  "get-location",
  "measure-object",
  "out-string",
  "resolve-path",
  "select-string",
  "sort-object",
  "test-path",
  "write-output",
]);
const READ_ONLY_COMMANDS = new Set([
  "cat",
  "head",
  "tail",
  "grep",
  "find",
  "ls",
  "pwd",
  "echo",
  "printf",
  "wc",
  "sort",
  "uniq",
  "diff",
  "file",
  "stat",
  "du",
  "df",
  "tree",
  "which",
  "whereis",
  "type",
  "printenv",
  "uname",
  "whoami",
  "id",
  "date",
  "uptime",
  "ps",
  "jq",
  "rg",
  "fd",
  "bat",
  "eza",
  "command",
  "tr",
  "cut",
  "paste",
  "column",
  "expand",
  "seq",
  "nl",
  "tac",
  "cmp",
  "od",
  "xxd",
  "strings",
  "sha256sum",
  "md5sum",
  "sha1sum",
  "sha512sum",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "env",
  "ss",
]);
// `env`/`command` only become read-only when they cannot delegate to another
// program: `env FOO=bar` prints the environment, `env FOO=bar rm -rf x` runs
// rm, and `command name` executes name while `command -v name` only resolves it.
// `ss -K` destroys sockets, so its query-only forms stay read-only.
export function isSafeReadOnlyArguments(command: string, args: string[]) {
  if (command === "env") {
    return args.every((argument) => argument.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(argument));
  }
  if (command === "command") {
    return args.length > 0 && args.every((argument) => ["-v", "-V", "-p", "--"].includes(argument));
  }
  if (command === "ss") {
    return !args.some((argument) => argument === "-K" || argument.startsWith("--kill"));
  }
  return true;
}

// `-i` edits in place for sed. For these inspection commands it is case-insensitive
// search or inode output, which is how plan mode reads markdown and other text.
const INSPECTION_CASE_FLAG_COMMANDS = new Set(["rg", "grep", "git", "diff", "fd", "ls", "sort", "find", "bat", "eza"]);

export function isBuiltinTool(tool: ToolInfo) {
  const source = tool.sourceInfo;
  if (source?.source !== "builtin") return false;
  // Core tools own builtin:<name>; built-in extensions may own many tools or
  // expose model-only orchestration. Missing paths preserve legacy core policy.
  return !source.path || (source.path === `builtin:${tool.name}` && tool.exposure !== "model-only");
}

export function classifyPlanModeTool(tool: ToolInfo): PlanModeToolPolicy {
  if (!tool.sourceInfo?.source) return "blocked";
  if (!isBuiltinTool(tool)) return "user-opt-in";
  if (BLOCKED_BUILTIN_TOOLS.has(tool.name)) return "blocked";
  if (tool.name === "bash" || tool.name === "powershell") return "limited";
  return SAFE_BUILTIN_PLAN_TOOLS.has(tool.name) ? "read-only" : "blocked";
}

export function canSelectToolInPlanMode(tool: ToolInfo) {
  return classifyPlanModeTool(tool) !== "blocked";
}

export function readCommand(input: unknown) {
  const command = input as { command?: unknown } | undefined;
  return typeof command?.command === "string" ? command.command : "";
}

// Plan mode yolo bash gate: `"bashMode": "yolo"` in pi-plan-mode.json replaces
// the read-only policy with a denylist so only genuinely destructive commands
// block. Absent or "safe" keeps the default policy above. `local_bash` and the
// Pi permission system are untouched by this switch.
export const YOLO_NOTICE = "plan mode yolo: destructive - ask the user";
const YOLO_BLOCKED_COMMANDS = new Set([
  "rm",
  "rmdir",
  "dd",
  "mkfs",
  "sudo",
  "su",
  "kill",
  "pkill",
  "killall",
  "reboot",
  "shutdown",
  "halt",
  "poweroff",
  "truncate",
  "chmod",
  "chown",
  "chgrp",
  "mv",
]);
const YOLO_SHELL_KEYWORDS = new Set([
  "for",
  "while",
  "until",
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "do",
  "done",
  "in",
  "case",
  "esac",
  "function",
  "time",
  "coproc",
  "select",
]);

function isYoloBlockedGit(args: string[]) {
  const rest: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    // `-C <dir>` only changes the working tree, which is not a write in itself,
    // so it stays transparent and the verb check below still applies.
    if (args[index] === "-C") {
      index += 1;
      continue;
    }
    rest.push(args[index] ?? "");
  }
  const subcommand = (rest.find((argument) => !argument.startsWith("-")) ?? "").toLowerCase();
  if (subcommand === "push" && rest.some((argument) => ["--force", "-f", "--delete"].includes(argument))) {
    return true;
  }
  if (subcommand === "reset" && rest.includes("--hard")) return true;
  if (subcommand === "clean") return true;
  if (subcommand === "checkout" && rest.includes("--")) return true;
  if (subcommand === "branch" && rest.includes("-D")) return true;
  return false;
}

function isYoloBlockedSegment(segment: string) {
  const tokens = shellWords(segment);
  if (!tokens || tokens.length === 0) return true;
  let index = 0;
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? "")) index += 1;
  if (index >= tokens.length) return false;
  const command = (tokens[index] ?? "").toLowerCase().split("/").pop();
  if (!command) return true;
  if (YOLO_SHELL_KEYWORDS.has(command)) return false;
  if (YOLO_BLOCKED_COMMANDS.has(command)) return true;
  if (command === "git") return isYoloBlockedGit(tokens.slice(index + 1));
  return false;
}

// Returns the offending segment (prefixed with the yolo notice) or undefined.
// Unparseable input blocks with the whole command, matching the safe policy.
export function findYoloBlockedSegment(command: string): string | undefined {
  const segments = splitShellSegments(command);
  if (!segments || segments.length === 0) return command.trim() || "(empty command)";
  const hit = segments.find((segment) => isYoloBlockedSegment(segment));
  return hit === undefined ? undefined : `${YOLO_NOTICE}: ${hit}`;
}

export function findBlockedCommandSegment(
  command: string,
  safeSubcommands: SafeSubcommands = {},
  workingDirectory?: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const segments = splitShellSegments(command);
  if (!segments || segments.length === 0) return command.trim() || "(empty command)";
  return segments.find((segment) => !isSafeSegment(segment, safeSubcommands, workingDirectory, platform));
}

export function isSafeCommand(
  command: string,
  safeSubcommands: SafeSubcommands = {},
  workingDirectory?: string,
  platform: NodeJS.Platform = process.platform,
) {
  return findBlockedCommandSegment(command, safeSubcommands, workingDirectory, platform) === undefined;
}

export function findBlockedPowerShellCommandSegment(
  command: string,
  safeSubcommands: SafeSubcommands = {},
  workingDirectory?: string,
): string | undefined {
  const segments = splitPowerShellSegments(command);
  if (!segments || segments.length === 0) return command.trim() || "(empty command)";
  return segments.find((segment) => !isSafePowerShellSegment(segment, safeSubcommands, workingDirectory));
}

export function isSafePowerShellCommand(
  command: string,
  safeSubcommands: SafeSubcommands = {},
  workingDirectory?: string,
) {
  return findBlockedPowerShellCommandSegment(command, safeSubcommands, workingDirectory) === undefined;
}

function matchesConfiguredSafeSubcommand(command: string, safeSubcommands: SafeSubcommands) {
  const candidate = command.trimStart();
  return Object.entries(safeSubcommands).some(([configuredCommand, subcommands]) => {
    const commandName = configuredCommand.trim();
    if (!commandName) return false;
    // git and gh always run through their own argument validators, so a wildcard
    // configured for them would bypass every verb check.
    if (commandName === "git" || commandName === "gh") return false;
    return subcommands?.some((subcommand) => {
      const subcommandName = subcommand.trim();
      if (subcommandName === "*") return candidate === commandName || candidate.startsWith(`${commandName} `);
      if (!subcommandName) return false;
      const prefix = `${commandName} ${subcommandName}`;
      if (!candidate.startsWith(prefix)) return false;
      const boundary = candidate[prefix.length];
      return boundary === undefined || /[\s;&|<>()]/.test(boundary);
    });
  });
}

function splitPowerShellSegments(command: string): string[] | undefined {
  const trimmed = command.trim();
  if (!trimmed || /[\n\r`\u2018-\u201e]/.test(trimmed)) return undefined;

  const segments: string[] = [];
  let quote: "'" | '"' | undefined;
  let start = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (quote === "'") {
      if (character !== "'") continue;
      if (trimmed[index + 1] === "'") {
        index += 1;
        continue;
      }
      quote = undefined;
      continue;
    }
    if (quote === '"') {
      if (character === "$" || character === "`") return undefined;
      if (character === '"') quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (["$", "@", "#", "!", "?", "{", "}", "(", ")", "[", "]", ">", "<"].includes(character)) {
      return undefined;
    }
    const next = trimmed[index + 1];
    if (character === "&" || (character === "|" && next === "|")) return undefined;
    const separatorLength = character === ";" || character === "|" ? 1 : 0;
    if (separatorLength === 0) continue;
    const segment = trimmed.slice(start, index).trim();
    if (!segment) return undefined;
    segments.push(segment);
    index += separatorLength - 1;
    start = index + 1;
  }
  if (quote) return undefined;
  const finalSegment = trimmed.slice(start).trim();
  if (!finalSegment) return undefined;
  segments.push(finalSegment);
  return segments;
}

function isSafePowerShellSegment(segment: string, safeSubcommands: SafeSubcommands, workingDirectory?: string) {
  if (matchesConfiguredSafeSubcommand(segment, safeSubcommands)) return true;
  const tokens = powerShellWords(segment);
  if (!tokens || tokens.length === 0 || tokens.includes("--%")) return false;
  const command = tokens[0]?.toLowerCase();
  if (!command) return false;
  const args = tokens.slice(1);
  if (READ_ONLY_POWERSHELL_COMMANDS.has(command)) return true;
  if (command === "get-process") return isSafeGetProcessArguments(args);
  if (command === "get-service") return isSafeGetServiceArguments(args);
  if (command !== "git" && command !== "gh") return false;
  return isSafeStructuredCommand(command, args, safeSubcommands, workingDirectory);
}

function powerShellWords(segment: string): string[] | undefined {
  const words: string[] = [];
  let word = "";
  let hasWord = false;
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index];
    if (quote === "'") {
      if (character !== "'") {
        word += character;
        continue;
      }
      if (segment[index + 1] === "'") {
        word += "'";
        index += 1;
        continue;
      }
      quote = undefined;
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = undefined;
      else word += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      hasWord = true;
    } else if (/\s/.test(character)) {
      if (hasWord) words.push(word);
      word = "";
      hasWord = false;
    } else {
      word += character;
      hasWord = true;
    }
  }
  if (quote) return undefined;
  if (hasWord) words.push(word);
  return words;
}

// Redirections that cannot write anywhere meaningful (`> /dev/null`) and file
// descriptor dups/closes are stripped before the policy checks so a harmless
// `cmd > /dev/null` stays runnable. Any other redirect target or an operator we
// do not recognise returns ok:false, which blocks the command.
function stripRedirections(command: string): { ok: true; text: string } | { ok: false } {
  const out: string[] = [];
  let index = 0;
  let quote: "'" | '"' | undefined;
  let escaped = false;
  while (index < command.length) {
    const character = command[index];
    if (escaped) {
      out.push(character ?? "");
      escaped = false;
      index += 1;
      continue;
    }
    if (quote === "'") {
      out.push(character ?? "");
      if (character === "'") quote = undefined;
      index += 1;
      continue;
    }
    if (quote === '"') {
      out.push(character ?? "");
      if (character === "\\" && index + 1 < command.length) {
        out.push(command[index + 1] ?? "");
        index += 2;
        continue;
      }
      if (character === '"') quote = undefined;
      index += 1;
      continue;
    }
    if (character === "\\") {
      out.push(character);
      escaped = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      out.push(character);
      index += 1;
      continue;
    }
    const isRedirection = character === "<" || character === ">" || (character === "&" && command[index + 1] === ">");
    if (!isRedirection) {
      out.push(character ?? "");
      index += 1;
      continue;
    }
    let descriptorLength = 0;
    let before = index - 1;
    while (before >= 0 && /[0-9]/.test(command[before] ?? "")) {
      descriptorLength += 1;
      before -= 1;
    }
    const preceding = before < 0 ? " " : (command[before] ?? "");
    if (!(descriptorLength > 0 && [" ", "\t", ";", "|", "&", "("].includes(preceding))) {
      descriptorLength = 0;
    }
    const spanStart = index - descriptorLength;
    let operator = "";
    while (index < command.length && ["<", ">", "&"].includes(command[index] ?? "")) {
      operator += command[index] ?? "";
      index += 1;
    }
    if (command[index] === "-" && operator.includes("&")) {
      operator += "-";
      index += 1;
    }
    if (!["<", ">", ">>", "<<", ">&", "<&", "<>", "&>", "&>>", ">&-", "<&-"].includes(operator)) {
      return { ok: false };
    }
    let targetStart = index;
    while (targetStart < command.length && (command[targetStart] === " " || command[targetStart] === "\t")) {
      targetStart += 1;
    }
    if (targetStart >= command.length) return { ok: false };
    let target = "";
    const targetQuote = command[targetStart];
    if (targetQuote === "'" || targetQuote === '"') {
      let cursor = targetStart + 1;
      let closed = false;
      let targetEscaped = false;
      while (cursor < command.length) {
        const current = command[cursor] ?? "";
        if (targetEscaped) {
          target += current;
          targetEscaped = false;
          cursor += 1;
          continue;
        }
        if (targetQuote === '"' && current === "\\") {
          targetEscaped = true;
          cursor += 1;
          continue;
        }
        if (current === targetQuote) {
          closed = true;
          cursor += 1;
          break;
        }
        target += current;
        cursor += 1;
      }
      if (!closed) return { ok: false };
      targetStart = cursor;
    } else {
      if (targetQuote === "(" || targetQuote === ")") return { ok: false };
      let cursor = targetStart;
      while (cursor < command.length && !" \t;|&()<>'\"".includes(command[cursor] ?? "")) cursor += 1;
      if (cursor === targetStart) return { ok: false };
      target = command.slice(targetStart, cursor);
      if (target.includes("(") || target.includes(")")) return { ok: false };
      targetStart = cursor;
    }
    if (target.startsWith("/dev/") && target !== "/dev/null") return { ok: false };
    const isDescriptorClose = operator === ">&-" || operator === "<&-";
    const isDescriptorDup = operator === ">&" || operator === "<&";
    if (isDescriptorDup && !/^[0-9]+$/.test(target)) return { ok: false };
    if (!isDescriptorClose && !isDescriptorDup && target !== "/dev/null") return { ok: false };
    out.length = spanStart;
    for (let padded = spanStart; padded < targetStart; padded += 1) out.push(" ");
    index = targetStart;
  }
  if (quote !== undefined || escaped) return { ok: false };
  return { ok: true, text: out.join("") };
}

function splitShellSegments(command: string): string[] | undefined {
  const pre = stripRedirections(command);
  if (!pre.ok) return undefined;
  const trimmed = pre.text.trim();
  if (!trimmed || /[\n\r`]/.test(trimmed)) return undefined;

  const segments: string[] = [];
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === ">" || character === "<" || character === "(" || character === ")") {
      return undefined;
    }
    const next = trimmed[index + 1];
    if (character === "&" && next !== "&") return undefined;
    const separatorLength =
      character === ";" || character === "|" ? (next === character ? 2 : 1) : character === "&" && next === "&" ? 2 : 0;
    if (separatorLength === 0) continue;
    const segment = trimmed.slice(start, index).trim();
    if (!segment) return undefined;
    segments.push(segment);
    index += separatorLength - 1;
    start = index + 1;
  }
  if (quote || escaped) return undefined;
  const finalSegment = trimmed.slice(start).trim();
  if (!finalSegment) return undefined;
  segments.push(finalSegment);
  return segments;
}

function isSafeSegment(
  segment: string,
  safeSubcommands: SafeSubcommands,
  workingDirectory: string | undefined,
  platform: NodeJS.Platform,
) {
  if (matchesConfiguredSafeSubcommand(segment, safeSubcommands)) return true;
  if (/(^|\s)[A-Za-z_][A-Za-z0-9_]*=/.test(segment)) {
    return false;
  }
  const tokens = shellWords(segment);
  if (!tokens || tokens.length === 0) return false;
  const command = tokens[0]?.toLowerCase().split("/").pop();
  if (!command || MUTATING_COMMANDS.has(command)) return false;
  if (
    hasShellExpansion(segment, {
      allowGlobs: READ_ONLY_COMMANDS.has(command) || command === "git" || command === "gh",
      // Configured git/gh subcommands used to be prefix-trusted with variables
      // such as $PI_PLAN_GH_ARGUMENTS, so their expansion stays accepted.
      allowSubstitutions: command === "git" || command === "gh",
    })
  ) {
    return false;
  }
  const args = tokens.slice(1);
  if (!hasSafeArguments(command, args)) return false;
  if (command === "hostname") return args.length === 0;
  if (command === "tasklist") return platform === "win32" && isSafeTasklistArguments(args);
  if (READ_ONLY_COMMANDS.has(command)) return isSafeReadOnlyArguments(command, args);
  return isSafeStructuredCommand(command, args, safeSubcommands, workingDirectory);
}

// Structural globs are tolerated for read-only inspection, and the documented
// $PI_PLAN_GH_ARGUMENTS/$PI_PLAN_GIT_ARGUMENTS variables are tolerated for git and
// gh (whose configuration used to prefix-trust them). Command substitution and
// every other $ expansion stay blocked: an un-reviewed expansion can turn an
// inspection command into a run of arbitrary flags or programs.
function hasShellExpansion(segment: string, options: { allowGlobs?: boolean; allowSubstitutions?: boolean } = {}) {
  const allowGlobs = options.allowGlobs === true;
  const allowSubstitutions = options.allowSubstitutions === true;
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else if (character === "$" && quote === '"') {
        if (segment[index + 1] === "(" || !allowSubstitutions) return true;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "$") {
      if (segment[index + 1] === "(" || !allowSubstitutions) return true;
      continue;
    }
    // Braces are not tolerated in glob mode: `{--output=x,HEAD}` is a brace
    // expansion that can synthesise an unsafe argument the token checks miss.
    if (allowGlobs && ["*", "?", "[", "]"].includes(character ?? "")) continue;
    if (["$", "*", "?", "[", "{"].includes(character ?? "")) return true;
  }
  return false;
}

function shellWords(segment: string): string[] | undefined {
  const words: string[] = [];
  let word = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (const character of segment) {
    if (escaped) {
      word += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else word += character;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (/\s/.test(character)) {
      if (word) words.push(word);
      word = "";
    } else word += character;
  }
  if (quote || escaped) return undefined;
  if (word) words.push(word);
  return words;
}

function hasSafeArguments(command: string, args: string[]) {
  const forbidden = new Set(["--in-place", "--fix", "--write", "-delete", "--delete"]);
  if (!INSPECTION_CASE_FLAG_COMMANDS.has(command)) forbidden.add("-i");
  if (args.some((argument) => forbidden.has(argument))) return false;
  if (
    command === "sed" &&
    args.some(
      (argument) => argument.startsWith("--in-place=") || (/^-[^-]+/.test(argument) && argument.slice(1).includes("i")),
    )
  ) {
    return false;
  }
  if (
    command === "find" &&
    args.some((argument) =>
      ["-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"].includes(argument),
    )
  ) {
    return false;
  }
  if (command === "date" && args.some((argument) => argument === "-s" || argument.startsWith("--set"))) {
    return false;
  }
  if (
    (command === "sort" || command === "tree") &&
    args.some(
      (argument) =>
        argument === "-o" ||
        (argument.startsWith("-o") && !argument.startsWith("--")) ||
        argument.startsWith("--output"),
    )
  ) {
    return false;
  }
  if (
    command === "sort" &&
    args.some(
      (argument) =>
        argument === "-T" ||
        (argument.startsWith("-T") && argument.length > 2) ||
        argument.startsWith("--temporary-directory") ||
        argument.startsWith("--compress-program"),
    )
  ) {
    return false;
  }
  if (command === "diff" && args.some((argument) => argument === "--output" || argument.startsWith("--output="))) {
    return false;
  }
  if (command === "uniq" && args.filter((argument) => !argument.startsWith("-")).length > 1) {
    return false;
  }
  if (
    command === "fd" &&
    args.some((argument) =>
      ["-x", "-X", "--exec", "--exec-batch"].some((flag) => argument === flag || argument.startsWith(`${flag}=`)),
    )
  ) {
    return false;
  }
  if (command === "rg" && args.some((argument) => argument === "--pre" || argument.startsWith("--pre="))) {
    return false;
  }
  if (command === "bat" && args.some((argument) => argument === "--pager" || argument.startsWith("--pager="))) {
    return false;
  }
  return true;
}

type ArgumentValidator = (args: string[]) => boolean;
const allowReadOnlyArguments: ArgumentValidator = () => true;
const BUILTIN_GIT_VALIDATORS: Record<BuiltinSafeGitSubcommand, ArgumentValidator> = {
  status: allowReadOnlyArguments,
  log: allowReadOnlyArguments,
  diff: allowReadOnlyArguments,
  show: allowReadOnlyArguments,
  branch: isSafeGitBranchArguments,
  remote: isSafeGitRemoteArguments,
  "ls-files": allowReadOnlyArguments,
  grep: isSafeGitGrepArguments,
};
const CONFIGURABLE_GIT_VALIDATORS: Record<ConfigurableSafeGitSubcommand, ArgumentValidator> = {
  "rev-parse": allowReadOnlyArguments,
  blame: allowReadOnlyArguments,
  describe: allowReadOnlyArguments,
  "merge-base": allowReadOnlyArguments,
  "ls-tree": allowReadOnlyArguments,
  "cat-file": isSafeGitCatFileArguments,
  "ls-remote": allowReadOnlyArguments,
  tag: isSafeGitTagArguments,
  stash: isSafeGitStashArguments,
  worktree: isSafeGitWorktreeArguments,
};
const GH_VALIDATORS: Record<SafeGhSubcommandPath, ArgumentValidator> = {
  "pr view": isSafeGhReadArguments,
  "pr list": isSafeGhReadArguments,
  "issue view": isSafeGhReadArguments,
  "issue list": isSafeGhReadArguments,
};
// Read-only `gh` paths absent from the base allow-list. Each stays gated on an
// explicit `safeSubcommands.gh` entry and on its own validator, so enabling one
// adds inspection coverage without opening a write path.
const GH_READ_ONLY_PATHS = [
  "alias",
  "auth status",
  "cache list",
  "codespace list",
  "config get",
  "config list",
  "gist list",
  "gist view",
  "issue status",
  "label list",
  "licenses",
  "org list",
  "pr checks",
  "pr diff",
  "pr status",
  "project field-list",
  "project item-list",
  "project list",
  "project view",
  "release list",
  "release view",
  "repo list",
  "repo view",
  "ruleset list",
  "ruleset view",
  "run list",
  "run view",
  "run watch",
  "search",
  "secret list",
  "skill list",
  "ssh-key list",
  "status",
  "variable list",
  "version",
  "workflow list",
  "workflow view",
  "extension list",
  "extension search",
  "help",
  "gpg-key list",
] as const;
const GH_READ_ONLY_VALIDATORS: Record<string, ArgumentValidator> = Object.fromEntries(
  GH_READ_ONLY_PATHS.map((path) => [path, isSafeGhReadOnlyArguments]),
);
GH_READ_ONLY_VALIDATORS.api = isSafeGhApiArguments;

function isSafeStructuredCommand(
  command: string,
  args: string[],
  safeSubcommands: SafeSubcommands,
  workingDirectory?: string,
) {
  if (command === "git") return isSafeGitCommand(args, safeSubcommands, workingDirectory);
  if (command === "gh") return isSafeGhCommand(args, safeSubcommands);

  const subcommandIndex = args.findIndex((argument) => !argument.startsWith("-"));
  const subcommand = args[subcommandIndex]?.toLowerCase();
  const subcommandArgs = subcommandIndex >= 0 ? args.slice(subcommandIndex + 1) : [];
  if (command === "sed") {
    const script = args.find((argument) => !argument.startsWith("-"));
    return (
      Boolean(script) &&
      (args.includes("-n") || args.some((argument) => /^-[^-]*n[^-]*$/.test(argument))) &&
      /^\d+(,\d+)?p(;\d+(,\d+)?p)*$/.test(script ?? "")
    );
  }
  if (["node", "python", "python3", "tsc", "biome", "ruff", "ty"].includes(command)) {
    if (args.includes("--version")) return true;
    return (
      command === "tsc" &&
      args.includes("--noEmit") &&
      !args.some(
        (argument) =>
          argument === "--incremental" ||
          argument.startsWith("--incremental=") ||
          argument === "--tsBuildInfoFile" ||
          argument.startsWith("--tsBuildInfoFile=") ||
          argument === "--generateTrace" ||
          argument.startsWith("--generateTrace="),
      )
    );
  }
  if (command === "npm") {
    if (subcommand === "audit" && subcommandArgs.includes("fix")) return false;
    if (["list", "ls", "view", "info", "search", "outdated", "audit", "test"].includes(subcommand ?? "")) {
      return true;
    }
    return subcommand === "run" && ["test", "check", "typecheck", "lint"].includes(args[1] ?? "");
  }
  if (["cargo", "go", "pytest", "vitest", "jest"].includes(command)) {
    return ["test", "check"].includes(subcommand ?? "") || ["pytest", "vitest", "jest"].includes(command);
  }
  return false;
}

function isSafeTasklistArguments(args: string[]) {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]?.toLowerCase();
    if (["/v", "/nh", "/svc"].includes(argument ?? "")) continue;
    if (argument === "/fo") {
      const format = args[index + 1]?.toLowerCase();
      if (!format || !["table", "list", "csv"].includes(format)) return false;
      index += 1;
      continue;
    }
    if (argument === "/fi") {
      const filter = args[index + 1];
      if (!filter || filter.startsWith("/")) return false;
      index += 1;
      continue;
    }
    if (argument === "/m") {
      const module = args[index + 1];
      if (module && !module.startsWith("/")) index += 1;
      continue;
    }
    return false;
  }
  return true;
}

function isSafeGetProcessArguments(args: string[]) {
  return hasSafePowerShellQueryArguments(
    args,
    new Set(["-module", "-fileversioninfo", "-includeusername"]),
    new Set(["-name", "-id"]),
  );
}

function isSafeGetServiceArguments(args: string[]) {
  return hasSafePowerShellQueryArguments(
    args,
    new Set(["-dependentservices", "-requiredservices"]),
    new Set(["-name", "-displayname", "-include", "-exclude"]),
  );
}

function hasSafePowerShellQueryArguments(
  args: string[],
  switches: ReadonlySet<string>,
  valueOptions: ReadonlySet<string>,
) {
  let positionalValues = 0;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const normalized = argument?.toLowerCase();
    if (!argument || !normalized) return false;
    if (!argument.startsWith("-")) {
      positionalValues += 1;
      if (positionalValues > 1) return false;
      continue;
    }
    if (switches.has(normalized)) continue;
    if (!valueOptions.has(normalized)) return false;
    const value = args[index + 1];
    if (!value || value.startsWith("-")) return false;
    index += 1;
  }
  return true;
}

function isSafeGitCommand(args: string[], safeSubcommands: SafeSubcommands, workingDirectory?: string) {
  const subcommandIndex = parseGitGlobalOptions(args, workingDirectory);
  if (subcommandIndex === undefined) return false;
  const subcommand = args[subcommandIndex]?.toLowerCase();
  if (!subcommand || subcommand.startsWith("-")) return false;
  const subcommandArgs = args.slice(subcommandIndex + 1);
  const builtinValidator = (BUILTIN_GIT_VALIDATORS as Record<string, ArgumentValidator>)[subcommand];
  const configuredValidator = (CONFIGURABLE_GIT_VALIDATORS as Record<string, ArgumentValidator>)[subcommand];
  const configured = safeSubcommands.git?.includes(subcommand as SafeGitSubcommand) === true;
  const validator = builtinValidator ?? (configured ? configuredValidator : undefined);
  return validator !== undefined && hasSafeGitArguments(subcommand, subcommandArgs) && validator(subcommandArgs);
}

function parseGitGlobalOptions(args: string[], workingDirectory?: string) {
  let index = 0;
  while (index < args.length) {
    const argument = args[index];
    if (argument === "--no-pager") {
      index += 1;
      continue;
    }
    if (argument !== "-C") break;
    const directory = args[index + 1];
    if (!directory || !isCurrentWorkingDirectory(directory, workingDirectory)) return undefined;
    index += 2;
  }
  return index;
}

function isCurrentWorkingDirectory(directory: string, workingDirectory?: string) {
  if (!workingDirectory || directory.split(/[\\/]+/u).includes("..")) return false;
  if (normalize(directory) === ".") return true;
  return isAbsolute(directory) && normalize(directory) === normalize(workingDirectory);
}

function hasSafeGitArguments(subcommand: string, args: string[]) {
  return !args.some(
    (argument) =>
      argument === "--help" ||
      argument === "--show-signature" ||
      argument.startsWith("--show-signature=") ||
      argument.includes("%G") ||
      argument === "--output" ||
      argument.startsWith("--output=") ||
      argument === "--ext-diff" ||
      argument.startsWith("--ext-diff=") ||
      argument === "--textconv" ||
      argument.startsWith("--textconv=") ||
      argument === "--paginate" ||
      argument === "--open-files-in-pager" ||
      argument.startsWith("--open-files-in-pager=") ||
      (subcommand === "grep" && (argument === "-O" || argument.startsWith("-O"))),
  );
}

function isSafeGitTagArguments(args: string[]) {
  if (args.includes("-l") || args.includes("--list")) return true;
  return !args.some((argument) => !argument.startsWith("-"));
}

function isSafeGitStashArguments(args: string[]) {
  if (args[0] !== "list") return false;
  return !args.slice(1).some((argument) => !argument.startsWith("-"));
}

function isSafeGitWorktreeArguments(args: string[]) {
  return args[0] === "list";
}

function isSafeGitCatFileArguments(args: string[]) {
  return !args.some(
    (argument) =>
      matchesLongOptionPrefix(argument, "--filters", "--fi") || matchesLongOptionPrefix(argument, "--textconv", "--t"),
  );
}

function isSafeGitGrepArguments(args: string[]) {
  return !args.some(
    (argument) =>
      matchesLongOptionPrefix(argument, "--textconv", "--textc") ||
      matchesLongOptionPrefix(argument, "--open-files-in-pager", "--op") ||
      matchesLongOptionPrefix(argument, "--ext-grep", "--ext"),
  );
}

function matchesLongOptionPrefix(argument: string, option: string, shortest: string) {
  const optionName = argument.split("=", 1)[0] ?? "";
  return optionName.length >= shortest.length && option.startsWith(optionName);
}

function isSafeGitBranchArguments(args: string[]) {
  if (args.some((argument) => !argument.startsWith("-"))) return false;
  return !args.some(
    (argument) =>
      /^-[^-]*[dDmMcCu]/.test(argument) ||
      matchesLongOptionPrefix(argument, "--delete", "--del") ||
      matchesLongOptionPrefix(argument, "--move", "--mov") ||
      matchesLongOptionPrefix(argument, "--copy", "--cop") ||
      matchesLongOptionPrefix(argument, "--edit-description", "--e") ||
      matchesLongOptionPrefix(argument, "--unset-upstream", "--u") ||
      matchesLongOptionPrefix(argument, "--set-upstream-to", "--set-u") ||
      matchesLongOptionPrefix(argument, "--create-reflog", "--creat"),
  );
}

function isSafeGitRemoteArguments(args: string[]) {
  const actionIndex = args.findIndex((argument) => !argument.startsWith("-"));
  if (actionIndex < 0) return true;
  const action = args[actionIndex];
  if (action === "get-url") return true;
  if (action !== "show") return false;

  const showArgs = args.slice(actionIndex + 1);
  if (showArgs.includes("--")) return false;
  const remotes = showArgs.filter((argument) => !argument.startsWith("-"));
  return remotes.length === 0 || (remotes.length === 1 && showArgs.includes("-n"));
}

function isSafeGhCommand(args: string[], safeSubcommands: SafeSubcommands) {
  const group = args[0]?.toLowerCase();
  if (!group || group.startsWith("-")) return false;
  const action = args[1]?.toLowerCase();
  if (!action || action.startsWith("-")) {
    return runGhValidator(group, args.slice(1), safeSubcommands);
  }
  const path = `${group} ${action}`;
  const validator = ghValidatorFor(path, safeSubcommands);
  if (validator) return validator(args.slice(2));
  return runGhValidator(group, args.slice(1), safeSubcommands);
}

function ghValidatorFor(path: string, safeSubcommands: SafeSubcommands) {
  if (!safeSubcommands.gh?.includes(path)) return undefined;
  return (GH_VALIDATORS as Record<string, ArgumentValidator>)[path] ?? GH_READ_ONLY_VALIDATORS[path];
}

function runGhValidator(path: string, args: string[], safeSubcommands: SafeSubcommands) {
  const validator = ghValidatorFor(path, safeSubcommands);
  return validator?.(args) ?? false;
}

function isUnsafeGhMutationArgument(argument: string) {
  if (isUnsafeGhReadArgument(argument)) return true;
  const normalized = argument.toLowerCase();
  return (
    argument === "-f" ||
    argument === "-F" ||
    normalized === "--field" ||
    normalized.startsWith("--field=") ||
    normalized === "--input" ||
    normalized.startsWith("--input=") ||
    argument === "-X" ||
    normalized === "--method" ||
    normalized.startsWith("--method=") ||
    normalized === "--project" ||
    normalized.startsWith("--project=")
  );
}

function isSafeGhReadOnlyArguments(args: string[]) {
  return !args.some(isUnsafeGhMutationArgument);
}

function isSafeGhApiArguments(args: string[]) {
  return !args.some(
    (argument) =>
      argument === "--field" ||
      argument === "--input" ||
      argument === "--method" ||
      /^(-f|-F|-X|--method=|--field=|--input=)/.test(argument),
  );
}

function isSafeGhReadArguments(args: string[]) {
  return !args.some(isUnsafeGhReadArgument) && hasGhJsonOutput(args);
}

function isUnsafeGhReadArgument(argument: string) {
  return (
    argument.startsWith("-w") ||
    argument === "--web" ||
    argument.startsWith("--web=") ||
    argument === "--browser" ||
    argument.startsWith("--browser=") ||
    argument === "--paginate" ||
    argument === "--pager" ||
    argument.startsWith("--pager=") ||
    argument === "--output" ||
    argument.startsWith("--output=")
  );
}

function hasGhJsonOutput(args: string[]) {
  let hasJson = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) return false;
      hasJson = true;
      index += 1;
    } else if (argument.startsWith("--json=")) {
      if (argument === "--json=") return false;
      hasJson = true;
    }
  }
  return hasJson;
}
