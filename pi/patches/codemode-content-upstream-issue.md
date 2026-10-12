# Upstream issue draft: nondeterministic `content.some is not a function` (codemode)

Target: https://github.com/earendil-works/pi-coding-agent (or current pi repo) - file once repro confirms.

## Symptom

While running nested `local_bash` calls inside the codemode tool with large or
tricky stdout (backtick-heavy minified bundles, long grep output), the call
fails nondeterministically with:

    Error: content.some is not a function

The same command succeeds on retry. Frequency observed: ~2 crashes across a
long session, plus 1 more on a `grep -n` over a minified bundle chunk.

## Suspected cause

Somewhere in the codemode result-conversion path the tool result `content` is
assumed to be an array and `.some(...)` (or similar) is called on it, but a
string arrives when the nested tool result shape changes mid-flight (large
output, RTK compaction rewriting the result, or truncation). Guarded sites
(e.g. sdk.js convertToLlmWithBlockImages, agent-session.js tool-call counter)
use `Array.isArray` first; at least one site did not:

- `dist/core/bug-report.js`: `response.content.some(...)` unguarded (fixed
  locally via `pi/patches/fix-codemode-content.mjs`, marker
  `pi-agent-setup patch v1: guard response.content array`).

## Repro

1. Paste `pi/patches/repro-codemode-content.mjs` into the codemode tool.
2. It loops 16 nested `local_bash` calls (large/tricky outputs, 2 rounds).
3. Count results containing `content.some`. Before fix: intermittent > 0.

## Environment

- pi 1.1.0 (managed install), WSL2 Ubuntu, kernel 6.18
- pi-rtk-optimizer output compaction active (may rewrite result shapes)

## Ask

Harden the codemode tool-result conversion to normalize string `content` to
`[{type:'text',text}]` before any array method, or find and guard the exact
unguarded call site for nested-tool large outputs.
