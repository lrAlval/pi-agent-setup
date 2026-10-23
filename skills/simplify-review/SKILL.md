---
name: simplify-review
description: Run a ponytail simplification pass over new or complex code. Use on demand, when complexity-nudge fires, or before merging large diffs. Wraps ponytail-review; findings are fixed or dismissed with reason.
---

# Simplify-review — complexity pass

Triggered on demand or by the `complexity-nudge` extension (ΔLOC > 600,
per-file cyclomatic > 15, or file > 400 new LOC; thresholds in its
config.json). Never loops: a nudge fires at most twice per session.

## Procedure

1. Scope: the diff or file set under review (from the nudge or the request).
2. Run the `ponytail-review` pass (quality: logic, safety, load behavior,
   risky-code tests, speed, dead code) with simplification bias: delete,
   merge, or split before optimizing.
3. Report findings ranked, each in plain language with file:line.
4. Fix each finding or dismiss with an explicit reason. Silent skips fail
   the review.
5. Re-run tests/lint on touched code; record evidence.

## Pitfalls

- Fixing style while missing structural bloat; structure first.
- Dismissing without reason; the reason is the record.
- Running mid-skill-flow unasked; the nudge recommends, the human decides
  (except when the requester explicitly asked).
