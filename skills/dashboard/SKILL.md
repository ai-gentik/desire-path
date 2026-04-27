---
name: dashboard
description: >
  Open the Desire Path visual dashboard showing usage patterns, tool stats,
  session activity heatmaps, and paved shortcuts. Use when user asks to see
  their usage patterns visually or wants a "desire path overview".
---

# Desire Path: Dashboard

Run:
```bash
node "$(ls -d ~/.claude/plugins/cache/ai-gentik/desire-path/*/ | sort -V | tail -1)scripts/dashboard.js"
```

Opens `~/.claude/desire-path/dashboard.html` in the browser automatically.
If the browser doesn't open, tell the user the path to open manually.
