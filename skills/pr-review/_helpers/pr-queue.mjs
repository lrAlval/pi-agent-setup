#!/usr/bin/env node
// pr-queue.mjs — PR queue fetch + ordering for the pr-review skill.
// Node >= 20, ESM, zero npm deps (node:child_process + gh CLI only).
//
// Upgrade path: dependency signal is PR body markers only. Move to GitHub
// GraphQL project graph later if needed.

import { execFileSync } from "node:child_process";
import path from "node:path";

export const PRIORITY_LABELS = Object.freeze({
  HIGH: ["critical", "blocking", "priority:high"],
  MEDIUM: ["priority:medium"],
});

const DEP_MARKERS = /(?:depends on|blocked by|stacked on)\s*:?\s*([^\n]*)/gi;

export function parseDependencies(body) {
  if (!body) return [];
  const found = [];
  DEP_MARKERS.lastIndex = 0;
  let m;
  while ((m = DEP_MARKERS.exec(body)) !== null) {
    const seg = m[1] || "";
    for (const mm of seg.matchAll(/#(\d+)/g)) found.push(Number(mm[1]));
  }
  return [...new Set(found)];
}

export function parseSpecPresent(body) {
  if (!body) return false;
  if (/```/.test(body)) return true;
  if (/^#{1,6}\s+spec\b/mi.test(body)) return true;
  if (/\bSpec:/.test(body)) return true;
  return false;
}

function priorityScore(labels) {
  const low = (labels || []).map((l) => String(l).toLowerCase());
  if (low.some((l) => PRIORITY_LABELS.HIGH.includes(l))) return 0;
  if (low.some((l) => PRIORITY_LABELS.MEDIUM.includes(l))) return 1;
  return 2;
}

function ciRank(ci) {
  return ci === "failing" ? 0 : 1;
}

// orderQueue(prs) -> { order, why }
// QueueItem = { number, title, labels, ci, ageDays, dependsOn, specPresent }
export function orderQueue(prs) {
  const open = new Set(prs.map((p) => p.number));
  // adjacency: dep -> dependents (only open deps)
  const dependents = new Map(); // num -> Set<dependent>
  const unknownNotes = new Map();
  for (const p of prs) {
    for (const d of p.dependsOn || []) {
      if (open.has(d)) {
        if (!dependents.has(d)) dependents.set(d, new Set());
        dependents.get(d).add(p.number);
      } else {
        if (!unknownNotes.has(p.number)) unknownNotes.set(p.number, []);
        unknownNotes.get(p.number).push(d);
      }
    }
  }

  // transitive dependent count per PR
  function transitiveCount(n) {
    const seen = new Set();
    const stack = [...(dependents.get(n) || [])];
    while (stack.length) {
      const x = stack.pop();
      if (x === n || seen.has(x)) continue;
      seen.add(x);
      for (const y of dependents.get(x) || []) stack.push(y);
    }
    // cycle-safe: SCC members share summed dependents via union size
    return seen.size;
  }

  const depRank = new Map(prs.map((p) => [p.number, transitiveCount(p.number)]));

  const sorted = [...prs].sort((a, b) => {
    const ra = depRank.get(a.number),
      rb = depRank.get(b.number);
    if (ra !== rb) return rb - ra;
    const pa = priorityScore(a.labels),
      pb = priorityScore(b.labels);
    if (pa !== pb) return pa - pb;
    const ca = ciRank(a.ci),
      cb = ciRank(b.ci);
    if (ca !== cb) return ca - cb;
    if ((a.ageDays || 0) !== (b.ageDays || 0)) return (b.ageDays || 0) - (a.ageDays || 0);
    return a.number - b.number;
  });

  const order = sorted.map((p) => p.number);
  const why = {};
  for (const p of sorted) {
    const parts = [];
    const dc = depRank.get(p.number);
    if (dc > 0) parts.push(`${dc} PR${dc === 1 ? "" : "s"} depend on it`);
    const ps = priorityScore(p.labels);
    if (ps === 0) parts.push(`${(p.labels || []).find((l) => PRIORITY_LABELS.HIGH.includes(String(l).toLowerCase()))} label`);
    else if (ps === 1) parts.push("priority:medium label");
    if (p.ci === "failing") parts.push("CI failing");
    if ((p.ageDays || 0) > 0 && parts.length === 0) parts.push(`oldest (${p.ageDays}d)`);
    const unk = unknownNotes.get(p.number);
    if (unk && unk.length) parts.push(`unknown dep ${unk.map((n) => "#" + n).join(",")} ignored`);
    if (parts.length === 0) parts.push("no priority signals");
    why[p.number] = parts.join("; ");
  }
  return { order, why };
}

export function ghJson(cmd, cwd) {
  try {
    const out = execFileSync("gh", cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(out);
  } catch (e) {
    const tail = String((e && e.stderr) || (e && e.message) || e).trim().split("\n").slice(-3).join("\n");
    throw new Error(tail || "gh call failed");
  }
}

function printLine(s) {
  process.stdout.write(s + "\n");
}

function main() {
  const cwd = process.argv[2];
  if (!cwd || process.argv.length !== 3) {
    printLine("error: usage: node pr-queue.mjs <repo-cwd>");
    process.exit(1);
  }
  const repoDir = path.resolve(cwd);
  // 1. repo identity
  let repo;
  try {
    repo = ghJson(["repo", "view", "--json", "nameWithOwner"], repoDir);
    if (repo && typeof repo === "object") repo = repo.nameWithOwner;
  } catch (e) {
    const msg = String(e.message || e);
    if (/not a git repository|no git/i.test(msg)) printLine("error: not a github repo (no origin remote github.com)");
    else if (/not logged|auth|token/i.test(msg)) printLine(`error: gh not authenticated: ${msg}`);
    else printLine(`error: ${msg}`);
    process.exit(1);
  }
  if (typeof repo !== "string" || !repo.includes("/")) {
    printLine("error: not a github repo (no origin remote github.com)");
    process.exit(1);
  }
  printLine(`repo: ${repo}`);

  // 2. open PR list
  let prs;
  try {
    prs = ghJson(
      ["pr", "list", "--state", "open", "--json", "number,title,headRefName,baseRefName,labels,body,createdAt", "--limit", "100"],
      repoDir
    );
  } catch (e) {
    printLine(`error: ${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(prs)) prs = [];
  printLine(`pr_count: ${prs.length}`);
  if (prs.length === 0) {
    printLine("review_order: ");
    process.exit(0);
  }

  const now = Date.now();
  const items = prs.map((p) => {
    const labels = (p.labels || []).map((l) => (typeof l === "string" ? l : l.name)).filter(Boolean);
    const created = p.createdAt ? Date.parse(p.createdAt) : NaN;
    const ageDays = Number.isFinite(created) ? Math.max(0, Math.floor((now - created) / 86400000)) : 0;
    return {
      number: p.number,
      title: String(p.title || "").replace(/\n/g, " "),
      head: p.headRefName || "?",
      base: p.baseRefName || "?",
      labels,
      body: p.body || "",
      ageDays,
      dependsOn: parseDependencies(p.body || ""),
      specPresent: parseSpecPresent(p.body || ""),
    };
  });

  // 3. CI + mergeable per PR (best effort; failure -> unknown)
  for (const it of items) {
    try {
      const det = ghJson(
        ["pr", "view", String(it.number), "--json", "mergeable,commits", "--jq", "{mergeable: .mergeable, status: [.commits[].statusCheckRollup // empty]}"],
        repoDir
      );
      it.mergeable = det && typeof det.mergeable !== "undefined" ? det.mergeable : "?";
      const statuses = JSON.stringify(det || "");
      it.ci = /FAILURE|FAILING/i.test(statuses) ? "failing" : /SUCCESS|PASSING/i.test(statuses) ? "passing" : "none";
    } catch {
      it.mergeable = "?";
      it.ci = "unknown";
    }
    if (it.mergeable !== true && it.mergeable !== false) it.mergeable = "?";
    else it.mergeable = String(it.mergeable);
  }

  for (const it of items) {
    const depStr = it.dependsOn.length ? it.dependsOn.join(",") : "-";
    printLine(
      `pr:${it.number}: title=${it.title} head=${it.head} base=${it.base} labels=${it.labels.join(",") || "-"} ci=${it.ci} mergeable=${it.mergeable} age_days=${it.ageDays} spec_present=${it.specPresent} depends_on=${depStr}`
    );
  }

  const { order, why } = orderQueue(
    items.map((it) => ({
      number: it.number,
      title: it.title,
      labels: it.labels,
      ci: it.ci,
      ageDays: it.ageDays,
      dependsOn: it.dependsOn,
      specPresent: it.specPresent,
    }))
  );
  printLine(`review_order: ${order.join(",")}`);
  for (const n of order) printLine(`why:${n}: ${why[n]}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) main();
