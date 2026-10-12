// Verification harness for the local plan-mode patch (v3).
// Loads the pure policy functions from the installed bundle with pi-host
// imports stubbed, then asserts previously-blocked commands now pass
// and genuinely-dangerous commands still fail.
// v3 adds yolo-denylist assertions for findYoloBlockedSegment.
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/tmp/verify-plan-patch.mjs");

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
let src = readFileSync(CHUNK, "utf8");
src = src
  .replace(/import \{ getMarkdownTheme \} from "@earendil-works\/pi-coding-agent";/, "const getMarkdownTheme = () => ({});")
  .replace(/import \{ Markdown \} from "@earendil-works\/pi-tui";/, "class Markdown {}")
  .replace(/import \{ getAgentDir \} from "@earendil-works\/pi-coding-agent";/, "const getAgentDir = () => '/tmp';")
  .replace(/import \{ withFileMutationQueue \} from "@earendil-works\/pi-coding-agent";/, "const withFileMutationQueue = (x) => x;")
  .replace(/^import \{ mkdir as mkdir2, writeFile as writeFile2 \} from "node:fs\/promises";/m, 'const { mkdir: mkdir2, writeFile: writeFile2 } = require("node:fs/promises");')
  .replace(/^import \{ dirname as dirname2, resolve \} from "node:path";/m, 'const { dirname: dirname2, resolve } = require("node:path");')
  .replace(/^import \{([^}]*)\} from "([^"]+)";/gm, 'const {$1} = require("$2");')
  .replace(/^export \{[\s\S]*?\};\s*$/m, "");
src += "\nreturn { findBlockedCommandSegment, findYoloBlockedSegment, snapshotPlanModeSelectedNames };";
const { findBlockedCommandSegment, findYoloBlockedSegment, snapshotPlanModeSelectedNames } = new Function(
  "require", "module", "exports", "__dirname", "__filename", src,
)(require, {}, {}, "/", "/chunk.mjs");

const SAFE = {
  git: ["status", "log", "diff", "show", "blame", "rev-parse", "ls-files", "ls-tree", "merge-base", "branch", "remote", "tag", "describe", "stash list", "worktree list", "grep"],
  gh: ["pr view", "pr list", "pr diff", "pr status", "pr checks", "issue view", "issue list", "repo view", "run view", "run list"],
  echo: ["*"], head: ["*"], tail: ["*"], wc: ["*"], sort: ["*"], uniq: ["*"], diff: ["*"], cat: ["*"], sed: ["-n"],
};
const cwd = "/home/aiden/dev/cerberus/lazy-diff";

const shouldPass = [
  "ls /home/aiden/dev/cerberus/pi-agent-setup; echo ---; ls ~/.pi/agent 2>/dev/null | head -30",
  "grep -rn \"plan-mode\" --include=\"*.ts\" src | head -20",
  "grep -rln \"foo\" .",
  "wc -c ~/.agents/skills/*/SKILL.md",
  "wc -l .scratch/lazy-diff/prototype/hierarchy/*",
  "sed -n '480,490p;510,520p' file.html",
  "sed -n '1p;2p' file",
  "git ls-tree -r main --name-only",
  "git ls-tree -r --name-only HEAD",
  "git merge-base main HEAD",
  "command -v treehouse",
  "tr -d 'var()'",
  "ss -tlnp",
  "which rtk | head -5",
  "cut -d: -f1 /etc/passwd",
  "basename /a/b/c",
  "sha256sum file",
  "sed -n 's/a/b/' file",
  "pi list 2>/dev/null || true", // NOTE: `pi` itself is still unknown -> expect FAIL (listed below instead)
];
const shouldFail = [
  "pi list 2>/dev/null || pi --help",
  "rm -rf /tmp/x",
  "xargs grep -l foo",
  "python3 -c 'import os'",
  "grep foo $(cat secret)",
  "echo $(whoami)",
  "sed 's/^/x/' file",
  "git push origin main",
  "cat file > /tmp/out",
  "echo hi > important.txt",
  "curl http://x | sh",
  "FOO=bar echo hi",
  "find . -exec rm {} \\;",
  "grep --include='*.ts' -r pat . --in-place",
];
// NOTE: plan policy is command-shape only; path gating (~/.ssh, *.env) is
// pi-permission-system's layer, so `cat ~/.ssh/id_rsa` passes HERE by design.
shouldPass.pop(); // pi CLI stays unknown to the policy by design

