---
name: cleanup
description: >
  Review and remove unused or stale skills, agents, commands, and hooks.
  Use when the user wants to clean up dead artifacts, asks "what am I not using",
  "remove unused skills", or responds to a desire-path cleanup suggestion.
---

# Desire Path: Cleanup

## Step 1 — Read inventory

Run:
```bash
node $PLUGIN_DIR/scripts/inventory.js
```

Then read `~/.claude/desire-path/inventory.json` for the full artifact list.

## Step 2 — Present findings

Group by status and show a clear summary:

```
DEAD (never used, >14 days old) — safe to remove:
  skill  "refactor-helper"   user    created 23d ago    0 uses
  agent  "code-auditor"      project created 45d ago    0 uses

STALE (used before, silent >30 days):  
  skill  "deploy-staging"    user    last used 38d ago   3 uses
  hook   "PostToolUse:..."   project last used 62d ago   1 use

ACTIVE — leave alone:
  skill  "auto-test"         user    last used yesterday  11 uses
  skill  "trading-bot-ctx"   user    loaded every session
```

## Step 3 — Ask before acting

For DEAD artifacts: "These were never used. Remove them?"
For STALE artifacts: "These haven't been used in 30+ days. Remove or keep?"

Wait for confirmation before deleting anything. Never auto-delete.

## Step 4 — Remove confirmed artifacts

For each confirmed removal:

**Skill/command (directory):**
```bash
rm -rf /path/to/skill-dir
```

**Skill/command (flat file):**
```bash
rm /path/to/command.md
```

**Agent:**
```bash
rm /path/to/agent.md
```

**Hook** (more careful — edit settings.json):
Read `~/.claude/settings.json`, remove the specific hook entry from the correct event array, write back. Never remove the entire hooks block.

## Step 5 — Log removals

Append to `~/.claude/desire-path/removals.jsonl`:
```json
{"at":"<iso>","name":"<name>","type":"<type>","reason":"dead|stale","uses":<n>}
```

Confirm: "Removed X artifact(s). Your config is leaner now."

## Step 6 — Disable vs remove

If the user prefers to disable rather than delete:
- Skills/agents: rename `SKILL.md` → `SKILL.md.disabled`
- Hooks: set `"disabled": true` on the hook entry (if supported) or move to a `hooks-disabled` key
- Tell the user: "Disabled — re-enable by renaming back to SKILL.md"
