#!/usr/bin/env node
// ledger.mjs — repo-committed review ledger CLI. Zero-dep, Node>=22 ESM.
// Subcommands: upsert | diff | mark | render | shim. Exit codes:
// 0 ok, 2 invalid JSON/input, 3 missing --sha, 4 unwriteable output, 5 unknown id/status.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname, sep } from "node:path";
import { randomUUID, createHash } from "node:crypto";

const USAGE = `usage:
  ledger.mjs upsert <ledger.json> <findings.json> --sha <sha>
  ledger.mjs diff <ledger.json> <findings.json>
  ledger.mjs mark <ledger.json> <id> <status> --sha <sha>
  ledger.mjs render <ledger.json> <out.html>
  ledger.mjs shim <ledger.json> --repo <dir> --session <id> [--sha <s> --from <a> --to <b> --branch <br> --model <m>]`;

const SEV = new Set(["critical", "high", "medium", "low"]);
const STATUS = new Set(["open", "fixed", "wontfix"]);

function fail(code, msg) { console.error(msg); process.exit(code); }
function getFlag(argv, name) {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) return null;
  return argv[i + 1];
}
function normPath(p) { return String(p ?? "").replace(/\\/g, "/"); }
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function readJSON(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { fail(2, `invalid JSON in ${path}: ${e.message}`); }
}
function findingsOf(obj, label) {
  const arr = Array.isArray(obj) ? obj : obj?.findings;
  if (!Array.isArray(arr)) fail(2, `invalid ${label}: expected array or {findings:[]}`);
  return arr;
}
function validateIncoming(f, idx) {
  if (!f || typeof f !== "object") fail(2, `invalid finding #${idx}: not an object`);
  for (const k of ["file", "check", "severity"]) {
    if (f[k] === undefined || f[k] === null || f[k] === "") fail(2, `invalid finding #${idx}: missing ${k}`);
  }
  if (!SEV.has(String(f.severity))) fail(2, `invalid finding #${idx}: bad severity ${f.severity}`);
  if (typeof f.line !== "number" || !Number.isFinite(f.line)) fail(2, `invalid finding #${idx}: missing line`);
}
function loadLedger(path, init) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (e) {
    if (e.code === "ENOENT" && init) return { v: 1, findings: [] };
    fail(2, `invalid ledger ${path}: ${e.message}`);
  }
}
function nextId(findings) {
  let max = 0;
  for (const f of findings) {
    const m = /^f(\d+)$/.exec(String(f.id ?? ""));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return "f" + String(max + 1).padStart(3, "0");
}
function matchKey(aFile, aCheck, bFile, bCheck, aLine, bLine) {
  return aFile === bFile && aCheck === bCheck && Math.abs(aLine - bLine) <= 3;
}

function cmdUpsert([ledgerPath, findingsPath, ...rest]) {
  const sha = getFlag([ledgerPath, findingsPath, ...rest].length ? process.argv : [], "--sha") ?? getFlag(process.argv, "--sha");
  if (!ledgerPath || !findingsPath || !sha) {
    if (!sha) fail(3, "missing --sha");
    fail(2, `usage: ledger.mjs upsert <ledger.json> <findings.json> --sha <sha>`);
  }
  const incoming = findingsOf(readJSON(findingsPath), "findings");
  const ledger = loadLedger(ledgerPath, true);
  if (!Array.isArray(ledger.findings)) ledger.findings = [];
  if (ledger.v === undefined) ledger.v = 1;
  // dedupe incoming: same file+check+line keeps first
  const seen = new Set(); const uniq = [];
  incoming.forEach((f, i) => {
    validateIncoming(f, i);
    const k = `${normPath(f.file)}|${f.check}|${f.line}`;
    if (!seen.has(k)) { seen.add(k); uniq.push(f); }
  });
  for (const f of uniq) {
    const file = normPath(f.file);
    const hit = ledger.findings.find((e) => matchKey(normPath(e.file), e.check, file, f.check, e.line, f.line));
    if (hit) {
      for (const [k, v] of Object.entries(f)) { if (!(k in hit)) hit[k] = v; }
      hit.file = file; hit.check = f.check; hit.line = f.line;
      hit.severity = f.severity;
      if (f.note !== undefined) hit.note = f.note;
      hit.lastSeenSha = sha;
    } else {
      ledger.findings.push({ id: nextId(ledger.findings), file, line: f.line, check: f.check,
        severity: String(f.severity), status: "open", firstSeenSha: sha, lastSeenSha: sha,
        ...(f.note !== undefined ? { note: f.note } : {}) });
    }
  }
  atomicWrite(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
}
function atomicWrite(path, data) {
  try {
    const tmp = join(dirname(path), `.ledger-${process.pid}-${Date.now()}.tmp`);
    writeFileSync(tmp, data);
    mkdirSync(dirname(path), { recursive: true });
    renameSync(tmp, path);
  } catch (e) { fail(4, `unwriteable output ${path}: ${e.message}`); }
}
function cmdDiff([ledgerPath, findingsPath]) {
  if (!ledgerPath || !findingsPath) fail(2, "usage: ledger.mjs diff <ledger.json> <findings.json>");
  const ledger = loadLedger(ledgerPath, false);
  const incoming = findingsOf(readJSON(findingsPath), "findings").map((f, i) => {
    validateIncoming(f, i); return { ...f, file: normPath(f.file) };
  });
  const base = Array.isArray(ledger.findings) ? ledger.findings : fail(2, "invalid ledger: findings not array");
  const matchedBase = new Set(); const matchedIn = new Set();
  base.forEach((b, bi) => incoming.forEach((f, fi) => {
    if (matchKey(normPath(b.file), b.check, f.file, f.check, b.line, f.line)) { matchedBase.add(bi); matchedIn.add(fi); }
  }));
  const persistent = base.filter((_, i) => matchedBase.has(i));
  const fixed = base.filter((_, i) => !matchedBase.has(i));
  const fresh = incoming.filter((_, i) => !matchedIn.has(i));
  console.log(JSON.stringify({ new: fresh, persistent, fixed }));
}
function cmdMark([ledgerPath, id, status]) {
  const sha = getFlag(process.argv, "--sha");
  if (!ledgerPath || !id || !status) fail(2, "usage: ledger.mjs mark <ledger.json> <id> <status> --sha <sha>");
  if (!sha) fail(3, "missing --sha");
  if (!STATUS.has(status)) fail(5, `unknown status ${status}`);
  const ledger = loadLedger(ledgerPath, false);
  const hit = (ledger.findings ?? []).find((f) => f.id === id);
  if (!hit) fail(5, `unknown id ${id}`);
  hit.status = status; hit.lastSeenSha = sha;
  atomicWrite(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
}
function cmdRender([ledgerPath, outPath]) {
  if (!ledgerPath || !outPath) fail(2, "usage: ledger.mjs render <ledger.json> <out.html>");
  const ledger = loadLedger(ledgerPath, false);
  const rows = (ledger.findings ?? []).map((f) => `<tr><td>${esc(f.id)}</td><td>${esc(f.file)}:${esc(f.line)}</td><td>${esc(f.check)}</td><td>${esc(f.severity)}</td><td>${esc(f.status)}</td><td>${esc(f.firstSeenSha ?? "")} / ${esc(f.lastSeenSha ?? "")}</td><td>${esc(f.note ?? "")}</td></tr>`).join("\n");
  const body = (ledger.findings ?? []).length === 0
    ? "<p>No findings. Empty ledger is not an error.</p>"
    : `<table><thead><tr><th>ID</th><th>Location</th><th>Check</th><th>Severity</th><th>Status</th><th>First/Last SHA</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>`;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Review ledger PR ${esc(ledger.pr ?? "")}</title><style>body{font-family:system-ui,sans-serif;max-width:90ch;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:.4rem;text-align:left;font-size:.85rem}</style></head><body><h1>Review ledger PR ${esc(ledger.pr ?? "")}</h1>${body}</body></html>`;
  try { mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, html); }
  catch (e) { fail(4, `unwriteable output ${outPath}: ${e.message}`); }
}

// --- OCR viewer JSONL shim ---
function encodeRepoPath(p) {
  if (!p) return "empty";
  let s = String(p).replace(/\\/g, "/").replace(/^\/+/, "").replace(/\//g, "-").replace(/:/g, "_");
  return s === "" ? "empty" : s;
}
function catFor(check) {
  const c = String(check).toLowerCase();
  if (c.includes("security") || c.includes("secret") || c.includes("publish")) return "security";
  if (c.includes("perf") || c.includes("morph") || c.includes("hash-guard")) return "performance";
  if (c.includes("eval") || c.includes("test") || c.includes("ac ")) return "test";
  if (c.includes("style") || c.includes("taxonomy") || c.includes("contract")) return "style";
  if (c.includes("doc")) return "documentation";
  if (c.includes("smell") || c.includes("dup") || c.includes("cjs") || c.includes("dep")) return "maintainability";
  return "other";
}
function cmdShim([ledgerPath, ...rest]) {
  const repo = getFlag(process.argv, "--repo");
  const session = getFlag(process.argv, "--session");
  if (!ledgerPath || !repo || !session) fail(2, "usage: ledger.mjs shim <ledger.json> --repo <dir> --session <id> [--sha <s> --from <a> --to <b> --branch <br> --model <m>]");
  const sha = getFlag(process.argv, "--sha") ?? "";
  const from = getFlag(process.argv, "--from") ?? "";
  const to = getFlag(process.argv, "--to") ?? "";
  const branch = getFlag(process.argv, "--branch") ?? "";
  const model = getFlag(process.argv, "--model") ?? "pi-skill";
  const ledger = loadLedger(ledgerPath, false);
  const findings = Array.isArray(ledger.findings) ? ledger.findings : [];
  const byFile = new Map();
  for (const f of findings) {
    const file = normPath(f.file ?? "");
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(f);
  }
  const now = new Date().toISOString();
  let last = randomUUID();
  const lines = [];
  const start = { uuid: last, parentUuid: null, type: "session_start", sessionId: session,
    timestamp: now, cwd: repo, gitBranch: branch, model, llmSource: "pi-skill",
    reviewMode: "range", ...(from ? { diffFrom: from } : {}), ...(to ? { diffTo: to } : {}) };
  lines.push(JSON.stringify(start));
  const files = [...byFile.keys()];
  files.forEach((file, i) => {
    const uuid = randomUUID();
    const comments = byFile.get(file).map((f) => ({
      path: file, content: `[${f.check}] ${f.note ?? f.check} (${f.id} ${f.severity}/${f.status})`,
      existing_code: String(f.check), start_line: Number(f.line) || 0, end_line: Number(f.line) || 0,
      category: catFor(f.check), severity: String(f.severity ?? "medium"),
    }));
    const itemId = createHash("sha256").update(`review\x00range\x00\x00${file}`).digest("hex").slice(0, 32);
    lines.push(JSON.stringify({ uuid, parentUuid: last, type: "review_item_done", sessionId: session,
      timestamp: new Date().toISOString(), filePath: file, oldPath: "", newPath: file,
      fingerprint: `shim:${file}`, model, comments, _item_id: itemId }));
    last = uuid;
  });
  const cov = (arr) => arr.map((file, i) => ({ item_id: `shim-${i}-${file.replace(/[^a-zA-Z0-9]/g, "_")}`,
    path: file, fingerprint: `shim:${file}` }));
  const end = { uuid: randomUUID(), parentUuid: last, type: "session_end", sessionId: session,
    timestamp: new Date().toISOString(), files_reviewed: files, duration_seconds: 0, llm_failures: 0,
    run_manifest: { schema_version: "ocr.run-manifest/v1", run_id: session, operation: "review",
      terminal_state: "complete", repository: {}, input: { mode: "range", requested_from: from, requested_head: to, resolved_head: sha || undefined },
      execution: { provider: "pi-skill", model }, elapsed_ms: 0,
      coverage: { selected: cov(files), completed: cov(files), reused: [], failed: [], waived: [] } } };
  lines.push(JSON.stringify(end));
  const dir = join(homedir(), ".opencodereview", "sessions", encodeRepoPath(repo));
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, session + ".jsonl"), lines.join("\n") + "\n", { mode: 0o600 });
    console.log(join(dir, session + ".jsonl"));
  } catch (e) { fail(4, `unwriteable session file: ${e.message}`); }
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "upsert") cmdUpsert(args);
else if (cmd === "diff") cmdDiff(args);
else if (cmd === "mark") cmdMark(args);
else if (cmd === "render") cmdRender(args);
else if (cmd === "shim") cmdShim(args);
else fail(2, USAGE);