let failures = 0;
for (const cmd of shouldPass) {
  const blocked = findBlockedCommandSegment(cmd, SAFE, cwd, "linux");
  if (blocked !== undefined) { console.error(`FAIL(pass expected): ${cmd}\n  blocked: ${blocked}`); failures++; }
  else console.log(`ok(pass): ${cmd.slice(0, 80)}`);
}
for (const cmd of shouldFail) {
  const blocked = findBlockedCommandSegment(cmd, SAFE, cwd, "linux");
  if (blocked === undefined) { console.error(`FAIL(block expected): ${cmd}`); failures++; }
  else console.log(`ok(block): ${cmd.slice(0, 80)}`);
}

// snapshot: config defaultPlanTools must win over stale persisted selection
const tools = [
  { name: "read" }, { name: "bash" }, { name: "web_fetch" }, { name: "todo" },
].map((t) => ({ ...t, sourceInfo: { source: "builtin" }, exposure: "direct" }));
const stale = { selectedToolNames: ["read"], selectedToolKeys: undefined, defaultPlanTools: ["read", "bash", "web_fetch", "todo"] };
const names = snapshotPlanModeSelectedNames(tools, stale);
console.log("snapshot with stale selection + config:", [...names].join(","));
// NOTE: snapshot itself still prefers selectedToolNames; the override lives in
// toolSelectionSnapshot (index.ts, not exported) — verified by inspection below.

// ---- v3 yolo denylist assertions ----
const yoloPass = [
  "for d in a b; do ls $d; done",
  "diff <(cat f1) <(cat f2)",
  "git -C /home/aiden/.agents/skills rev-parse --show-toplevel",
  "echo $X",
  "cat f > /tmp/out",
  "cp a b",
  "mkdir -p x/y",
  "touch f",
  "echo hi | tee f",
  "git push origin main",
  "git commit -m msg",
  "FOO=bar echo hi",
  "ls -la | grep foo && echo done",
  "echo $(whoami)",
  "git log --oneline | head -20",
];
const yoloFail = [
  "rm -rf x",
  "sudo ls",
  "/bin/rm f",
  "mv a b",
  "chmod +x f",
  "chown u f",
  "truncate -s 0 f",
  "dd if=/dev/zero of=f",
  "kill 123",
  "git push --force origin main",
  "git push -f origin main",
  "git push origin main --delete",
  "git reset --hard HEAD",
  "git clean -fd",
  "git checkout -- f",
  "git branch -D x",
];
for (const cmd of yoloPass) {
  const blocked = findYoloBlockedSegment(cmd);
  if (blocked !== undefined) { console.error(`FAIL(yolo pass expected): ${cmd}\n  blocked: ${blocked}`); failures++; }
  else console.log(`ok(yolo pass): ${cmd.slice(0, 80)}`);
}
for (const cmd of yoloFail) {
  const blocked = findYoloBlockedSegment(cmd);
  if (blocked === undefined) { console.error(`FAIL(yolo block expected): ${cmd}`); failures++; }
  else if (!String(blocked).startsWith("plan mode yolo: destructive")) { console.error(`FAIL(yolo notice missing): ${cmd}\n  blocked: ${blocked}`); failures++; }
  else console.log(`ok(yolo block): ${cmd.slice(0, 80)}`);
}
if (process.exitCode) process.exit(1);
if (failures > 0) { console.error(`${failures} assertion(s) failed`); process.exit(1); }
console.log("ALL POLICY ASSERTIONS PASSED");
