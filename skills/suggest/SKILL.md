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
1. Read `~/.claude/desire-path/suggestions.jsonl` and collect all `pattern.type` values where `outcome === "accepted"` → call this `acceptedTypes`.
2. Read `~/.claude/desire-path/latest-analysis.json`. Find the highest-ranked entry in `top_paths` whose `type` is **not** in `acceptedTypes`. If found, use that as the pattern.
3. If no unpaved pattern found in `top_paths`, fall back to `~/.claude/desire-path/last-suggestion.json`.

Tell the user which pattern you're paving and how many unpaved ones remain (e.g. "Paving pattern 2 of 5 unpaved — X more after this.").

Otherwise use `$ARGUMENTS` as the description of the workflow to pave.

## Step 2 — Decide what to create

| Pattern type | Best artifact | Why |
|---|---|---|
| Repeated prompt structure | skill | Invoke with `/slug` or auto-triggered |
| Always-on context (every session) | CLAUDE.md addition | Loaded automatically, zero friction |
| Post-tool automation | hook | Deterministic, no prompt needed |
| Complex multi-step flow | agent | Isolated context, own tool config |

## Step 2.5 — Determine scope

Check `pattern.scope`:

- **`"project"`**: The pattern was detected mostly in one project (`pattern.project_cwd`). Default to **project-scoped** artifact — ask: *"This pattern seems specific to `<project_name>`. Add it just for that project, or globally for all projects?"*
- **`"global"`** or no scope: Default to **global** artifact.
- **No `cwd` data**: Ask: *"Should this apply to all your projects (global) or just the current one (`<basename of cwd>`)?"*

The answer determines where artifacts are written (see Step 3).

## Step 3 — Write the artifact

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

Append to `~/.claude/desire-path/paved.jsonl`:
```json
{"timestamp":"<iso>","type":"<claude_md|skill|hook|agent>","name":"<slug>","trigger":"<what>"}
```

Tell the user what was created, where it lives, and how it activates:
- Global CLAUDE.md: "Added to `~/.claude/CLAUDE.md` — active in all projects from your next session."
- Project CLAUDE.md: "Added to `<project>/.claude/CLAUDE.md` — active only in that project from your next session."
- Global skill: "Use `/slug` or auto-triggers when you ask about [x]. Available in all projects."
- Project skill: "Use `/slug` or auto-triggers when you ask about [x]. Available in `<project>` only — commit `.claude/skills/` to share with teammates."
- Global hook: "Added to `~/.claude/settings.json` — fires automatically in all projects after every [ToolName] call."
- Project hook: "Added to `<project>/.claude/settings.json` — fires only in that project after every [ToolName] call."
- Global agent: "Spawned by Claude when [trigger]. Available in all projects."
- Project agent: "Spawned by Claude when [trigger]. Available in `<project>` only — commit `.claude/agents/` to share with teammates."

## Step 5 — Log the suggestion outcome

After writing the artifact, also append to `~/.claude/desire-path/suggestions.jsonl`:
```json
{"at":"<iso>","sid":"<session>","pattern":<pattern_object>,"outcome":"accepted","artifact_created":"<slug>"}
```

This closes the feedback loop: the dashboard can show what was suggested, what got accepted, and whether the created artifact is actually being used.
