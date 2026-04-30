# Dashboard SSE Refactor + Pattern Filter-at-Write Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desire-path dashboard auto-reactive (SSE push on data change) by extracting the HTML from a JS string into a standalone file, and fix pattern rankings by filtering resolved patterns before writing `latest-analysis.json`.

**Architecture:** `dashboard.js` becomes pure data (`computeData()` only). `scripts/dashboard.html` is a standalone SPA that fetches `/data` on load and on SSE event. `server.js` gains a `/events` SSE endpoint with `fs.watch` on data files. `checker.js` filters paved/accepted fingerprints before writing `top_paths`.

**Tech Stack:** Node.js (stdlib only — `http`, `fs`, `net`, `crypto`), vanilla JS in the browser, SSE (native browser API).

---

## File Map

| File | Change |
|---|---|
| `scripts/dashboard.js` | Remove `renderDashboard()` entirely (lines 201–end). Keep `computeData()` and exports. |
| `scripts/dashboard.html` | **Create** — full standalone HTML/CSS/JS SPA. Fetches `/data`, listens on `/events`. |
| `scripts/server.js` | Add SSE `/events` endpoint + `fs.watch` broadcast. Change `/` to serve `dashboard.html`. |
| `scripts/checker.js` | In `writeAnalysis()`: filter `existing_paths` against paved + accepted fingerprints. |
| `agents/pattern-detector.md` | Add one instruction bullet: filter fingerprints in `paved.jsonl` from `top_paths` before writing. |
| `skills/dashboard/SKILL.md` | **Delete** — replaced by `commands/dashboard.md`. |
| `commands/dashboard.md` | **Create** — deterministic steps, no Claude reasoning. |

---

## Task 1: Extract HTML from dashboard.js into dashboard.html

**Files:**
- Modify: `scripts/dashboard.js` (remove `renderDashboard()`, update exports)
- Create: `scripts/dashboard.html`

- [ ] **Step 1: Read the full renderDashboard function**

```bash
wc -l scripts/dashboard.js
grep -n "function renderDashboard\|^module.exports\|^}" scripts/dashboard.js | tail -20
```

This tells you the exact line range of `renderDashboard()`. It starts at line 201 and runs to the end of the file.

- [ ] **Step 2: Copy the HTML template string content to dashboard.html**

Extract everything between the backtick template literal delimiters in `renderDashboard()`. The HTML starts with `<!DOCTYPE html>` and ends with `</html>`. Save verbatim as `scripts/dashboard.html`.

The HTML currently injects data via `window.__DATA__ = ${JSON.stringify(DATA)}` embedded in a `<script>` tag inside the template. **Replace that entire inline `<script>` block** with this fetch-based bootstrap at the same position in the HTML:

```html
<script>
// Bootstrap: fetch data then render, then connect SSE for live updates
async function bootstrap() {
  const data = await fetch('/data').then(r => r.json());
  renderAll(data);
  const es = new EventSource('/events');
  es.onmessage = () => fetch('/data').then(r => r.json()).then(renderAll);
  es.onerror = () => setTimeout(() => { es.close(); bootstrap(); }, 3000);
}
bootstrap();
</script>
```

The existing `renderAll(DATA)` call at the bottom of the HTML (which received the server-injected `window.__DATA__`) becomes the `renderAll(data)` call inside `bootstrap()`. Remove `const DATA = window.__DATA__` and `renderAll(DATA)` from the bottom of the HTML since data now arrives via fetch.

- [ ] **Step 3: Verify dashboard.html is valid**

```bash
# Check it starts and ends correctly
head -3 scripts/dashboard.html
tail -3 scripts/dashboard.html
# Should print: <!DOCTYPE html> ... </html>
grep -c "renderAll" scripts/dashboard.html
# Should print: 2 (one in bootstrap fetch callback, one in SSE handler)
```

- [ ] **Step 4: Strip renderDashboard() from dashboard.js**

Delete everything from line 201 to end-of-file in `scripts/dashboard.js`. Then update the exports at the bottom:

```js
module.exports = { computeData };
```

(Was `module.exports = { renderDashboard, computeData };`)

- [ ] **Step 5: Verify dashboard.js still exports computeData**

```bash
node -e "const {computeData} = require('./scripts/dashboard.js'); const d = computeData(); console.log('totalSessions:', d.totalSessions, 'tools:', d.tools.length);"
```

Expected: prints `totalSessions: <n> tools: <n>` with no error.

