---
name: suggest
description: >
  Pave a detected desire path — write a skill file, add a hook, update CLAUDE.md,
  or create an agent based on a detected usage pattern. Use when the user says "yes"
  to a desire-path suggestion, or asks to create a shortcut for something they repeat.
  Arguments: optional description or "latest" to use last detected pattern.
---

# Desire Path: Pave This Path

Arguments: `$ARGUMENTS`

## Step 1 — Load the pattern

If `$ARGUMENTS` is empty or "latest":
1. Read `~/.claude/desire-path/latest-analysis.json`. Find the highest-ranked entry in `top_paths` where `_resolved` is **not** `true`. That is the pattern to pave next.
2. If no unresolved pattern found in `top_paths`, fall back to `~/.claude/desire-path/last-suggestion.json`.

Tell the user which pattern you're paving and how many unresolved ones remain (e.g. "Paving pattern 2 of 5 — X more after this.").

Otherwise use `$ARGUMENTS` as the description of the workflow to pave.

## Step 2 — Decide what to create

| Pattern type | Best artifact | Why |
|---|---|---|
| User-fired prompt with fixed steps + variable args | command | Invoke explicitly as `/slug <args>`; no judgement branching |
| Recurring class of question/task with flexible reasoning | skill | Auto-loads via description match |
| Always-on context (every session) | CLAUDE.md addition | Loaded automatically, zero friction |
| Post-tool automation | hook | Deterministic, no prompt needed |
| Complex multi-step flow | agent | Isolated context, own tool config |

If the pattern object already has a `suggested_artifact.type`, trust it. Otherwise infer from the matrix above. **Command vs skill**: if the steps are a numbered list with `$ARGUMENTS` and no branching on Claude's judgement, it's a command.

## Step 2.5 — Determine scope

Check `pattern.scope`:

- **`"project"`**: The pattern was detected mostly in one project (`pattern.project_cwd`). Default to **project-scoped** artifact — ask: *"This pattern seems specific to `<project_name>`. Add it just for that project, or globally for all projects?"*
- **`"global"`** or no scope: Default to **global** artifact.
- **No `cwd` data**: Ask: *"Should this apply to all your projects (global) or just the current one (`<basename of cwd>`)?"*

The answer determines where artifacts are written (see Step 3).

## Step 3 — Write the artifact

### CLAUDE.md size guard (run before either CLAUDE.md branch below)

Before writing, measure the target CLAUDE.md byte size:

- **Size > 5120 bytes (≈5KB)**: refuse the CLAUDE.md addition. Tell the user: *"Your CLAUDE.md is already <N>KB and would be loaded into every session's context. Adding more risks token bloat. I'd suggest a skill instead — same trigger, but only loads when relevant."* Then offer to create a skill version using the same pattern. Do not write to CLAUDE.md.
- **Size > 2048 bytes (≈2KB)**: warn and confirm. Tell the user the current size + that the addition will permanently cost tokens in every session. Only proceed on explicit confirmation.
- **Size ≤ 2048 bytes**: proceed silently.

If the target file does not exist yet, treat its size as 0.

### For a global CLAUDE.md addition:
Read `~/.claude/CLAUDE.md`. Add a concise section at the bottom:
```markdown
## [Pattern name]
[1-3 lines of always-on instruction derived from the pattern]
```
Write the file. Don't duplicate existing content.

### For a project CLAUDE.md addition:
Read `<project_cwd>/.claude/CLAUDE.md` (create if missing). Add a concise section at the bottom:
```markdown
## [Pattern name]
[1-3 lines of always-on instruction derived from the pattern]
```
Write the file. Don't duplicate existing content.

### For a global skill:
Create `~/.claude/skills/<slug>/SKILL.md`:
```markdown
---
name: <slug>
description: >
  <One sentence with the exact phrases the user repeats — triggers auto-loading>
---
# <Title>
<Instructions derived from the repeated prompts>
```

### For a project skill:
Create `<project_cwd>/.claude/skills/<slug>/SKILL.md` with the same format. Available only within that project — useful for project-specific workflows that teammates can share via version control.

