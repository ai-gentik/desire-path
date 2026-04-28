# Live Dashboard Server — Design Spec

**Date:** 2026-04-28
**Status:** Approved

## Problem

The dashboard is currently a static HTML file generated at session end via a Stop hook. It is stale between sessions and requires a skill to trigger regeneration manually.

## Goal

Replace the static generation pipeline with a local HTTP server that reads log data on demand and serves a live, auto-refreshing dashboard at `http://localhost:2337`.

## Architecture

```
hooks → JSON logs (~/.claude/desire-path/)
              ↓
        server.js (http.createServer, port 2337)
              ↓ reads logs on each request
        dashboard.js (renderDashboard() → HTML string)
              ↓
        browser at localhost:2337 (auto-refreshes every 60s)
```

## Components

### `scripts/server.js` (new)
- Thin HTTP server, ~50 lines, no external dependencies
- On startup: checks if port 2337 is already bound; exits silently if so (idempotent)
- Writes own PID to `~/.claude/desire-path/server.pid`
- On each GET `/`: reads JSON logs, calls `renderDashboard()`, responds with `text/html`
- On any other route: responds 404

### `scripts/dashboard.js` (modified)
- Extracts render logic into an exported `renderDashboard()` function
- Removes `fs.writeFileSync` call — no more file generation
- Adds `<meta http-equiv="refresh" content="60">` to the rendered HTML `<head>`
- When run directly (`node dashboard.js`) with no args: no-op or prints usage — file generation is gone

### `hooks/hooks.json` (modified)
- **InstructionsLoaded hook** — add: `node $CLAUDE_PLUGIN_ROOT/scripts/server.js &` (async, timeout 3s). Fires at session start; idempotent start means multiple sessions don't conflict.
- **Stop hook** — remove the `node dashboard.js` generation entry. Keep logger.js flush and checker.js pattern check.

### `skills/dashboard/SKILL.md` (modified)
- Replace generation logic with: `open http://localhost:2337`
- Note: if server isn't running (no active session), instruct user to start a new session or run `node scripts/server.js &` manually.

### `desire-path:stop-server` skill (new)
- Reads `~/.claude/desire-path/server.pid`
- Sends SIGTERM to that PID
- Deletes the PID file
- Confirms server stopped

## Data Flow

1. Claude Code session starts → InstructionsLoaded hook fires → `server.js` starts (or detects port already bound and exits)
2. User opens `http://localhost:2337` → server reads logs → calls `renderDashboard()` → returns fresh HTML
3. Browser auto-refreshes every 60 seconds via meta refresh tag
4. Session ends → logger flushes, checker runs; server keeps running (persistent across sessions)
5. User runs `desire-path:stop-server` to kill the server when done

## Trade-offs & Decisions

| Decision | Rationale |
|----------|-----------|
| Port 2337 hardcoded | Simple, no config needed; unlikely to conflict |
| Meta refresh (not WebSocket/SSE) | Zero JS complexity, no client-side code changes needed |
| Server persists after session end | Allows viewing dashboard after session closes; user controls shutdown |
| InstructionsLoaded for start | Closest hook to session start in Claude Code's hook model |
| No Express/framework | No npm dependency needed; stdlib `http` is sufficient |

## Out of Scope

- HTTPS
- Authentication
- Multiple concurrent servers on different ports
- Real-time push (WebSocket/SSE) — meta refresh is sufficient
