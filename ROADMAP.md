# Desire Path — Roadmap

## Core concept

A desire path is a behavior users repeat manually that could be automated or improved.
Desire-path has two tracks:

- **Pave the path** — detect repeated manual behaviors → suggest automation (hooks, skills, shortcuts)
- **Reroute the path** — detect repeated bad habits → suggest a better way to work

---

## What we currently capture
- Sessions: turns, tools used per session, skills invoked
- Usage totals: tool/skill frequency with compaction
- Slash commands and agent dispatches
- Paved paths and suggestion outcomes (including dismissed tracking)
- Bash commands (repeated command detection)
- Permission denials
- Activity heatmap (hour × weekday)
- Stale skill detection
- Live dashboard server (localhost:2337) with Map tab — aerial SVG of artifacts + desire lines
- Two-tier pattern analysis: fast local heuristics + optional Haiku refinement
- Suggestion log with status pills (detected → proposed → paved / dismissed)

---

## Track 1 — Pave the path

Detect what users do repeatedly and help them stop doing it manually.

### File co-access patterns
- Track which files get Read/Edited together in the same session
- Hot clusters → suggest workspace macros or workflow skills
- E.g. always reading `CLAUDE.md` before editing `settings.json`

### Cross-session file hotspots
- Files touched in 3+ sessions → they're load-bearing, worth a Read shortcut or skill context
- Show as "frequently visited files" in dashboard with a "create shortcut" CTA

### Tool retry / error patterns
- When a tool call fails and the same tool is retried immediately, log it
- E.g. Edit failing → Read then Edit (forgot to read first) → suggest a pre-Edit Read hook
- Reveals where the workflow breaks down repeatedly

### MCP tool usage breakdown
- Break out `mcp__*` tool calls separately from core tools
- Surface MCP servers that are installed but never used → "dead weight" CTA to remove them

### Permission denial → restriction suggestion
- Already capturing denials — close the loop with an actionable suggestion
- Pattern: same tool denied 3+ times → "You keep blocking X, want to restrict it globally?"

---

## Track 2 — Reroute the path

Detect repeated bad habits and surface a better path.

### Bad prompting patterns
- **Vague openers without context**: "do X", "fix Y" without file paths or steps → suggest including context
- **Correction loops**: user sends a prompt then immediately sends a correction → the original was underspecified
- **Over-delegation**: asking Claude to "figure out" architecture → suggest specifying constraints first
- Output: "Your last 5 sessions had 2+ correction turns each — adding file paths to your first message tends to land better on the first try"
- Detection based on structural patterns only (turn count, correction rate) — not prompt content

---

## Priority order

| # | Item | Track | Effort | Value | Status |
|---|------|-------|--------|-------|--------|
| 1 | Activity heatmap | infra | Low | High | ✅ done |
| 2 | Repeated bash → hook suggester | pave | Medium | High | ✅ done |
| 3 | Fix assistant-driven false positives | infra | Low | High | ✅ done |
| 4 | Permission denial tracking | pave | Low | Medium | ✅ done |
| 5 | Stale skill detector | pave | Low | Medium | ✅ done |
| 6 | File co-access patterns | pave | Medium | High | — |
| 7 | Cross-session file hotspots | pave | Low | Medium | — |
| 8 | Tool retry / error patterns | pave | Medium | Medium | — |
| 9 | MCP tool usage + dead weight | pave | Low | Medium | — |
| 10 | Permission denial → suggestion CTA | pave | Low | Medium | — |
| 11 | Bad prompting patterns | reroute | Medium | High | — |
