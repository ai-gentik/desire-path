---
name: review
description: >
  Pull-mode pattern review — show the current desire-path analysis without waiting
  for a Stop-hook nudge. Use when the user asks "what patterns have you noticed",
  "show me my desire paths", "review my Claude Code habits", or wants a quiet check-in
  instead of being interrupted by suggestions.
---

# Desire Path: Review

Read-only counterpart to `/desire-path:suggest`. Surfaces what the detector has found without writing anything.

## Step 1 — Read the latest analysis

Read `~/.claude/desire-path/latest-analysis.json`. Note:
- `_session_count_at_analysis` — when this was generated
- `_generated_by` — `checker-local` (cheap heuristic) or `pattern-detector` (deep analysis)
- `top_paths` — patterns ordered by rank
- `stats` — context numbers

If the file does not exist, tell the user: *"No analysis yet — keep working and the detector will fill this in after a few sessions."* Stop.

## Step 2 — Check freshness

Compute `staleness = current_total_sessions - _session_count_at_analysis`. The current total is the line count of `~/.claude/desire-path/sessions.jsonl` plus `total_sessions` from `~/.claude/desire-path/sessions-archive.json`.

- **staleness < 5**: analysis is fresh. Continue to Step 3.
- **staleness 5–24**: tell the user the analysis is N sessions old and continue.
- **staleness ≥ 25**: tell the user the analysis is significantly stale and offer to invoke `@agent-pattern-detector` for a fresh deep analysis. If they decline, continue with the existing data.

## Step 3 — Present patterns

For each entry in `top_paths` (cap at 5), show one tight block:

```
[rank]. [type] · [frequency]× · [scope]
        [description]
        → suggested: [suggested_artifact.type] "[suggested_artifact.name]"
        rationale: [suggested_artifact.rationale]
```

Mark entries where `_resolved: true` as already paved (strike through or grey them out conceptually). Skip entries whose `fingerprint` appears in `~/.claude/desire-path/paved.jsonl` (defensive — they should already be `_resolved`).

If `top_paths` is empty, tell the user: *"Nothing strong enough to suggest right now — your workflow is either varied or already well-paved."* Then show `stats` so the review still has value.

## Step 4 — Offer next actions, do not auto-act

End with a single line offering the next step, no more:

- If at least one unresolved pattern exists: *"Run `/desire-path:suggest` to pave the top one, or pass `latest` to walk through them."*
- If everything is resolved or empty: *"Run `/desire-path:dashboard` to see usage of paved paths, or `/desire-path:cleanup` to prune dead ones."*

This skill never writes to disk. It is the quiet, pull-based alternative to the Stop-hook nudges.
