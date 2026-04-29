# Live Dashboard Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace static dashboard.html generation with a local HTTP server at localhost:2337 that renders fresh data on every request with 60-second auto-refresh.

**Architecture:** `dashboard.js` becomes a module exporting `renderDashboard()`. `server.js` imports it and serves via Node's built-in `http`. The server starts via the `InstructionsLoaded` hook (session start) and can be stopped via a new skill.

**Tech Stack:** Node.js stdlib only (`http`, `fs`, `os`, `path`). No new dependencies.

---

### Task 1: Refactor dashboard.js into a module

**Files:**
- Modify: `scripts/dashboard.js`

- [ ] **Step 1: Read the file**

Read `scripts/dashboard.js` in full to understand exact line ranges.

- [ ] **Step 2: Wrap data-loading + HTML in renderDashboard()**

Move everything from the inventory `execSync` call through the closing backtick of the `html` template into a `function renderDashboard() { ... return html; }`. Keep `require` statements and `const DIR` at the top level (outside the function).

- [ ] **Step 3: Add meta refresh to the HTML head**

Inside `renderDashboard()`, in the `html` template string, after `<meta name="viewport"...>` add:
```html
<meta http-equiv="refresh" content="60">
```

- [ ] **Step 4: Remove file write + opener at the bottom**

Delete these lines at the end of the file:
```js
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(OUT, html);
process.stdout.write('Dashboard → ' + OUT + '\n');

const opener = process.platform==='darwin'?'open':process.platform==='win32'?'start':'xdg-open';
try { execSync(opener + ' "' + OUT + '"'); } catch {}
```

- [ ] **Step 5: Export renderDashboard and add CLI guard**

At the end of the file add:
```js
module.exports = { renderDashboard };

if (require.main === module) {
  process.stdout.write('dashboard.js is now a module — use server.js to serve\n');
}
```

- [ ] **Step 6: Remove OUT constant (no longer needed)**

Delete: `const OUT = path.join(DIR, 'dashboard.html');`

- [ ] **Step 7: Verify module loads without error**

Run: `node -e "require('./scripts/dashboard.js'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 8: Commit**

```bash
git add scripts/dashboard.js
git commit -m "refactor: convert dashboard.js to renderDashboard() module"
```

---

### Task 2: Create server.js

**Files:**
- Create: `scripts/server.js`

- [ ] **Step 1: Create the server file**

```js
#!/usr/bin/env node
'use strict';

const http = require('http');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const net  = require('net');

const PORT    = 2337;
const DIR     = path.join(os.homedir(), '.claude', 'desire-path');
const PID_FILE = path.join(DIR, 'server.pid');

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
    process.exit(0); // already running, silent exit
  }

  const { renderDashboard } = require('./dashboard.js');

  fs.mkdirSync(DIR, { recursive: true });

  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    try {
      const html = renderDashboard();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error rendering dashboard: ' + err.message);
    }
  });

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

- [ ] **Step 2: Start server and verify it responds**

Run: `node scripts/server.js &`
Then: `curl -s http://localhost:2337 | head -5`
Expected: first lines of an HTML document

- [ ] **Step 3: Kill the test server**

```bash
kill $(cat ~/.claude/desire-path/server.pid)
```

- [ ] **Step 4: Commit**

```bash
git add scripts/server.js
git commit -m "feat: add local HTTP server for live dashboard"
```

---

### Task 3: Wire server start into InstructionsLoaded hook

**Files:**
- Modify: `hooks/hooks.json`

- [ ] **Step 1: Read hooks.json**

Read `hooks/hooks.json` in full.

- [ ] **Step 2: Add server start to InstructionsLoaded hook array**

In the `InstructionsLoaded` hooks array, add a second entry after the logger.js entry:
```json
{
  "type": "command",
  "command": "node $CLAUDE_PLUGIN_ROOT/scripts/server.js &",
  "async": true,
  "timeout": 3,
  "_comment": "Start live dashboard server if not already running. Idempotent."
}
```

- [ ] **Step 3: Commit**

```bash
git add hooks/hooks.json
git commit -m "feat: start dashboard server on session start via InstructionsLoaded hook"
```

---

### Task 4: Update dashboard skill

**Files:**
- Modify: `skills/dashboard/SKILL.md`

- [ ] **Step 1: Read the skill file**

Read `skills/dashboard/SKILL.md`.

- [ ] **Step 2: Replace content**

Replace the entire file content with:
```markdown
# Desire Path: Dashboard

Open the live dashboard in your browser.

Run this command:
\`\`\`bash
open http://localhost:2337
\`\`\`

If the page doesn't load, the server isn't running. Start it with:
\`\`\`bash
node $CLAUDE_PLUGIN_ROOT/scripts/server.js &
\`\`\`

The dashboard auto-refreshes every 60 seconds.
```

- [ ] **Step 3: Commit**

```bash
git add skills/dashboard/SKILL.md
git commit -m "feat: update dashboard skill to open live server URL"
```

---

### Task 5: Create stop-server skill

**Files:**
- Create: `skills/stop-server/SKILL.md`

- [ ] **Step 1: Create skill directory and file**

```bash
mkdir -p skills/stop-server
```

Content of `skills/stop-server/SKILL.md`:
```markdown
# Desire Path: Stop Server

Stop the live dashboard server.

Run:
\`\`\`bash
PID_FILE="$HOME/.claude/desire-path/server.pid"
if [ -f "$PID_FILE" ]; then
  kill $(cat "$PID_FILE") 2>/dev/null && echo "Dashboard server stopped." || echo "Process not found."
  rm -f "$PID_FILE"
else
  echo "No server PID file found — server may not be running."
fi
\`\`\`
```

- [ ] **Step 2: Register in plugin.json if needed**

Check `plugin.json` — skills are auto-discovered from the `skills/` directory; no registration needed.

- [ ] **Step 3: Commit**

```bash
git add skills/stop-server/SKILL.md
git commit -m "feat: add stop-server skill to kill dashboard server"
```

---

### Task 6: Remove generated dashboard.html

**Files:**
- Delete: `~/.claude/desire-path/dashboard.html` (runtime artifact, not in repo)

- [ ] **Step 1: Verify dashboard.html is not tracked in git**

Run: `git ls-files ~/.claude/desire-path/dashboard.html`
Expected: no output (not tracked)

- [ ] **Step 2: Remove the generated file**

```bash
rm -f ~/.claude/desire-path/dashboard.html
```

- [ ] **Step 3: Final end-to-end test**

```bash
node scripts/server.js &
sleep 1
curl -s http://localhost:2337 | grep -c "Desire Path"
```
Expected: `1` or more (title appears in HTML)

- [ ] **Step 4: Bump version and push**

```bash
# Update plugin.json version to 2.1.5
git add .
git commit -m "chore: bump to v2.1.5"
git push origin master
```
