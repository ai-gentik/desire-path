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
| `/desire-path:review` | Pull-mode: show current patterns without paving anything |
| `/desire-path:suggest` | Writes command / skill / hook / agent / CLAUDE.md addition to disk |
| `/desire-path:cleanup` | Interactive removal of dead/stale artifacts |
| `/desire-path:dashboard` | Starts live dashboard server at localhost:2337 and opens in browser |
| `/desire-path:stop-server` | Stops the dashboard server |

---

## Agent

`@agent-pattern-detector` — deep analysis. Use for weekly reviews or when you want a full picture across all sessions.

---

## What gets created

| Pattern detected | Artifact written |
|---|---|
| Repeated project context every session | `~/.claude/CLAUDE.md` addition |
| User-fired prompt with stable steps + variable args | `~/.claude/commands/<n>.md` |
| Recurring class of question phrased differently | `~/.claude/skills/<n>/SKILL.md` |
| Always X then Y tool sequence (deterministic) | Hook in `~/.claude/settings.json` |
| Complex multi-turn workflow on a stable subdomain | `~/.claude/agents/<n>.md` |

Project-scoped versions are written under `<project>/.claude/...` instead — useful for artifacts teammates should share via git.

---

## Data

All data in `~/.claude/desire-path/`. Self-compacting: `sessions.jsonl` stays under 100 entries, `usage.jsonl` under 200 rows — older data aggregated automatically on every Stop.

Tracked per session: prompts, tool calls, skill invocations, slash commands, agent dispatches, hook executions, permission denials.

---

## Privacy

Everything the plugin records lives in `~/.claude/desire-path/` on your machine. Nothing is uploaded by default.

**One optional outbound call**: when `ANTHROPIC_API_KEY` is set in the environment, the Stop-hook checker may send a short summary of the last ≤10 sessions (tools used, skill names, top bash commands, prompt prefixes truncated to 50 chars) to Claude Haiku to refine a *strong* local detection. This is an opt-in via the env var, capped at one call per Stop, and bypassed entirely if the local detector found nothing worth refining.

**To disable the Haiku call entirely**, set:

```bash
export DESIRE_PATH_OFFLINE=1
```

The plugin then runs purely on local heuristics — no outbound traffic, no API key needed. The deep `@agent-pattern-detector` agent still works (it runs through your normal Claude Code session, not a side channel).

**To stop logging entirely**, remove the plugin from `~/.claude/settings.json` or delete `~/.claude/desire-path/`. There's no telemetry to opt out of beyond that.

---

## Dashboard

Live HTTP server at `localhost:2337` — starts automatically on session load via `InstructionsLoaded` hook.

Four tabs: **Overview** (activity, tool usage, paved paths), **Map** (aerial SVG of artifacts + desire lines across sessions), **Patterns** (detected + proposed, with paved/dismissed status), **Inventory** (full artifact audit with dead/stale flags).

Run `/desire-path:dashboard` to start/open, `/desire-path:stop-server` to kill.
