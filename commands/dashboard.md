---
description: Open the Desire Path dashboard at localhost:2337
---

Check if the desire-path server is running:
```bash
pid=$(cat ~/.claude/desire-path/server.pid 2>/dev/null)
if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
  echo "Server running (pid $pid)"
else
  node $CLAUDE_PLUGIN_ROOT/scripts/server.js &
  sleep 1
  echo "Server started"
fi
open http://localhost:2337
```
