/**
 * Eligibility seams for the non-git codegraph gate (node:test).
 * Run: node --test extensions/codegraph-gate/eligibility.test.ts
 * from ~/.pi/agent (or: bun test extensions/codegraph-gate/).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

let gate: typeof import("./index.ts");
const origCwd = process.cwd();
const temps: string[] = [];

function tmp(): string {
  // NOTE: /tmp itself is blocklisted, so fixtures live in /var/tmp.
  const d = mkdtempSync("/var/tmp/cg-gate-");
  temps.push(d);
  return d;
}

function fill(dir: string, files: string[]): void {
  for (const f of files) {
    const full = join(dir, f);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, "x\n");
  }
}

function eligibleFixture(): string {
  const d = tmp();
  const files = ["top.txt"];
  for (let i = 0; i < 25; i++) files.push(join("sub", `f${i}.txt`));
  fill(d, files);
  return d;
}

function stubPi() {
  const handlers = new Map<string, (e: never, c: never) => unknown>();
  return {
    handlers,
    on(ev: string, h: (e: never, c: never) => unknown) {
      handlers.set(ev, h);
      return () => {};
    },
    registerCommand() {},
  };
}

before(async () => {
  gate = await import("./index.ts");
});

after(() => {
  process.chdir(origCwd);
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

describe("isBlockedRoot", () => {
  it("blocks /, $HOME, /tmp, /etc, /usr", () => {
    assert.equal(gate.isBlockedRoot("/"), true);
    assert.equal(gate.isBlockedRoot(homedir()), true);
    assert.equal(gate.isBlockedRoot("/tmp"), true);
    assert.equal(gate.isBlockedRoot("/tmp/foo"), true);
    assert.equal(gate.isBlockedRoot("/etc"), true);
    assert.equal(gate.isBlockedRoot("/etc/ssl"), true);
    assert.equal(gate.isBlockedRoot("/usr"), true);
    assert.equal(gate.isBlockedRoot("/usr/lib"), true);
  });
  it("allows ordinary dirs", () => {
    assert.equal(gate.isBlockedRoot(tmp()), false);
  });
});

describe("isEligible", () => {
  it("eligible dir: >20 files with depth>=2", () => {
    assert.equal(gate.isEligible(eligibleFixture()), true);
  });
  it("tiny dir: allow (ineligible)", () => {
    const d = tmp();
    fill(d, ["a.txt", join("sub", "b.txt")]);
    assert.equal(gate.isEligible(d), false);
  });
  it("flat-30 depth-1: ineligible", () => {
    const d = tmp();
    fill(d, Array.from({ length: 30 }, (_, i) => `f${i}.txt`));
    assert.equal(gate.isEligible(d), false);
  });
  it("many files but all depth-1 except one deep still eligible", () => {
    const d = tmp();
    fill(d, [...Array.from({ length: 25 }, (_, i) => `f${i}.txt`), join("sub", "deep.txt")]);
    assert.equal(gate.isEligible(d), true);
  });
  it("blocked root is never eligible", () => {
    assert.equal(gate.isEligible("/tmp"), false);
  });
});

describe("resolveRoot", () => {
  it("plain dir -> kind plain, root = cwd", () => {
    const d = tmp();
    const r = gate.resolveRoot(d);
    assert.equal(r.kind, "plain");
    assert.equal(r.root, resolve(d));
  });
  it("git repo -> kind git", () => {
    const d = tmp();
    execSync("git init -q", { cwd: d });
    const r = gate.resolveRoot(d);
    assert.equal(r.kind, "git");
    assert.equal(r.root, resolve(d));
  });
});

describe("lockPathFor", () => {
  it("plain -> <root>/.codegraph/init.lock", () => {
    assert.equal(gate.lockPathFor("/x/y", "plain"), join("/x/y", ".codegraph", "init.lock"));
  });
  it("git with gitDir -> <gitDir>/pi-codegraph-init.lock", () => {
    assert.equal(gate.lockPathFor("/x/y", "git", "/x/y/.git"), join("/x/y/.git", "pi-codegraph-init.lock"));
  });
});

describe("gate tool_call", () => {
  it("blocks edit in eligible plain dir pre-explore, allows post-explore", () => {
    const d = eligibleFixture();
    process.chdir(d);
    const pi = stubPi();
    gate.default(pi as never);
    const onTool = pi.handlers.get("tool_call")!;
    const edit = { toolName: "edit", input: { path: join(d, "sub", "f0.txt") } };
    const blocked = onTool(edit as never, { ui: { notify: () => {} } } as never) as
      | { block: boolean; reason: string }
      | undefined;
    assert.ok(blocked && blocked.block === true, "expected hard block pre-explore");
    assert.match(blocked.reason, /codegraph_explore/);
    onTool({ toolName: "codegraph_explore", input: {} } as never, {} as never);
    const after = onTool(edit as never, { ui: { notify: () => {} } } as never);
    assert.equal(after, undefined);
  });
  it("tiny dir: fail open with warning, no block", () => {
    const d = tmp();
    fill(d, ["a.txt"]);
    process.chdir(d);
    let warned = "";
    const pi = stubPi();
    gate.default(pi as never);
    const onTool = pi.handlers.get("tool_call")!;
    const res = onTool({ toolName: "edit", input: { path: join(d, "a.txt") } } as never, {
      ui: { notify: (m: string) => { warned = m; } },
    } as never);
    assert.equal(res, undefined);
    assert.match(warned, /FAIL OPEN.*tiny\/ineligible/);
  });
});

describe("concurrent init race", () => {
  it("second mkdir on same lock path raises EEXIST", async () => {
    const { mkdir } = await import("node:fs/promises");
    const d = tmp();
    const lock = join(d, "init.lock");
    await mkdir(lock);
    await assert.rejects(mkdir(lock), /EEXIST/);
  });
});
