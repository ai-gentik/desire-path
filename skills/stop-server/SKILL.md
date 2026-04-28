---
name: stop-server
description: >
  Stop the desire-path live dashboard server running at localhost:2337.
  Use when the user wants to stop the dashboard server.
---

# Desire Path: Stop Server

Run:
```bash
PID_FILE="$HOME/.claude/desire-path/server.pid"
if [ -f "$PID_FILE" ]; then
  kill $(cat "$PID_FILE") 2>/dev/null && echo "Dashboard server stopped." || echo "Process not found — may have already exited."
  rm -f "$PID_FILE"
else
  echo "No server PID file found — server may not be running."
fi
```
