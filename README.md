# 🛤 desire-path — Claude Code Plugin

> *"Don't design the paths first. Watch where people walk, then pave those routes."*

Desire Path is a **silent background observer** for Claude Code. It watches how you actually work — which tools fire, what you keep asking, which sequences repeat — and surfaces shortcuts you didn't know you were cutting.

You configure nothing. You ask for nothing. You just work.

---

## Install

```bash
# Test locally (current session only)
claude --plugin-dir /path/to/desire-path-plugin

# Install permanently
cp -r desire-path-plugin ~/.claude/plugins/desire-path
```

Add to `~/.claude/settings.json`:
```json
{ "plugins": ["~/.claude/plugins/desire-path"] }
```

**Requirements:** Node.js 18+ (already required by Claude Code)

---

## How it works

```
You work normally
     ↓
Hooks log every prompt, tool, skill silently (async, never blocks)
     ↓
After 5 new sessions → analysis flag set
     ↓
Next Stop hook: checker.js runs
  • Fast local heuristics (no API call needed)
  • Strong pattern → optional Haiku refinement
  • Pattern found → {"decision":"block","reason":"[desire-path]..."}
     ↓
Claude surfaces the suggestion naturally at end of response
     ↓
You say yes → /desire-path:suggest writes the artifact to disk
     ↓
Dashboard shows: detected → proposed → paved → usage → cleanup
```

---

## Hooks

| Event | Type | What |
|---|---|---|
| `UserPromptSubmit` | async | Logs prompts, detects suggestion acceptance |
| `PostToolUse` | async | Logs tools, skill invocations, hook executions |
| `InstructionsLoaded` | async | Tracks which skills auto-load |
| `Stop` #1 | async | Flushes session, compacts files if needed |
| `Stop` #2 | blocking | Pattern check — blocks Claude only if suggestion ready |

---

## Skills

| Command | What it does |
|---|---|
| `/desire-path:suggest` | Writes skill / hook / agent / CLAUDE.md addition to disk |
| `/desire-path:cleanup` | Interactive removal of dead/stale artifacts |
| `/desire-path:dashboard` | Generates and opens HTML dashboard in browser |

---

## Agent

`@agent-pattern-detector` — deep analysis. Use for weekly reviews or when you want a full picture across all sessions.

---

## What gets created

| Pattern detected | Artifact written |
|---|---|
| Repeated project context every session | `~/.claude/CLAUDE.md` addition |
| Repeated prompt template | `~/.claude/skills/<n>/SKILL.md` |
| Always X then Y tool sequence | Hook in `~/.claude/settings.json` |
| Complex multi-turn workflow | `~/.claude/agents/<n>.md` |

---

## Data

All data in `~/.claude/desire-path/`. Self-compacting: `sessions.jsonl` stays under 100 entries, `usage.jsonl` under 200 rows — older data aggregated automatically on every Stop.

---

## Dashboard

Three tabs: **Overview** (activity, tool usage, paved paths), **Patterns** (detected + proposed), **Inventory** (full artifact audit with dead/stale flags).

Run `/desire-path:dashboard` to open.
