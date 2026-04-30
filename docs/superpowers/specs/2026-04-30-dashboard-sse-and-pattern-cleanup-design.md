# Design: SSE-Reactive Dashboard + Pattern Filter-at-Write

**Date:** 2026-04-30  
**Status:** Approved — ready for implementation planning

---

## Problem 1: Dashboard is not reactive and requires manual start

The current dashboard is a ~1200-line monolith (`dashboard.js`) that embeds the entire HTML/CSS/JS as a JS template literal string. Problems:

- No auto-start — user must manually invoke `/desire-path:dashboard`
- Not reactive — data only updates on full page reload
- HTML embedded in JS string — no syntax highlighting, painful to edit
- `inventory.js` runs via blocking `execSync` on every HTTP request

## Problem 2: Resolved patterns keep re-appearing in rankings

`checker.js` writes `latest-analysis.json` without filtering out already-paved patterns. Resolved items accumulate in `top_paths` and remain visible in the dashboard until a new deep analysis runs. The `_resolved` flag is only applied at display time in `dashboard.js`, not at write time.

---

## Solution 1: SSE-Reactive Dashboard (Option B)

### File changes

| File | Change |
|---|---|
| `scripts/dashboard.js` | Remove `renderDashboard()`. Keep only `computeData()`. |
| `scripts/dashboard.html` | New file — standalone SPA. All HTML/CSS/JS. Fetches `/data` on load and on SSE event. |
| `scripts/server.js` | Add `/events` SSE endpoint. Add `fs.watch` on data files. Serve `dashboard.html` statically for `/`. |
| `hooks/hooks.json` | Add server auto-start check to the Stop hook command chain. |
| `skills/dashboard/SKILL.md` | Convert to `commands/dashboard.md` — deterministic, no Claude reasoning needed. |

### Architecture

```
session ends
  → Stop hook
      → checker.js (existing)
      → server auto-start check: read server.pid, kill -0 $pid || node server.js &
      → sessions.jsonl written

fs.watch detects sessions.jsonl change
  → server broadcasts SSE: data: {"type":"update"}

browser (open dashboard tab)
  → receives SSE event
  → fetches /data
  → updates DOM in place (no full reload)
```

### Server endpoints

| Endpoint | Behaviour |
|---|---|
| `GET /` | Reads and serves `scripts/dashboard.html` from disk |
| `GET /data` | Calls `computeData()`, returns JSON |
| `GET /events` | SSE stream — keeps connection open, pushes `{"type":"update"}` on file changes |
| `GET /favicon.ico` | 204 no-content (unchanged) |

### SSE implementation (server.js addition)

```js
// Watched files that trigger a push
const WATCHED = ['sessions.jsonl', 'latest-analysis.json', 'inventory.json']
  .map(f => path.join(DIR, f));

const clients = new Set(); // Set of SSE response objects

// Register client
if (req.url === '/events') {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write(':\n\n'); // keep-alive comment
  clients.add(res);
  req.on('close', () => clients.delete(res));
  return;
}

// File watcher
WATCHED.forEach(f => {
  fs.watch(f, { persistent: false }, () => {
    for (const client of clients) {
      client.write('data: {"type":"update"}\n\n');
    }
  });
});
```

### dashboard.html client-side SSE

```js
const es = new EventSource('/events');
es.onmessage = () => fetch('/data')
  .then(r => r.json())
  .then(data => renderAll(data));
// On load: also fetch immediately
fetch('/data').then(r => r.json()).then(renderAll);
```

### Auto-start (Stop hook addition)

Add to the Stop hook in `hooks/hooks.json` as a second command:

```bash
node -e "
const fs=require('fs'),path=require('path'),os=require('os');
const pid=parseInt(fs.readFileSync(path.join(os.homedir(),'.claude/desire-path/server.pid'),'utf8')||'0');
try{process.kill(pid,0)}catch{require('child_process').spawn('node',[path.join(__dirname,'scripts/server.js')],{detached:true,stdio:'ignore'}).unref()}
"
```

Or as a dedicated `scripts/ensure-server.js` script for clarity.

### Command conversion: `desire-path:dashboard`

Convert `skills/dashboard/SKILL.md` → `commands/dashboard.md`:

```markdown
Check if desire-path server is running (read ~/.claude/desire-path/server.pid, test with kill -0).
If not running, start it: node <plugin_root>/scripts/server.js &
Open http://localhost:2337 in the browser.
```

No Claude reasoning needed — steps are fully deterministic.

---

## Solution 2: Filter-at-Write for Pattern Cleanup (Option A)

### Root cause

`checker.js` writes `top_paths` to `latest-analysis.json` without checking whether each pattern has already been paved. The `dashboard.js` applies `_resolved: true` at display time but the data file stays dirty indefinitely.

### Fix location

In `checker.js`, before writing `latest-analysis.json` (and mirrored in the `pattern-detector` agent):

```js
// Load paved fingerprints
const pavedFps = new Set(
  lines(PAVED)
    .map(p => p.fingerprint)
    .filter(Boolean)
);

// Load accepted suggestion fingerprints  
const acceptedFps = new Set(
  readSuggestions()
    .filter(s => s.outcome === 'accepted')
    .map(s => s.pattern?.fingerprint)
    .filter(Boolean)
);

const resolvedFps = new Set([...pavedFps, ...acceptedFps]);

// Filter top_paths before writing
const filteredPaths = topPaths.filter(p => !resolvedFps.has(p.fingerprint));
```

### Effect

- `top_paths` in `latest-analysis.json` only ever contains actionable patterns
- The `_resolved` display-time fallback in `dashboard.js` stays as backward-compat for old files but becomes a no-op going forward
- Pattern-detector agent (`agents/pattern-detector.md`) already has "do not re-suggest paved patterns" in its instructions — the same fingerprint filter should be applied there too, confirmed in its validation step

### Edge case: fingerprint missing

Some older analysis entries may not have a `fingerprint` field. Fallback: also filter by description match against `suggestions.jsonl` accepted entries (already done at display time — keep this fallback in both places).

---

## Scope boundaries

**In scope:**
- `computeData()` logic — unchanged
- All existing data files and their formats — unchanged
- Dashboard visual design — unchanged (CSS/JS moves to `dashboard.html`, same content)
- Pattern-detector agent output schema — unchanged

**Out of scope:**
- Any new data capture
- Dashboard visual redesign
- Changing the `/data` JSON shape
- Changing suggestion/paved file formats

---

## Implementation order

1. Extract HTML to `scripts/dashboard.html` (lowest risk, independent)
2. Add `/events` SSE to `server.js` + `fs.watch`
3. Add auto-start to Stop hook
4. Convert dashboard skill to command
5. Add fingerprint filter in `checker.js`
6. Mirror filter in `pattern-detector` agent instructions
