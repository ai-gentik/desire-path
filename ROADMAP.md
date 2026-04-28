# Desire Path — Roadmap

## Known issues / false positives

### Assistant-driven tool sequence detection (FIXED in checker v2)
The hook-pattern detector uses `Object.keys(session.tools)` to infer sequences, but `tools` is a frequency map — key order is insertion order, not temporal sequence. This caused pairs like `Read→Edit` to be flagged as automatable hooks even though they are procedurally required by the assistant (must read before editing).

**Fix applied:** blocklist of known assistant-workflow pairs (`Read→Edit`, `Read→Write`, `Bash→Bash`, `Read→Bash`, `Bash→Read`) is filtered before pattern scoring.

**Deeper fix (future):** record actual ordered tool call sequences in sessions.jsonl (an array, not a map) so sequence detection is based on real temporal order rather than key insertion order. This would also enable detecting *user*-initiated sequences vs assistant-initiated ones.

---

## What we currently capture
- Sessions: turns, tools used per session, skills invoked
- Usage totals: tool/skill frequency with compaction
- Paved paths and suggestion outcomes
- Bash commands (recent addition)

---

## 1. Hidden behaviors worth capturing

These are things users do repeatedly in Claude Code that leave no trace today:

### Permission denials
- Log when user **denies** a tool call (PreToolUse hook returning block)
- Pattern: same tool denied repeatedly → surface as "you keep blocking X, want to restrict it globally?"
- Reveals friction points in the permission model

### File co-access patterns
- Track which files get Read/Edited together in the same session
- Hot clusters → suggest workspace macros or workflow skills
- E.g. always reading `CLAUDE.md` before editing `settings.json`

### Repeated bash command fingerprints
- Already partially tracked — extend to detect near-duplicate commands across sessions
- `git status`, `npm run dev`, `cat some-file` — these are desire paths waiting to be hooks
- Surface top-5 repeated commands as hook candidates

### Tool retry / error patterns
- When a tool call fails and the same tool is retried immediately, log it
- Patterns: Edit failing → Read then Edit (user forgot to read first), Bash timing out
- Reveals where the workflow breaks down

### Skill invocation → outcome
- Did the skill actually get followed? Or did the user override it?
- Track: skill loaded but user said "skip this" or task diverged
- Identifies skills that need simplification

### Session time-of-day + duration
- Already have timestamps — extract hour-of-day and day-of-week
- Duration: `stop.at - start.at`
- Powers the heatmap (see below)

### MCP tool usage breakdown
- MCP calls are tool calls — break out `mcp__*` separately from core tools
- Which MCP servers get used? Which are installed but never touched (dead weight)?

---

## 2. Dashboard enhancements

All enhancements must strictly use the existing color scheme.

### Activity heatmap (hour × weekday)
- Classic GitHub-style grid: 7 rows (Mon–Sun) × 24 cols (hours)
- Cell color intensity = number of turns in that slot
- Reveals: when the user actually works, peak focus hours
- Data source: session timestamps (already captured)

### Skill usage trend (sparklines)
- Per-skill, show usage over last 30 days as a mini sparkline
- Identifies: skills that spiked then dropped (one-time use), growing skills (habits forming)

### Tool co-occurrence matrix
- Small heatmap: which tools get called in the same session?
- Read + Edit always together ✓ — Bash + WebSearch together → interesting signal

### Permission denial panel
- Simple list: "You've denied X tool N times this month"
- CTA: "Add to blocklist?" or "Pave a restriction rule"

### Paved path effectiveness
- For each paved skill/hook: was it invoked after paving?
- Dead paves (created but never triggered) are clutter — surface them for cleanup

### Session duration histogram
- Buckets: <5min, 5–15min, 15–30min, 30–60min, 60min+
- Reveals: are sessions getting longer (more complex work) or shorter (more efficient)?

---

## 3. Smarter desire path detection

Moving from "count what happened" to "understand why":

### Bash → Hook suggester
- After N sessions, scan top repeated bash commands
- Auto-generate hook YAML candidates: `"run npm test after Stop"`, `"show git status before Start"`
- Present in dashboard under "Suggested hooks"

### Conversation topic clustering
- Light NLP: extract noun phrases from session summaries (if available) or tool args
- Cluster into themes: "infrastructure", "frontend", "debugging", etc.
- Reveals: what the user actually spends time on vs. what skills exist for

### Stale skill detector
- Skills installed but not invoked in 30+ days
- Surface in dashboard with `/desire-path:cleanup` CTA

### Cross-session file hotspots
- Files touched in 3+ sessions → they're load-bearing, worth a Read shortcut or skill context
- Show as "frequently visited files" in dashboard

---

## 4. Capture infrastructure improvements

### Richer session metadata
- Add `model` field (which Claude model was active)
- Add `project` field (cwd hash or project name) for per-project breakdowns
- Add `denied_tools` array

### Structured suggestion feedback
- When a suggestion is dismissed, capture WHY (if askable): "not relevant", "already done", "too complex"
- Improves future suggestion quality

---

## Priority order

| # | Item | Effort | Value |
|---|------|--------|-------|
| 1 | Activity heatmap (session timestamps already exist) | Low | High |
| 2 | Repeated bash → hook suggester | Medium | High |
| 3 | Permission denial tracking | Low | Medium |
| 4 | Skill invocation outcome tracking | Medium | High |
| 5 | Stale skill detector | Low | Medium |
| 6 | File co-access patterns | Medium | Medium |
| 7 | Tool co-occurrence matrix | Medium | Low |
| 8 | Conversation topic clustering | High | Medium |
