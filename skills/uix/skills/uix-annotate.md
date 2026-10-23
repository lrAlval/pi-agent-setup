# Annotate
1. Load lavish output or hand-authored feedback.json.
2. Validate with node scripts/validate-feedback.mjs <path>; invalid blocks application.
3. Apply p0 through p3, preserving unrelated work.
4. Re-shot affected widths, compare deltas, report evidence and next fix.
5. Without lavish, use hand-authored schema-valid file.