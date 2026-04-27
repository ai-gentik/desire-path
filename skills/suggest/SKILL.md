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
- Read `~/.claude/desire-path/last-suggestion.json` for the most recently detected pattern.

Otherwise use `$ARGUMENTS` as the description of the workflow to pave.

## Step 2 — Decide what to create

| Pattern type | Best artifact | Why |
|---|---|---|
| Repeated prompt structure | `~/.claude/skills/<slug>/SKILL.md` | Invoke with `/slug` or auto-triggered |
| Always-on context (every session) | Append to `~/.claude/CLAUDE.md` | Loaded automatically, zero friction |
| Post-tool automation | Hook in `~/.claude/settings.json` | Deterministic, no prompt needed |
| Complex multi-step flow | `~/.claude/agents/<slug>.md` | Isolated context, own tool config |

## Step 3 — Write the artifact

### For a CLAUDE.md addition:
Read the current `~/.claude/CLAUDE.md`. Add a concise section at the bottom:
```markdown
## [Pattern name]
[1-3 lines of always-on instruction derived from the pattern]
```
Write the file. Don't duplicate existing content.

### For a skill:
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

### For a hook:
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

### For an agent:
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

## Step 4 — Log and confirm

Append to `~/.claude/desire-path/paved.jsonl`:
```json
{"timestamp":"<iso>","type":"<claude_md|skill|hook|agent>","name":"<slug>","trigger":"<what>"}
```

Tell the user what was created and how it activates:
- CLAUDE.md: "Added — active from your next session."
- Skill: "Use `/slug` or auto-triggers when you ask about [x]."
- Hook: "Fires automatically after every [ToolName] call."
- Agent: "Spawned by Claude when [trigger]."

## Step 5 — Log the suggestion outcome

After writing the artifact, also append to `~/.claude/desire-path/suggestions.jsonl`:
```json
{"at":"<iso>","sid":"<session>","pattern":<pattern_object>,"outcome":"accepted","artifact_created":"<slug>"}
```

This closes the feedback loop: the dashboard can show what was suggested, what got accepted, and whether the created artifact is actually being used.
