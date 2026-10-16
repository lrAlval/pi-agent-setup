#!/usr/bin/env python3
"""Session-history tooling analyzer (report-only, stdout only, never writes).

Mines ~/.pi/agent/sessions JSONL files for 3 recurring failure families:
plan-mode policy blocks, local-bash denylist hits, codemode script errors.

Usage:
  python3 ~/.pi/agent/scripts/session-tool-analyzer.py [--days N] [--project NAME] [--top N] [--quiet]
Exit codes: 0 ok; 2 no files matched / bad args; 3 >1% junk lines.
Python 3.8+, stdlib only.
"""
import argparse
import json
import re
import sys
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional

RE_PLAN_BASH = re.compile(r"Plan mode blocks bash commands? ([^\\\"]{0,160})")
RE_PLAN_TOOL = re.compile(r"Plan mode blocks tool '([^']+)'")
RE_PLAN_POLICY = re.compile(
    r"Plan mode blocks tool .{0,40}(frozen|unavailable|built-in policy|not registered)"
)
RE_DENYLIST = re.compile(r"local-bash denylist: blocked: ([a-zA-Z \-]{5,60})")
RE_CODEMODE = re.compile(r"Script error:\s*\\n(\w*(?:Error|Exception))[^\\n]{0,80}")
RE_TOOLNAME = re.compile(r'"toolName"\s*:\s*"([a-zA-Z_\-]+)"')


@dataclass
class Stats:
    plan_bash_block_reasons: Counter = field(default_factory=Counter)
    plan_tool_blocks: Counter = field(default_factory=Counter)
    plan_policy_variants: Counter = field(default_factory=Counter)
    denylist_categories: Counter = field(default_factory=Counter)
    codemode_error_classes: Counter = field(default_factory=Counter)
    tool_calls: Counter = field(default_factory=Counter)
    sessions_with_findings: set = field(default_factory=set)
    files_analyzed: int = 0
    lines_scanned: int = 0
    line_errors: int = 0


@dataclass
class SessionDoc:
    path: str
    project: str
    mtime_epoch: float


def iter_sessions(
    base: Path = Path.home() / ".pi/agent/sessions",
    days: Optional[int] = None,
    project: Optional[str] = None,
) -> List[SessionDoc]:
    if not base.is_dir():
        return []
    cutoff = time.time() - days * 86400 if days is not None else None
    docs: List[SessionDoc] = []
    for path in base.glob("--*/*.jsonl"):
        if project and project not in path.parent.name:
            continue
        try:
            mtime = path.stat().st_mtime
        except OSError:
            continue
        if cutoff is not None and mtime < cutoff:
            continue
        docs.append(SessionDoc(str(path), path.parent.name, mtime))
    docs.sort(key=lambda d: d.mtime_epoch)
    return docs


def classify(lines: Iterable[str], doc: SessionDoc) -> Stats:
    s = Stats()
    s.files_analyzed = 1
    found = False
    for line in lines:
        line = line.strip()
        if not line:
            continue
        s.lines_scanned += 1
        try:
            obj = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            s.line_errors += 1
            continue
        text = json.dumps(obj)
        raw = line
        seen_this_line = False
        for m in RE_PLAN_BASH.finditer(text):
            reason = (m.group(1) or "").strip()[:120] or "<other>"
            s.plan_bash_block_reasons[reason] += 1
            seen_this_line = True
        for m in RE_PLAN_TOOL.finditer(text):
            name = m.group(1).strip()[:80] or "<other>"
            if "${" in name or name.startswith("(") or name.startswith("["):
                name = "<template>"
            s.plan_tool_blocks[name] += 1
            seen_this_line = True
        for m in RE_PLAN_POLICY.finditer(text):
            s.plan_policy_variants[m.group(1)] += 1
            seen_this_line = True
        for m in RE_DENYLIST.finditer(text):
            cat = m.group(1).strip()[:60] or "<other>"
            s.denylist_categories[cat] += 1
            seen_this_line = True
        for m in RE_CODEMODE.finditer(text):
            cls = m.group(1).strip()[:60] or "<other>"
            s.codemode_error_classes[cls] += 1
            seen_this_line = True
        for m in RE_TOOLNAME.finditer(raw):
            s.tool_calls[m.group(1)] += 1
        if seen_this_line:
            found = True
    if found:
        s.sessions_with_findings.add(Path(doc.path).stem)
    return s


