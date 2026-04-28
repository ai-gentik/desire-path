# desire-path — Claude Code Notes

## Git & Deploy

1. Commit with a conventional commit message
2. For releases, include version in message: `chore: bump to v2.1.2`
3. Push: `git push origin master`

No build step. No package.json. Version is tracked in git commit messages only.

## Dashboard

Dashboard HTML lives at `~/.claude/desire-path/dashboard.html`.
It is regenerated automatically on session end via the project Stop hook.
To regenerate manually: run the dashboard skill or `/desire-path:dashboard`.
