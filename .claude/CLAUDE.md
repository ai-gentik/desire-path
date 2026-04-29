# desire-path — Claude Code Notes

## Git & Deploy

1. Commit with a conventional commit message
2. For releases, include version in message: `chore: bump to v2.1.2`
3. Push: `git push origin master`

No build step. No package.json. Version is tracked in git commit messages only.

## UI Typography Rules (non-negotiable — recurring drift hotspot)

These rules have been corrected 3+ times across sessions. Do not deviate:

- **`.p-quote` font size: 14pt** — used for block-quote / pattern-description text. Must be exactly 14pt. Check for cascade overrides before changing the value itself.
- **Skill/command label truncation:** labels in top-skills and top-commands lists must show enough characters to be identifiable. Use `max-width` with `overflow: hidden; text-overflow: ellipsis` but ensure at least 20 characters are visible.
- **Tab label sizing:** match body size (14–15pt). Do not use display sizes on tabs.
- **Badge styling:** use the established `.badge` class. No inline styles for badges.

When the user gives visual feedback about any of the above, fix the specific element — do not adjust the global font scale.

## Dashboard

Dashboard HTML lives at `~/.claude/desire-path/dashboard.html`.
It is regenerated automatically on session end via the project Stop hook.
To regenerate manually: run the dashboard skill or `/desire-path:dashboard`.
