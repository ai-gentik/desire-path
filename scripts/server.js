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
    // Kill the old server (may be a stale version) and wait for port to free
    try {
      const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      if (oldPid && !isNaN(oldPid)) {
        process.kill(oldPid, 'SIGTERM');
        await new Promise(r => setTimeout(r, 500));
        const stillBound = await isPortBound(PORT);
        if (stillBound) { process.exit(0); } // couldn't free port, give up
      } else {
        process.exit(0); // no pid file, can't kill, give up
      }
    } catch {
      process.exit(0);
    }
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