- [ ] **Step 6: Commit**

```bash
git add scripts/dashboard.html scripts/dashboard.js
git commit -m "refactor: extract dashboard HTML to standalone file, dashboard.js is now data-only"
```

---

## Task 2: Add SSE endpoint and static file serving to server.js

**Files:**
- Modify: `scripts/server.js`

- [ ] **Step 1: Read current server.js**

```bash
cat scripts/server.js
```

Confirm it currently requires `./dashboard.js` and calls `renderDashboard()` and `computeData()`.

- [ ] **Step 2: Replace server.js with SSE-capable version**

Replace the full contents of `scripts/server.js` with:

```js
#!/usr/bin/env node
'use strict';

const http = require('http');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const net  = require('net');

const PORT     = 2337;
const DIR      = path.join(os.homedir(), '.claude', 'desire-path');
const PID_FILE = path.join(DIR, 'server.pid');
const HTML     = path.join(__dirname, 'dashboard.html');

const WATCHED = ['sessions.jsonl', 'latest-analysis.json', 'inventory.json']
  .map(f => path.join(DIR, f));

function isPortBound(port) {
  return new Promise(resolve => {
    const tester = net.createServer()
      .once('error', () => resolve(true))
      .once('listening', () => { tester.close(); resolve(false); })
      .listen(port, '127.0.0.1');
  });
}

async function main() {
  const bound = await isPortBound(PORT);
  if (bound) {
    try {
      const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      if (oldPid && !isNaN(oldPid)) {
        process.kill(oldPid, 'SIGTERM');
        await new Promise(r => setTimeout(r, 500));
        const stillBound = await isPortBound(PORT);
        if (stillBound) { process.exit(0); }
      } else {
        process.exit(0);
      }
    } catch {
      process.exit(0);
    }
  }

  const { computeData } = require('./dashboard.js');

  fs.mkdirSync(DIR, { recursive: true });

  // SSE client registry
  const clients = new Set();

  // Broadcast update event to all connected SSE clients
  function broadcast() {
    for (const res of clients) {
      try { res.write('data: {"type":"update"}\n\n'); } catch {}
    }
  }

  // Watch data files and broadcast on change
  for (const f of WATCHED) {
    try {
      fs.watch(f, { persistent: false }, broadcast);
    } catch {}
  }

  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }

    // SSE endpoint
    if (req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(':\n\n'); // initial keep-alive comment
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    // Data API
    if (req.url === '/data' || req.url.startsWith('/data?')) {
      try {
        const data = computeData();
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(data));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // Dashboard HTML
    try {
      const html = fs.readFileSync(HTML, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error reading dashboard.html: ' + err.message);
    }
  });

  const selfVersion = __dirname.match(/desire-path\/(\d+\.\d+\.\d+)\//)?.[1] || 'dev';

  server.listen(PORT, '127.0.0.1', () => {
    fs.writeFileSync(PID_FILE, String(process.pid));
    process.stdout.write(`desire-path dashboard → http://localhost:${PORT}\n`);
  });

  process.on('SIGTERM', () => {
    try { fs.unlinkSync(PID_FILE); } catch {}
    server.close(() => process.exit(0));
  });
}

main();
```

- [ ] **Step 3: Kill any running server and start the new one**

```bash
# Kill old server
pid=$(cat ~/.claude/desire-path/server.pid 2>/dev/null); [ -n "$pid" ] && kill "$pid" 2>/dev/null; sleep 1
# Start new server
node scripts/server.js &
sleep 1
```

- [ ] **Step 4: Verify dashboard loads**

```bash
curl -s http://localhost:2337/ | head -5
# Expected: <!DOCTYPE html>
```

- [ ] **Step 5: Verify /data endpoint works**

```bash
curl -s http://localhost:2337/data | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('sessions:', d.totalSessions, 'tools:', d.tools?.length)"
# Expected: sessions: <n> tools: <n>
```

- [ ] **Step 6: Verify SSE endpoint connects**

```bash
# SSE should respond with content-type text/event-stream and keep connection open
curl -s -N --max-time 3 http://localhost:2337/events
# Expected: ':' (keep-alive comment) then nothing for 3 seconds, then curl exits
```

- [ ] **Step 7: Open dashboard in browser and verify it loads data**

```bash
open http://localhost:2337
```

Confirm: dashboard renders with real session counts, tool stats, patterns tab shows data. If the page shows errors in browser console, check that `renderAll(data)` receives the correct data shape.

- [ ] **Step 8: Test live update (SSE push)**

Open `http://localhost:2337` in the browser. In a separate terminal:

