# desire-path — Claude Code context

## Architecture snapshot

**Dashboard server**: `localhost:2337` — served by `scripts/dashboard.js`, output is `~/.claude/desire-path/dashboard.html`. The Stop hook regenerates it after every session.

**Data files** (all in `~/.claude/desire-path/`):
- `sessions.jsonl` — rolling 100-session window
- `sessions-archive.json` — compacted older sessions (`total_sessions`, `tool_totals`, `skill_totals`)
- `latest-analysis.json` — pattern analysis output; `_session_count_at_analysis` tracks staleness
- `paved.jsonl` — record of paved patterns (type, name, trigger, timestamp)
- `suggestions.jsonl` — per-session suggestions log with outcomes
- `usage.jsonl` — paved-path usage events

**Plugin location**: `~/.claude/plugins/cache/ai-gentik/desire-path/{version}/`
- `scripts/dashboard.js` — dashboard generator (reads data files, writes dashboard.html)
- `scripts/checker.js` — lightweight per-session pattern checker (runs at Stop)
- `agents/pattern-detector/` — deep analysis agent

## Pattern detector — write path

The pattern-detector subagent **must use the `Write` tool** to persist `latest-analysis.json`. Using `ctx_execute` fails in subagent contexts (tool denied). The `ctx_execute` permission is also in the project allowlist as a fallback, but `Write` is the reliable path.

## Paving workflow

1. `desire-path:review` — read current analysis, present patterns
2. `desire-path:suggest` — write artifact (skill/hook/claude_md), append to `paved.jsonl`
3. `desire-path:cleanup` — remove dead/stale paved paths
4. Pattern-detector agent — deep analysis on demand, writes `latest-analysis.json`
