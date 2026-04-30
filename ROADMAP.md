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
- **Five artifact types** including `command` (user-fired prompt with stable steps + variable args), distinct from `skill` (auto-loaded playbook for variably-phrased problems)
- **Stable pattern fingerprints** — sha1 of `(type, normalized_trigger)` carried through `latest-analysis.json`, `paved.jsonl`, and `suggestions.jsonl` so dedup survives phrasing changes
- **Surface vs storage threshold split** — pattern detection persists at n≥4 but the Stop-hook only interrupts at n≥6 or when Haiku agrees with the local detector
- **Outcome-weighted confidence** — types whose recently-paved artifacts are mostly dead get demoted automatically until the user starts using them again
- **CLAUDE.md token-budget guard** — `suggest` warns at >2KB, refuses at >5KB and proposes a skill instead
- **Offline mode** — `DESIRE_PATH_OFFLINE=1` disables the optional Haiku refinement; everything else still works
- **Pull-mode review** — `/desire-path:review` shows current patterns without writing, for users who'd rather check in than be nudged

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

## Trust & quality (new track)

The biggest risk to adoption is suggestion noise. These items raise the signal-to-noise ratio of what surfaces.

### Dashboard surface for fingerprints & outcome weights
- Show the active fingerprint dedup set and the per-type outcome weights on the Patterns tab
- Lets users *see* why a pattern they expected isn't being suggested (e.g. "demoted because 3 of your last 5 skills went unused")
- Closes the explanation gap on the smarter detector

### Pattern-detector outcome telemetry
- Currently `outcomeWeights()` runs in checker.js but the deep agent doesn't read inventory yet
- Have `@agent-pattern-detector` produce per-type acceptance and survival stats and write them to `latest-analysis.json` so the dashboard can show "Skills you create stick 4/5 of the time; commands stick 1/3"

### Per-pattern surface threshold tuning
- Today the surface gate is a single rule (`freq ≥ 6` or Haiku agreement). Make it per-type: hooks should require ≥7, claude_md only ≥4, etc.
- Reflects that hook false positives are more painful than CLAUDE.md ones

### Team-share guidance
- When a pattern is paved at project scope, surface a one-liner reminding the user to commit `.claude/skills/` or `.claude/commands/` so teammates get the same paths
- Optional: detect if `.claude/` is gitignored and warn

---

## Priority order

| # | Item | Track | Effort | Value | Status |
|---|------|-------|--------|-------|--------|
| 1 | Activity heatmap | infra | Low | High | ✅ done |
| 2 | Repeated bash → hook suggester | pave | Medium | High | ✅ done |
| 3 | Fix assistant-driven false positives | infra | Low | High | ✅ done |
| 4 | Permission denial tracking | pave | Low | Medium | ✅ done |
| 5 | Stale skill detector | pave | Low | Medium | ✅ done |
| 6 | Command artifact + skill/command split | infra | Medium | High | ✅ done |
| 7 | Pattern fingerprint dedup | trust | Low | High | ✅ done |
| 8 | Surface vs storage threshold split | trust | Low | High | ✅ done |
| 9 | Outcome-weighted confidence | trust | Medium | High | ✅ done |
| 10 | CLAUDE.md token-budget guard | trust | Low | Medium | ✅ done |
| 11 | Offline mode (`DESIRE_PATH_OFFLINE`) | infra | Low | Medium | ✅ done |
| 12 | Pull-mode `/desire-path:review` | infra | Low | Medium | ✅ done |
| 13 | File co-access patterns | pave | Medium | High | — |
| 14 | Cross-session file hotspots | pave | Low | Medium | — |
| 15 | Tool retry / error patterns | pave | Medium | Medium | — |
| 16 | MCP tool usage + dead weight | pave | Low | Medium | — |
| 17 | Permission denial → suggestion CTA | pave | Low | Medium | — |
| 18 | Bad prompting patterns | reroute | Medium | High | — |
| 19 | Dashboard surface for fingerprints & outcome weights | trust | Low | Medium | — |
| 20 | Pattern-detector outcome telemetry | trust | Medium | Medium | — |
| 21 | Per-pattern surface threshold tuning | trust | Low | Medium | — |
| 22 | Team-share guidance for project-scoped artifacts | pave | Low | Medium | — |
| 23 | SSE-reactive dashboard (static HTML + server push) | infra | Medium | High | ✅ done |
| 24 | Filter resolved patterns at write time in checker | trust | Low | High | ✅ done |