```bash
echo '{"at":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","sid":"test-sse","tools":{"Bash":1},"turns":2}' >> ~/.claude/desire-path/sessions.jsonl
```

Observe: within 1–2 seconds the dashboard should update its session count without a page reload.

- [ ] **Step 9: Commit**

```bash
# Kill background test server first
pid=$(cat ~/.claude/desire-path/server.pid 2>/dev/null); [ -n "$pid" ] && kill "$pid" 2>/dev/null
git add scripts/server.js
git commit -m "feat: add SSE /events endpoint and fs.watch for reactive dashboard updates"
```

---

## Task 3: Convert dashboard skill to command

**Files:**
- Delete: `skills/dashboard/SKILL.md`
- Create: `commands/dashboard.md`

- [ ] **Step 1: Create commands directory if needed**

```bash
ls .claude-plugin/plugin.json  # confirm plugin root
# Commands go in the plugin's commands/ dir
ls commands/ 2>/dev/null || mkdir commands
```

- [ ] **Step 2: Create commands/dashboard.md**

```bash
cat > commands/dashboard.md << 'EOF'
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
EOF
```

- [ ] **Step 3: Remove old skill**

```bash
rm skills/dashboard/SKILL.md
rmdir skills/dashboard 2>/dev/null || true
```

- [ ] **Step 4: Update skills/dashboard reference in stop-server skill if present**

```bash
grep -r "desire-path:dashboard\|skills/dashboard" skills/ agents/ .claude/ 2>/dev/null
```

If any files reference the old skill path, update them to `/desire-path:dashboard` (the command form).

- [ ] **Step 5: Commit**

```bash
git add commands/dashboard.md skills/
git commit -m "refactor: convert dashboard skill to command (deterministic steps, no Claude reasoning needed)"
```

---

## Task 4: Filter paved/accepted patterns at write time in checker.js

**Files:**
- Modify: `scripts/checker.js` (function `writeAnalysis`, ~line 342)

- [ ] **Step 1: Read the writeAnalysis function**

```bash
grep -n "function writeAnalysis\|existing_paths\|top_paths\|PAVED\|fs.writeFileSync" scripts/checker.js
```

Confirm `PAVED` constant is defined at top of file (it is: `const PAVED = path.join(DIR, 'paved.jsonl')`).

- [ ] **Step 2: Add paved fingerprint filter inside writeAnalysis**

Locate the line (approximately line 364):
```js
const existing_paths = existing?.top_paths?.filter(p => p.type !== pattern.type) || [];
```

Replace it with:

```js
// Load resolved fingerprints: paved artifacts + accepted suggestions
const resolvedFps = new Set();
try {
  fs.readFileSync(PAVED, 'utf8').split('\n').filter(Boolean)
    .forEach(l => { try { const p = JSON.parse(l); if (p.fingerprint) resolvedFps.add(p.fingerprint); } catch {} });
} catch {}
try {
  fs.readFileSync(SUGGESTIONS, 'utf8').split('\n').filter(Boolean)
    .forEach(l => { try { const s = JSON.parse(l); if (s.outcome === 'accepted' && s.pattern?.fingerprint) resolvedFps.add(s.pattern.fingerprint); } catch {} });
} catch {}

const existing_paths = (existing?.top_paths || [])
  .filter(p => p.type !== pattern.type)
  .filter(p => !p.fingerprint || !resolvedFps.has(p.fingerprint));
```

- [ ] **Step 3: Also filter the new entry itself**

After the `existing_paths` definition and before building the `analysis` object, add:

```js
// Skip writing if the new pattern itself is already resolved
const newFp = fingerprint(pattern.type, triggerSeed);
if (resolvedFps.has(newFp)) return;
```

Place this just before `const analysis = {`.

- [ ] **Step 4: Verify the change manually**

```bash
node -e "
const fs = require('fs'), path = require('path'), os = require('os');
const PAVED = path.join(os.homedir(), '.claude/desire-path/paved.jsonl');
const fps = new Set();
fs.readFileSync(PAVED,'utf8').split('\n').filter(Boolean)
  .forEach(l => { try { const p = JSON.parse(l); if(p.fingerprint) fps.add(p.fingerprint); } catch{} });
console.log('Paved fingerprints:', [...fps]);
"
```

Then run checker.js dry:

