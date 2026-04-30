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

  const { computeData } = require('./dashboard.js');
  const HTML_FILE = path.join(__dirname, 'dashboard.html');

  const WATCHED = ['sessions.jsonl', 'latest-analysis.json', 'inventory.json']
    .map(f => path.join(DIR, f));

  const clients = new Set();

  function broadcast() {
    for (const res of clients) {
      try { res.write('data: {"type":"update"}\n\n'); } catch {}
    }
  }

  fs.mkdirSync(DIR, { recursive: true });

  for (const f of WATCHED) {
    try { fs.watch(f, { persistent: false }, broadcast); } catch {}
  }

  const server = http.createServer((req, res) => {
    if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
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
    try {
      const html = fs.readFileSync(HTML_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error serving dashboard: ' + err.message);
    }
  });

  const VERSION_FILE = path.join(DIR, 'server-version.txt');
  const selfVersion = __dirname.match(/desire-path\/(\d+\.\d+\.\d+)\//)?.[1] || 'dev';

  server.listen(PORT, '127.0.0.1', () => {
    fs.writeFileSync(PID_FILE, String(process.pid));
    fs.writeFileSync(VERSION_FILE, selfVersion);
    process.stdout.write(`desire-path dashboard → http://localhost:${PORT}\n`);
  });

  process.on('SIGTERM', () => {
    try { fs.unlinkSync(PID_FILE); } catch {}
    server.close(() => process.exit(0));
  });
}

main();