def merge(base: Stats, other: Stats) -> Stats:
    for f in (
        "plan_bash_block_reasons",
        "plan_tool_blocks",
        "plan_policy_variants",
        "denylist_categories",
        "codemode_error_classes",
        "tool_calls",
    ):
        getattr(base, f).update(getattr(other, f))
    base.sessions_with_findings |= other.sessions_with_findings
    base.files_analyzed += other.files_analyzed
    base.lines_scanned += other.lines_scanned
    base.line_errors += other.line_errors
    return base


def _top(counter: Counter, top_n: int) -> List[str]:
    if not counter:
        return ["  0 results"]
    return [f"  {c:>6}  {k}" for k, c in counter.most_common(top_n)]


def suggest(stats: Dict[str, Stats], top_n: int = 5) -> List[str]:
    out: List[str] = []
    agg = Stats()
    for s in stats.values():
        merge(agg, s)
    for tool, c in agg.plan_tool_blocks.most_common(top_n):
        if tool == "<template>":
            out.append(
                f"plan tool block template message ({c} hits) -> fix message interpolation, not policy"
            )
        else:
            out.append(f"'{tool}' blocked ({c} hits) -> review if read-only use deserves allowlist")
    for cat, c in agg.denylist_categories.most_common(top_n):
        out.append(f"denylist '{cat.strip()}' ({c} hits) -> document safe alternative in skill")
    if not out:
        out.append("0 results - no tuning candidates")
    return out


def render_report(stats: Dict[str, Stats], top_n: int, quiet: bool) -> str:
    agg = Stats()
    for s in stats.values():
        merge(agg, s)
    if quiet:
        return (
            f"sessions={agg.files_analyzed} lines={agg.lines_scanned} "
            f"plan_blocks={sum(agg.plan_tool_blocks.values()) + sum(agg.plan_bash_block_reasons.values())} "
            f"denylist={sum(agg.denylist_categories.values())} "
            f"codemode_errors={sum(agg.codemode_error_classes.values())} "
            f"junk={agg.line_errors}\n"
        )
    L: List[str] = []
    L.append("== Session corpus ==")
    L.append(f"  files analyzed: {agg.files_analyzed}")
    L.append(f"  lines scanned: {agg.lines_scanned}")
    L.append(f"  junk lines tolerated: {agg.line_errors}")
    L.append(f"  sessions with findings: {len(agg.sessions_with_findings)}")
    if not stats:
        L.append("  0 sessions")
    L.append("")
    L.append("== Plan-mode blocks: tools ==")
    L.extend(_top(agg.plan_tool_blocks, top_n))
    L.append("== Plan-mode blocks: bash reasons ==")
    L.extend(_top(agg.plan_bash_block_reasons, top_n))
    L.append("== Plan-mode blocks: policy variants ==")
    L.extend(_top(agg.plan_policy_variants, top_n))
    L.append("== local-bash denylist ==")
    L.extend(_top(agg.denylist_categories, top_n))
    L.append("== codemode errors ==")
    L.extend(_top(agg.codemode_error_classes, top_n))
    L.append("== Tool call volume ==")
    L.extend(_top(agg.tool_calls, top_n))
    L.append("== Suggested tuning candidates ==")
    for line in suggest(stats, top_n):
        L.append(f"  - {line}")
    return "\n".join(L) + "\n"


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Analyze session history for tooling failures (report-only).")
    ap.add_argument("--days", type=int, default=None)
    ap.add_argument("--project", type=str, default=None)
    ap.add_argument("--top", type=int, default=20)
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)
    if (args.days is not None and args.days < 1) or args.top < 1:
        ap.error("--days must be >=1 and --top >=1")
        return 2
    docs = iter_sessions(days=args.days, project=args.project)
    if not docs:
        print("0 sessions")
        return 2
    per_project: Dict[str, Stats] = {}
    for doc in docs:
        key = doc.project
        st = per_project.setdefault(key, Stats())
        try:
            with open(doc.path, "r", encoding="utf-8", errors="replace") as f:
                one = classify(f, doc)
        except OSError:
            one = Stats()
            one.line_errors += 1
        merge(st, one)
    agg_lines = sum(s.lines_scanned for s in per_project.values())
    agg_junk = sum(s.line_errors for s in per_project.values())
    sys.stdout.write(render_report(per_project, args.top, args.quiet))
    if agg_lines and agg_junk / agg_lines > 0.01:
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