### For a global command:
Create `~/.claude/commands/<slug>.md`:
```markdown
---
description: <one sentence — shown in the slash-command picker>
---
# <Title>

Arguments: `$ARGUMENTS`

1. <Step one, referencing $ARGUMENTS where relevant>
2. <Step two>
3. <Step three>
```
Steps must be deterministic (no "decide whether to…"). If the pattern needs judgement, write a skill instead.

### For a project command:
Create `<project_cwd>/.claude/commands/<slug>.md` with the same format. Invokable as `/slug` only within that project — commit `.claude/commands/` to share with teammates.

### For a global hook:
Read `~/.claude/settings.json`. Merge in the new hook, preserve all existing ones:
```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "<ToolName>",
      "hooks": [{ "type": "command", "command": "<cmd>", "async": true }]
    }]
  }
}
```

### For a project hook:
Read `<project_cwd>/.claude/settings.json` (create if missing). Merge in the new hook:
```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "<ToolName>",
      "hooks": [{ "type": "command", "command": "<cmd>", "async": true }]
    }]
  }
}
```

### For a global agent:
Create `~/.claude/agents/<slug>.md`:
```markdown
---
name: <slug>
description: <when to spawn — include trigger keywords>
model: sonnet
effort: medium
maxTurns: 15
---
<System prompt derived from the repeated workflow>
```

### For a project agent:
Create `<project_cwd>/.claude/agents/<slug>.md` with the same format. Available only within that project — useful for project-specific review or automation agents teammates can share via version control.

## Step 4 — Log and confirm

Append to `~/.claude/desire-path/paved.jsonl`. Copy the `fingerprint` from the pattern's `suggested_artifact.fingerprint` (or from the top-level entry's `fingerprint`) so cleanup and the detector can dedup reliably:
```json
{"timestamp":"<iso>","type":"<claude_md|command|skill|hook|agent>","name":"<slug>","trigger":"<what>","fingerprint":"<10-hex-from-pattern>"}
```
If the pattern has no `fingerprint` (older entry), omit the field — the next analysis run will backfill it.

Tell the user what was created, where it lives, and how it activates:
- Global CLAUDE.md: "Added to `~/.claude/CLAUDE.md` — active in all projects from your next session."
- Project CLAUDE.md: "Added to `<project>/.claude/CLAUDE.md` — active only in that project from your next session."
- Global skill: "Auto-triggers when you ask about [x]. Available in all projects."
- Project skill: "Auto-triggers when you ask about [x]. Available in `<project>` only — commit `.claude/skills/` to share with teammates."
- Global command: "Run `/slug <args>` in any project."
- Project command: "Run `/slug <args>` in `<project>` only — commit `.claude/commands/` to share with teammates."
- Global hook: "Added to `~/.claude/settings.json` — fires automatically in all projects after every [ToolName] call."
- Project hook: "Added to `<project>/.claude/settings.json` — fires only in that project after every [ToolName] call."
- Global agent: "Spawned by Claude when [trigger]. Available in all projects."
- Project agent: "Spawned by Claude when [trigger]. Available in `<project>` only — commit `.claude/agents/` to share with teammates."

## Step 5 — Log the suggestion outcome

After writing the artifact:

1. Mark the pattern as resolved in `~/.claude/desire-path/latest-analysis.json` by setting `"_resolved": true` on the matching entry in `top_paths` (match by rank). Write the updated file back.

2. Append to `~/.claude/desire-path/suggestions.jsonl`. Ensure `pattern.fingerprint` is preserved on the embedded object (carry it over from the original pattern):
```json
{"at":"<iso>","sid":"<session>","pattern":<pattern_object_with_fingerprint>,"outcome":"accepted","artifact_created":"<slug>"}
```

Marking `_resolved` directly in `latest-analysis.json` is the source of truth — it survives description changes and rank changes between analysis runs. When the next deep analysis runs it generates a fresh file, so stale resolved state is automatically cleared.

This closes the feedback loop: the dashboard can show what was suggested, what got accepted, and whether the created artifact is actually being used.
