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
open http://localhost:2337
```

The dashboard is a live server that starts automatically at session start and refreshes every 60 seconds.

If the page doesn't load, the server isn't running. Start it manually with:
```bash
node $CLAUDE_PLUGIN_ROOT/scripts/server.js &
```

To stop the server, use `/desire-path:stop-server`.
