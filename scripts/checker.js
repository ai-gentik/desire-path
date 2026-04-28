#!/usr/bin/env node
/**
 * desire-path: pattern checker (v2)
 *
 * Blocking Stop hook. Detects patterns and outputs a JSON decision that
 * tells Claude to proactively suggest the RIGHT artifact type:
 *   - CLAUDE.md addition  (always-on context that repeats every session)
 *   - skill               (prompt template / repeated workflow)
 *   - hook                (post-tool automation)
 *   - agent               (complex multi-step isolated flow)
 *
 * Silent (exit 0, no output) when nothing strong enough detected.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const DIR = path.join(os.homedir(), '.claude', 'desire-path');
const SESSIONS     = path.join(DIR, 'sessions.jsonl');
const ANALYSIS_DUE = path.join(DIR, 'analysis-due.json');
const LAST_SUGGEST = path.join(DIR, 'last-suggestion.json');
const SUGGESTIONS  = path.join(DIR, 'suggestions.jsonl');

function acceptedTypes() {
  try {
    return new Set(
      fs.readFileSync(SUGGESTIONS, 'utf8').split('\n').filter(Boolean)
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(e => e?.outcome === 'accepted')
        .map(e => e.pattern?.type)
        .filter(Boolean)
    );
  } catch { return new Set(); }
}

function readSessions(n = 25) {
  try {
    return fs.readFileSync(SESSIONS, 'utf8')
      .split('\n').filter(Boolean).slice(-n).map(l => JSON.parse(l));
  } catch { return []; }
}

function cooldown() {
  if (!fs.existsSync(ANALYSIS_DUE)) return true;
  try {
    const last = JSON.parse(fs.readFileSync(LAST_SUGGEST, 'utf8'));
    return (Date.now() - new Date(last.at).getTime()) < 60 * 60 * 1000;
  } catch { return false; }
}

// ── Local heuristics — fast, no API ──────────────────────────────────────────

function detect(sessions) {
  const results = [];

  // 1. CLAUDE.md candidate: same preamble context injected in every session
  //    Signal: prompts that start with project setup / "you are working on..."
  const setupPhrases = ['you are', 'this project', 'we use', 'always use', 'never use', 'the stack'];
  const setupCount = sessions.filter(s =>
    (s.prompts || []).some(p => setupPhrases.some(ph => p.p?.toLowerCase().startsWith(ph)))
  ).length;
  if (setupCount >= 4) {
    results.push({
      type: 'claude_md',
      confidence: setupCount >= 6 ? 'high' : 'medium',
      frequency: setupCount,
      description: `You repeat project context in ${setupCount} sessions — this belongs in CLAUDE.md so Claude always knows it`,
      artifact: 'CLAUDE.md addition',
      action: 'run /desire-path:suggest to add it once and never repeat it'
    });
  }

  // 2. SKILL candidate: repeated prompt prefix (template pattern)
  const allPrompts = sessions.flatMap(s => (s.prompts || []).map(p => p.p || ''));
  const prefixMap = {};
  allPrompts.forEach(p => {
    const key = p.toLowerCase().split(/\s+/).slice(0, 5).join(' ');
    if (key.length > 15) prefixMap[key] = (prefixMap[key] || 0) + 1;
  });
  const topPrefix = Object.entries(prefixMap).sort((a,b) => b[1]-a[1])[0];
  if (topPrefix && topPrefix[1] >= 4) {
    results.push({
      type: 'skill',
      confidence: 'high',
      frequency: topPrefix[1],
      description: `You keep asking "${topPrefix[0]}..." (${topPrefix[1]}×) — a skill would turn this into a /command`,
      artifact: 'skill',
      action: 'run /desire-path:suggest to create the skill'
    });
  }

  // 3. HOOK candidate: same tool always followed by same tool (sequence)
  // Filter pairs that are procedurally required by assistant workflow, not user choice
  const ASSISTANT_PAIRS = new Set(['Read→Edit','Read→Write','Bash→Bash','Read→Bash','Bash→Read']);
  const pairMap = {};
  sessions.forEach(s => {
    const tools = Object.keys(s.tools || {});
    for (let i = 0; i < tools.length - 1; i++) {
      const pair = `${tools[i]}→${tools[i+1]}`;
      if (ASSISTANT_PAIRS.has(pair)) continue;
      pairMap[pair] = (pairMap[pair] || 0) + 1;
    }
  });
  const topPair = Object.entries(pairMap).sort((a,b) => b[1]-a[1])[0];
  if (topPair && topPair[1] >= 5) {
    const [from, to] = topPair[0].split('→');
    results.push({
      type: 'hook',
      confidence: 'high',
      frequency: topPair[1],
      description: `After ${from} you always run ${to} (${topPair[1]}×) — a PostToolUse hook would do this automatically`,
      artifact: 'PostToolUse hook',
      action: 'run /desire-path:suggest to add the hook'
    });
  }

  // 4. AGENT candidate: many turns + same skills load repeatedly = complex domain
  const avgTurns = sessions.reduce((a,s) => a + (s.turns||0), 0) / sessions.length;
  const skillFreq = {};
  sessions.forEach(s => (s.skills||[]).forEach(sk => { skillFreq[sk]=(skillFreq[sk]||0)+1; }));
  const dominantSkill = Object.entries(skillFreq).sort((a,b)=>b[1]-a[1])[0];
  if (avgTurns > 12 && dominantSkill && dominantSkill[1] >= 5) {
    results.push({
      type: 'agent',
      confidence: 'medium',
      frequency: dominantSkill[1],
      description: `Sessions average ${Math.round(avgTurns)} turns with "${dominantSkill[0]}" loading ${dominantSkill[1]}× — a dedicated agent would handle this domain better`,
      artifact: 'agent',
      action: 'run /desire-path:suggest to create the agent'
    });
  }

  // 5. BASH command repeated across sessions — candidate for Start/Stop hook or skill
  // Count by distinct sessions, not raw runs, to avoid single-session noise
  const bashSessionCount = {};
  sessions.forEach(s => {
    const seen = new Set();
    (s.top_bash || []).forEach(([cmd]) => {
      // Normalize: strip leading path tokens, lowercase, max 80 chars
      const key = cmd.trim().replace(/^(node|npx|sudo)\s+/, '').toLowerCase().substring(0, 80);
      if (key.length < 4 || seen.has(key)) return;
      seen.add(key);
      bashSessionCount[key] = (bashSessionCount[key] || 0) + 1;
    });
  });
  const topBashEntry = Object.entries(bashSessionCount).sort((a,b) => b[1]-a[1])[0];
  if (topBashEntry && topBashEntry[1] >= 3) {
    const [cmd, sessionCount] = topBashEntry;
    const short = cmd.length > 60 ? cmd.substring(0, 57) + '...' : cmd;
    // Classify hook event: setup/server cmds → Start, test/status cmds → Stop
    const isStopCandidate = /git (status|diff|log)|npm test|jest|pytest|make test|lint/.test(cmd);
    const isStartCandidate = /npm (install|run dev|start)|yarn (dev|start)|docker|brew/.test(cmd);
    const hookEvent = isStopCandidate ? 'Stop' : isStartCandidate ? 'Start' : null;
    const artifactType = hookEvent ? 'hook' : 'skill';
    const artifactLabel = hookEvent ? `${hookEvent} hook` : '/command skill';
    results.push({
      type: artifactType,
      confidence: sessionCount >= 6 ? 'high' : 'medium',
      frequency: sessionCount,
      description: `You run \`${short}\` in ${sessionCount} sessions — a ${artifactLabel} would automate this`,
      artifact: artifactLabel,
      action: 'run /desire-path:suggest to pave it'
    });
  }

  // Return highest-confidence result
  const byConf = { high: 3, medium: 2, low: 1 };
  return results.sort((a,b) => (byConf[b.confidence]||0) - (byConf[a.confidence]||0))[0] || null;
}

async function claudeRefine(sessions, localPattern) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return localPattern;

  const summary = sessions.slice(-10).map((s,i) =>
    `[${i+1}] tools:${JSON.stringify(s.tools)} skills:[${(s.skills||[]).join(',')}] bash:${JSON.stringify((s.top_bash||[]).slice(0,3))} prompts:"${(s.prompts||[]).map(p=>p.p?.substring(0,50)).join(' | ')}"`
  ).join('\n');

  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 250,
    system: `You are a desire-path detector for Claude Code. Analyze session patterns and identify ONE high-value shortcut opportunity.

Return ONLY valid JSON (no markdown):
{
  "type": "claude_md|skill|hook|agent",
  "confidence": "high|medium",
  "frequency": <number>,
  "description": "specific one-sentence description naming the actual pattern",
  "artifact": "what to create",
  "action": "exact next step for the user"
}

Type guide:
- claude_md: always-on context repeated every session → belongs in CLAUDE.md
- skill: repeated prompt template → /command shortcut
- hook: post-tool automation → fires without asking
- agent: complex domain workflow → isolated sub-agent

Only return high/medium confidence. If nothing clear: {"type":"none"}`,
    messages: [{
      role: 'user',
      content: `Sessions:\n${summary}\n\nLocal detector found: ${JSON.stringify(localPattern)}`
    }]
  });

  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      timeout: 10000
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const t = JSON.parse(d).content?.[0]?.text?.trim();
          const p = JSON.parse(t);
          resolve(p?.type === 'none' ? localPattern : p);
        } catch { resolve(localPattern); }
      });
    });
    req.on('error', () => resolve(localPattern));
    req.on('timeout', () => { req.destroy(); resolve(localPattern); });
    req.write(body); req.end();
  });
}

// ── Artifact-specific reason strings ─────────────────────────────────────────

function buildReason(pattern) {
  const typeInstructions = {
    claude_md: `Proactively tell the user: "I noticed you've been repeating the same context in multiple sessions. I can add this to your CLAUDE.md so you never have to say it again — want me to do that?" Then offer to run /desire-path:suggest.`,
    skill: `Proactively tell the user: "I keep seeing this same type of request. I could turn it into a skill you can invoke with one command — should I create it?" Then offer to run /desire-path:suggest.`,
    hook: `Proactively tell the user: "I noticed you always do X right after Y. A hook could automate that completely — want me to set it up?" Then offer to run /desire-path:suggest.`,
    agent: `Proactively tell the user: "These sessions look like a recurring workflow that might benefit from a dedicated agent with the right context pre-loaded — interested?" Then offer to run /desire-path:suggest.`
  };

  const instruction = typeInstructions[pattern.type] || typeInstructions.skill;
  return `[desire-path] ${pattern.description} (${pattern.frequency}× observed). ${instruction}`;
}

// ── Inventory check — run inline, sync ───────────────────────────────────────

function runInventory() {
  try {
    const { execFileSync } = require('child_process');
    const inventoryScript = path.join(__dirname, 'inventory.js');
    const out = execFileSync(process.execPath, [inventoryScript], {
      timeout: 8000,
      env: { ...process.env },
      encoding: 'utf8'
    });
    return JSON.parse(out || '{}');
  } catch { return {}; }
}

function buildCleanupReason(inv) {
  const parts = [];
  if (inv.dead > 0) {
    const names = inv.dead_names.slice(0, 3).map(n => `"${n}"`).join(', ');
    parts.push(`${inv.dead} artifact${inv.dead > 1 ? 's' : ''} never used: ${names}`);
  }
  if (inv.stale > 0) {
    const names = inv.stale_names.slice(0, 2).map(n => `"${n}"`).join(', ');
    parts.push(`${inv.stale} stale (30d+ unused): ${names}`);
  }
  if (!parts.length) return null;

  return `[desire-path] Inventory: ${parts.join(' · ')}. `
    + `Mention this casually: "By the way, I noticed you have some skills/agents that haven't been used in a while. `
    + `Want me to open the cleanup overview?" Then offer to run /desire-path:cleanup.`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (cooldown()) { process.exit(0); return; }

  const sessions = readSessions(25);

  // Always run inventory scan (fast, local only)
  const inv = runInventory();
  const hasDeadArtifacts = (inv.dead || 0) + (inv.stale || 0) > 0;

  if (sessions.length < 3 && !hasDeadArtifacts) { process.exit(0); return; }

  // Pattern detection (needs enough sessions)
  const done = acceptedTypes();
  let pattern = null;
  if (sessions.length >= 3) {
    pattern = detect(sessions);
    // Skip patterns whose type was already accepted — don't nag about the same category
    if (pattern && done.has(pattern.type)) pattern = null;
    if (sessions.length >= 8) {
      pattern = await claudeRefine(sessions, pattern) || pattern;
      if (pattern && done.has(pattern.type)) pattern = null;
    }
  }

  const hasPattern = pattern && pattern.confidence !== 'low';

  // Decide what to surface — pattern wins over cleanup
  if (hasPattern) {
    fs.writeFileSync(LAST_SUGGEST, JSON.stringify({ at: new Date().toISOString(), pattern }));
    try { fs.unlinkSync(ANALYSIS_DUE); } catch {}
    process.stdout.write(JSON.stringify({ decision: 'block', reason: buildReason(pattern) }));
    process.exit(0);
  }

  if (hasDeadArtifacts) {
    const reason = buildCleanupReason(inv);
    if (reason) {
      fs.writeFileSync(LAST_SUGGEST, JSON.stringify({
        at: new Date().toISOString(),
        pattern: { type: 'cleanup', description: reason, frequency: inv.dead + inv.stale }
      }));
      try { fs.unlinkSync(ANALYSIS_DUE); } catch {}
      process.stdout.write(JSON.stringify({ decision: 'block', reason }));
      process.exit(0);
    }
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
