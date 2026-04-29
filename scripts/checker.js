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
const crypto = require('crypto');

const DIR = path.join(os.homedir(), '.claude', 'desire-path');
const SESSIONS        = path.join(DIR, 'sessions.jsonl');
const ANALYSIS_DUE    = path.join(DIR, 'analysis-due.json');
const LAST_SUGGEST    = path.join(DIR, 'last-suggestion.json');
const SUGGESTIONS     = path.join(DIR, 'suggestions.jsonl');
const LATEST_ANALYSIS = path.join(DIR, 'latest-analysis.json');
const INVENTORY       = path.join(DIR, 'inventory.json');
const PAVED           = path.join(DIR, 'paved.jsonl');

const DEEP_ANALYSIS_INTERVAL = 25; // sessions between deep analysis suggestions
const OFFLINE = process.env.DESIRE_PATH_OFFLINE === '1';

// ── Pattern fingerprinting ───────────────────────────────────────────────────
// Stable hash of (type, normalized_trigger) so dedup survives phrasing changes.

function normalizeTrigger(s = '') {
  return String(s)
    .toLowerCase()
    .replace(/^\s*(please\s+)?(can\s+you\s+|could\s+you\s+|run\s+|make\s+|create\s+|add\s+|write\s+)+/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function fingerprint(type, trigger) {
  const key = `${type}::${normalizeTrigger(trigger)}`;
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 10);
}

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

function readSuggestions() {
  try {
    return fs.readFileSync(SUGGESTIONS, 'utf8').split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

// Returns set of fingerprints that were dismissed within the last `windowDays`.
function dismissedFingerprints(windowDays = 30) {
  const cutoff = Date.now() - windowDays * 86400000;
  return new Set(
    readSuggestions()
      .filter(e => (e.outcome === 'dismissed' || e.outcome === 'rejected'))
      .filter(e => !e.at || new Date(e.at).getTime() >= cutoff)
      .map(e => e.pattern?.fingerprint || (e.pattern ? fingerprint(e.pattern.type, e.pattern.trigger || e.pattern.description || '') : null))
      .filter(Boolean)
  );
}

// Outcome-weighted confidence: if recently-paved artifacts of a type are mostly
// dead, demote that type's confidence so the detector stops over-suggesting it.
function outcomeWeights() {
  const weights = { command: 0, skill: 0, hook: 0, agent: 0, claude_md: 0 };
  try {
    const inv = JSON.parse(fs.readFileSync(INVENTORY, 'utf8'));
    const all = inv.artifacts || [];
    const isRecent = a => {
      if (!a.created) return false;
      return (Date.now() - new Date(a.created).getTime()) <= 60 * 86400000;
    };
    for (const t of Object.keys(weights)) {
      const recent = all.filter(a => a.type === t && isRecent(a));
      if (recent.length < 3) continue;
      const dead = recent.filter(a => a.status === 'dead').length;
      if (dead / recent.length >= 0.5) weights[t] = -1;
    }
  } catch {}
  return weights;
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

  // 2. COMMAND vs SKILL candidate: repeated prompt prefix (template pattern)
  // Command if the full prompt structure is stable (low variance in prompt length
  // and consistent following words). Skill if only the opening is similar but the
  // body varies — the user describes the same kind of problem differently each time.
  const allPrompts = sessions.flatMap(s => (s.prompts || []).map(p => p.p || ''));
  const prefixMap = {};
  const prefixSamples = {};
  allPrompts.forEach(p => {
    const key = p.toLowerCase().split(/\s+/).slice(0, 5).join(' ');
    if (key.length <= 15) return;
    prefixMap[key] = (prefixMap[key] || 0) + 1;
    (prefixSamples[key] = prefixSamples[key] || []).push(p);
  });
  const topPrefix = Object.entries(prefixMap).sort((a,b) => b[1]-a[1])[0];
  if (topPrefix && topPrefix[1] >= 4) {
    const samples = prefixSamples[topPrefix[0]] || [];
    const lens = samples.map(s => s.length);
    const mean = lens.reduce((a,b) => a+b, 0) / lens.length;
    const variance = lens.reduce((a,l) => a + (l-mean)**2, 0) / lens.length;
    const stddev = Math.sqrt(variance);
    // Stable structure → command. Variable phrasing → skill.
    const isCommand = stddev < Math.max(20, mean * 0.35) && mean < 200;
    if (isCommand) {
      results.push({
        type: 'command',
        confidence: 'high',
        frequency: topPrefix[1],
        description: `You keep asking "${topPrefix[0]}..." (${topPrefix[1]}×) with the same structure — a /command would fire it in one keystroke`,
        artifact: 'command',
        action: 'run /desire-path:suggest to create the command'
      });
    } else {
      results.push({
        type: 'skill',
        confidence: 'high',
        frequency: topPrefix[1],
        description: `You keep asking about "${topPrefix[0]}..." (${topPrefix[1]}×) with varying phrasing — a skill would auto-load the right playbook`,
        artifact: 'skill',
        action: 'run /desire-path:suggest to create the skill'
      });
    }
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
    const artifactType = hookEvent ? 'hook' : 'command';
    const artifactLabel = hookEvent ? `${hookEvent} hook` : '/command';
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
  if (OFFLINE) return localPattern;
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
  "type": "claude_md|command|skill|hook|agent",
  "confidence": "high|medium",
  "frequency": <number>,
  "description": "specific one-sentence description naming the actual pattern",
  "artifact": "what to create",
  "action": "exact next step for the user"
}

Type guide:
- claude_md: always-on context repeated every session → belongs in CLAUDE.md
- command: user-fired prompt with stable structure + variable args → /slug <args>
- skill: same kind of request phrased differently → auto-loaded playbook
- hook: deterministic post-tool reaction → fires without asking
- agent: complex multi-turn domain workflow → isolated sub-agent

Command vs skill: command if the steps are fixed and only the args vary; skill if Claude needs to reason differently each time.

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
    command: `Proactively tell the user: "I keep seeing the same request with the same shape. I could turn it into a slash command you fire as /slug <args> — want me to create it?" Then offer to run /desire-path:suggest.`,
    skill: `Proactively tell the user: "I keep seeing this same type of request phrased different ways. I could turn it into a skill that auto-loads the right playbook — should I create it?" Then offer to run /desire-path:suggest.`,
    hook: `Proactively tell the user: "I noticed you always do X right after Y. A hook could automate that completely — want me to set it up?" Then offer to run /desire-path:suggest.`,
    agent: `Proactively tell the user: "These sessions look like a recurring workflow that might benefit from a dedicated agent with the right context pre-loaded — interested?" Then offer to run /desire-path:suggest.`
  };

  const instruction = typeInstructions[pattern.type] || typeInstructions.skill;
  return `[desire-path] ${pattern.description} (${pattern.frequency}× observed). ${instruction}`;
}

// ── Tier 1: write local detection to latest-analysis.json ────────────────────

function writeAnalysis(pattern, totalSessions) {
  try {
    const existing = (() => { try { return JSON.parse(fs.readFileSync(LATEST_ANALYSIS, 'utf8')); } catch { return null; } })();
    // Only overwrite if new pattern has higher frequency or existing is stale (>25 sessions old)
    const existingAge = totalSessions - (existing?._session_count_at_analysis || 0);
    if (existing && existingAge < 5 && (existing.top_paths?.[0]?.frequency || 0) >= pattern.frequency) return;

    const triggerSeed = pattern.trigger || pattern.description || pattern.action || '';
    const entry = {
      rank: 1,
      type: pattern.type,
      description: pattern.description,
      evidence: [],
      frequency: pattern.frequency,
      fingerprint: fingerprint(pattern.type, triggerSeed),
      suggested_artifact: {
        type: pattern.type,
        name: '',
        trigger: pattern.action || '',
        fingerprint: fingerprint(pattern.type, triggerSeed)
      }
    };
    const existing_paths = existing?.top_paths?.filter(p => p.type !== pattern.type) || [];
    const analysis = {
      _session_count_at_analysis: totalSessions,
      _generated_by: 'checker-local',
      top_paths: [entry, ...existing_paths].slice(0, 5).map((p, i) => ({ ...p, rank: i + 1 })),
      quick_win: { description: pattern.description, action: pattern.action || '' },
      stats: { total_sessions: totalSessions }
    };
    fs.writeFileSync(LATEST_ANALYSIS, JSON.stringify(analysis, null, 2));
  } catch {}
}

// ── Tier 2: detect when deep analysis is due ──────────────────────────────────

function deepAnalysisDue(totalSessions) {
  try {
    const existing = JSON.parse(fs.readFileSync(LATEST_ANALYSIS, 'utf8'));
    if (existing._generated_by === 'checker-local') {
      // Only suggest deep analysis if local analysis is DEEP_ANALYSIS_INTERVAL sessions old
      return (totalSessions - (existing._session_count_at_analysis || 0)) >= DEEP_ANALYSIS_INTERVAL;
    }
    // Agent-generated analysis: use same interval
    return (totalSessions - (existing._session_count_at_analysis || 0)) >= DEEP_ANALYSIS_INTERVAL;
  } catch {
    // No latest-analysis.json yet — suggest after first DEEP_ANALYSIS_INTERVAL sessions
    return totalSessions >= DEEP_ANALYSIS_INTERVAL;
  }
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
  const sessions = readSessions(25);
  const totalSessions = (() => { try { return JSON.parse(fs.readFileSync(ANALYSIS_DUE, 'utf8')).total_sessions || sessions.length; } catch { return sessions.length; } })();

  // Pattern detection runs regardless of cooldown — Tier 1 write must always happen
  const done = acceptedTypes();
  const dismissed = dismissedFingerprints(30);
  const weights = outcomeWeights();
  let pattern = null;
  let localPattern = null;
  let haikuAgreed = false;
  if (sessions.length >= 3) {
    localPattern = detect(sessions);
    pattern = localPattern;
    if (pattern && done.has(pattern.type)) pattern = null;
    if (pattern) {
      const fp = fingerprint(pattern.type, pattern.trigger || pattern.description);
      if (dismissed.has(fp)) pattern = null;
    }
    if (sessions.length >= 8) {
      const refined = await claudeRefine(sessions, pattern);
      if (refined && refined !== pattern) {
        haikuAgreed = !!(localPattern && refined.type === localPattern.type);
        pattern = refined;
      }
      if (pattern && done.has(pattern.type)) pattern = null;
      if (pattern) {
        const fp = fingerprint(pattern.type, pattern.trigger || pattern.description);
        if (dismissed.has(fp)) pattern = null;
      }
    }
    // Outcome weighting: demote types whose recently-paved artifacts are mostly dead
    if (pattern && weights[pattern.type] === -1) {
      pattern.confidence = pattern.confidence === 'high' ? 'medium' : 'low';
      pattern._demoted_by_outcome = true;
    }
  }

  // Storage gate: any non-low-confidence pattern is worth persisting for the dashboard.
  const hasPattern = pattern && pattern.confidence !== 'low';

  // Surface gate (stricter): only interrupt the user when evidence is strong.
  // Require frequency ≥6, OR Haiku agreed with the local detector on the type,
  // OR the pattern is a CLAUDE.md addition with high confidence (cheap to accept).
  const shouldSurface = hasPattern && (
    (pattern.frequency || 0) >= 6 ||
    haikuAgreed ||
    (pattern.type === 'claude_md' && pattern.confidence === 'high')
  ) && !pattern._demoted_by_outcome;

  // Tier 1: always persist to latest-analysis.json so dashboard is never empty
  if (hasPattern) {
    writeAnalysis(pattern, totalSessions);
  } else if (!fs.existsSync(LATEST_ANALYSIS)) {
    // Bootstrap: no pattern detected yet, but write stats so dashboard isn't empty
    const toolFreq = {};
    sessions.forEach(s => Object.entries(s.tools||{}).forEach(([t,n]) => { toolFreq[t]=(toolFreq[t]||0)+n; }));
    const topTool = Object.entries(toolFreq).sort((a,b)=>b[1]-a[1])[0];
    fs.writeFileSync(LATEST_ANALYSIS, JSON.stringify({
      _session_count_at_analysis: totalSessions,
      _generated_by: 'checker-local',
      top_paths: [],
      quick_win: { description: 'No strong patterns detected yet — keep using Claude Code', action: 'run /desire-path:pattern-detector for a full analysis' },
      stats: { total_sessions: totalSessions, most_used_tool: topTool?.[0] || 'Bash', most_loaded_skill: null }
    }, null, 2));
  }

  // Cooldown gates surfacing (block output) but not the write above
  if (cooldown()) { process.exit(0); return; }

  // Always run inventory scan (fast, local only)
  const inv = runInventory();
  const hasDeadArtifacts = (inv.dead || 0) + (inv.stale || 0) > 0;

  if (sessions.length < 3 && !hasDeadArtifacts) { process.exit(0); return; }

  // Tier 2: suggest deep analysis when interval is reached (takes priority over other suggestions)
  if (deepAnalysisDue(totalSessions)) {
    const deepReason = `[desire-path] ${totalSessions} sessions logged since last deep analysis. `
      + `Proactively tell the user: "Your pattern data is ready for a deeper review — I can run a full analysis of your Claude Code habits and update the dashboard. Want me to do that?" `
      + `Then offer to invoke the desire-path:pattern-detector agent.`;
    fs.writeFileSync(LAST_SUGGEST, JSON.stringify({
      at: new Date().toISOString(),
      pattern: { type: 'deep_analysis', description: deepReason, frequency: totalSessions }
    }));
    try { fs.unlinkSync(ANALYSIS_DUE); } catch {}
    process.stdout.write(JSON.stringify({ decision: 'block', reason: deepReason }));
    process.exit(0);
  }

  // Surface pattern suggestion (stricter gate than storage)
  if (shouldSurface) {
    const fp = fingerprint(pattern.type, pattern.trigger || pattern.description);
    fs.writeFileSync(LAST_SUGGEST, JSON.stringify({ at: new Date().toISOString(), pattern: { ...pattern, fingerprint: fp } }));
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