```bash
node scripts/checker.js
# Should exit 0 silently (or output a pattern if threshold reached)
# Check that latest-analysis.json top_paths does not contain resolved fingerprints
node -e "
const a = JSON.parse(require('fs').readFileSync(require('path').join(require('os').homedir(),'.claude/desire-path/latest-analysis.json'),'utf8'));
console.log('top_paths count:', a.top_paths.length);
a.top_paths.forEach(p => console.log(' rank', p.rank, p.fingerprint, p.type));
"
```

- [ ] **Step 5: Commit**

```bash
git add scripts/checker.js
git commit -m "fix: filter resolved (paved/accepted) fingerprints from top_paths before writing latest-analysis.json"
```

---

## Task 5: Mirror filter in pattern-detector agent

**Files:**
- Modify: `agents/pattern-detector.md`

- [ ] **Step 1: Read the current agent instructions**

```bash
grep -n "paved\|resolved\|filter\|top_paths" agents/pattern-detector.md
```

The agent already says "do not re-suggest" paved patterns (via the "Inputs you must read" section). Add an explicit validation step.

- [ ] **Step 2: Add explicit fingerprint filter instruction**

In the `## Validation (mandatory — do not skip)` section, add a 5th check after the existing 4:

```markdown
5. Before writing, filter `top_paths`: load `~/.claude/desire-path/paved.jsonl` and collect all `fingerprint` values. Load `~/.claude/desire-path/suggestions.jsonl` and collect fingerprints from entries where `outcome === "accepted"`. Remove any `top_paths` entry whose `fingerprint` appears in either set. If this reduces `top_paths` to empty, that is correct — write an empty array.
```

- [ ] **Step 3: Verify the agent file reads correctly**

```bash
grep -A 10 "Validation (mandatory" agents/pattern-detector.md | tail -15
# Should show the new step 5
```

- [ ] **Step 4: Commit**

```bash
git add agents/pattern-detector.md
git commit -m "fix: add explicit paved fingerprint filter to pattern-detector validation step"
```

---

## Task 6: Final integration test + ROADMAP update

- [ ] **Step 1: Full end-to-end test**

```bash
# Restart server with fresh state
pid=$(cat ~/.claude/desire-path/server.pid 2>/dev/null); [ -n "$pid" ] && kill "$pid" 2>/dev/null; sleep 1
node scripts/server.js &
sleep 1

# Check all three endpoints
curl -s http://localhost:2337/ | grep -c "<!DOCTYPE html>"  # expect: 1
curl -s http://localhost:2337/data | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(Object.keys(d).join(', '))"
# expect: totalSessions, archiveSessions, hotSessions, pipeline, activity, ...
curl -sI http://localhost:2337/events | grep "Content-Type"
# expect: Content-Type: text/event-stream
```

- [ ] **Step 2: Open dashboard and confirm SSE live update**

```bash
open http://localhost:2337
```

In browser devtools → Network → filter `events` — confirm SSE connection is open (status 200, type `eventsource`).

Trigger a data change:
```bash
echo '{"at":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","sid":"integration-test","tools":{"Bash":2},"turns":3}' >> ~/.claude/desire-path/sessions.jsonl
```

Observe dashboard updates without reload within 1–2 seconds.

- [ ] **Step 3: Confirm checker filters resolved patterns**

```bash
# Run checker and check output
node scripts/checker.js
cat ~/.claude/desire-path/latest-analysis.json | node -e "
const a=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const pavedFps = new Set(require('fs').readFileSync(require('path').join(require('os').homedir(),'.claude/desire-path/paved.jsonl'),'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l).fingerprint}catch{}}).filter(Boolean));
const leaking = a.top_paths.filter(p=>pavedFps.has(p.fingerprint));
if(leaking.length) console.error('FAIL: resolved patterns still in top_paths:', leaking.map(p=>p.fingerprint));
else console.log('PASS: no resolved patterns in top_paths');
"
```

Expected: `PASS: no resolved patterns in top_paths`

- [ ] **Step 4: Update ROADMAP.md**

Add two new completed entries to the priority table:

```markdown
| 23 | SSE-reactive dashboard (static HTML + server push) | infra | Medium | High | ✅ done |
| 24 | Filter resolved patterns at write time in checker | trust | Low | High | ✅ done |
```

- [ ] **Step 5: Final commit + push**

```bash
git add ROADMAP.md
git commit -m "chore: mark dashboard SSE refactor and pattern filter-at-write as done in ROADMAP"
git push origin master
```
