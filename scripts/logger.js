#!/usr/bin/env node
/**
 * desire-path: silent logger v4
 *
 * Tracks sessions, skill/hook usage, suggestion outcomes.
 * Self-compacting on Stop:
 *   - sessions.jsonl  → max 100 entries (older ones aggregated into sessions-archive.json)
 *   - usage.jsonl     → compacted into usage-totals.json after every 200 entries
 *   - state.json      → cleared after each Stop
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const DIR          = path.join(os.homedir(), '.claude', 'desire-path');
const SESSIONS     = path.join(DIR, 'sessions.jsonl');
const USAGE        = path.join(DIR, 'usage.jsonl');
const USAGE_TOTALS = path.join(DIR, 'usage-totals.json');  // compacted aggregates
const ARCHIVE      = path.join(DIR, 'sessions-archive.json'); // summary of old sessions
const STATE        = path.join(DIR, 'state.json');
const PAVED        = path.join(DIR, 'paved.jsonl');
const SUGGESTIONS  = path.join(DIR, 'suggestions.jsonl');
const ANALYSIS_DUE = path.join(DIR, 'analysis-due.json');
const DENIED       = path.join(DIR, 'denied-totals.json');

const MAX_SESSIONS   = 100;  // keep in hot jsonl
const MAX_USAGE_ROWS = 200;  // compact usage after this many raw entries

// ── Helpers ───────────────────────────────────────────────────────────────────

function readLines(file) {
  try { return fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)); }
  catch { return []; }
}

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return fallback; }
}

// ── Compact sessions.jsonl ────────────────────────────────────────────────────
// Keep the 100 most recent full entries. Older ones are summarised into
// sessions-archive.json so the dashboard can still show historical totals
// without needing to read thousands of lines.

function compactSessions() {
  const lines = readLines(SESSIONS);
  if (lines.length <= MAX_SESSIONS) return;

  const keep   = lines.slice(-MAX_SESSIONS);
  const old    = lines.slice(0, -MAX_SESSIONS);

  // Merge old entries into archive aggregate
  const archive = loadJSON(ARCHIVE, {
    total_sessions: 0,
    total_turns: 0,
    tool_totals: {},
    skill_totals: {},
    first_session: null,
    last_archived: null
  });

  old.forEach(s => {
    archive.total_sessions++;
    archive.total_turns += s.turns || 0;
    Object.entries(s.tools || {}).forEach(([t,n]) => {
      archive.tool_totals[t] = (archive.tool_totals[t] || 0) + n;
    });
    (s.skills || []).forEach(sk => {
      archive.skill_totals[sk] = (archive.skill_totals[sk] || 0) + 1;
    });
    if (!archive.first_session || s.at < archive.first_session) archive.first_session = s.at;
  });
  archive.last_archived = new Date().toISOString();
  archive.compacted_count = (archive.compacted_count || 0) + old.length;

  fs.writeFileSync(ARCHIVE, JSON.stringify(archive, null, 2));
  fs.writeFileSync(SESSIONS, keep.map(l => JSON.stringify(l)).join('\n') + '\n');
}

// ── Compact usage.jsonl ───────────────────────────────────────────────────────
// Fold raw usage entries into usage-totals.json:
//   { "auto-test": { type, total_uses, last_used, daily: {"2026-04-27": 3} } }
// Raw file is then cleared. Dashboard reads totals, not raw rows.

function compactUsage() {
  const rows = readLines(USAGE);
  if (rows.length <= MAX_USAGE_ROWS) return;

  const totals = loadJSON(USAGE_TOTALS, {});

  rows.forEach(row => {
    const name = row.artifact_name;
    if (!name) return;
    if (!totals[name]) totals[name] = { type: row.artifact_type, total_uses: 0, last_used: null, daily: {} };
    totals[name].total_uses++;
    if (!totals[name].last_used || row.at > totals[name].last_used) totals[name].last_used = row.at;
    const day = (row.at || '').slice(0, 10);
    if (day) totals[name].daily[day] = (totals[name].daily[day] || 0) + 1;
  });

  // Prune daily entries older than 90 days
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  Object.values(totals).forEach(t => {
    Object.keys(t.daily || {}).forEach(d => { if (d < cutoff) delete t.daily[d]; });
  });

  fs.writeFileSync(USAGE_TOTALS, JSON.stringify(totals, null, 2));
  fs.writeFileSync(USAGE, ''); // cleared — totals are in usage-totals.json
}

// ── Main ──────────────────────────────────────────────────────────────────────

try {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

  const event = process.env.DP_EVENT || 'unknown';
  const now   = new Date().toISOString();
  const sid   = process.env.CLAUDE_SESSION_ID || 'unknown';

  // Read stdin
  let raw = '';
  try {
    const fd = fs.openSync('/dev/stdin', 'r');
    const buf = Buffer.alloc(65536);
    let n, chunks = [];
    while ((n = fs.readSync(fd, buf, 0, buf.length)) > 0) chunks.push(buf.slice(0, n).toString());
    fs.closeSync(fd);
    raw = chunks.join('');
  } catch {}
  let hook = {};
  try { hook = JSON.parse(raw); } catch {}

  // Load paved artifact names for usage detection
  let pavedMap = {};  // name → type
  try {
    readLines(PAVED).forEach(p => { if (p.name) pavedMap[p.name] = p.type; });
  } catch {}

  // Session state
  let state = { session_id: null, started_at: null, tools: {}, pre_tools: {}, skills: [], commands: {}, agents: {}, prompts: [], turns: 0, paved_used: [], bash_cmds: {} };
  try { state = loadJSON(STATE, state); } catch {}
  if (state.session_id !== sid) {
    state = { session_id: sid, started_at: now, tools: {}, pre_tools: {}, skills: [], commands: {}, agents: {}, prompts: [], turns: 0, paved_used: [], bash_cmds: {} };
  }
  if (!state.bash_cmds) state.bash_cmds = {};
  if (!state.pre_tools) state.pre_tools = {};
  if (!state.commands) state.commands = {};
  if (!state.agents) state.agents = {};
  if (!state.calls) state.calls = [];

  // ── PreToolUse ──────────────────────────────────────────────────────────────
  if (event === 'PreToolUse') {
    const tool = hook.tool_name;
    if (tool) state.pre_tools[tool] = (state.pre_tools[tool] || 0) + 1;

    if (tool === 'Skill') {
      const skillName = hook.tool_input?.skill || hook.tool_input?.skill_name || hook.tool_input?.name || '';
      if (skillName) {
        if (state.active_skill && state.active_skill !== skillName) {
          state.calls.push({ from: state.active_skill, to: skillName, edge: 'skill_skill' });
        }
        state.active_skill = skillName;
      }
    }

    if (tool === 'Agent') {
      const agentType = hook.tool_input?.subagent_type || 'general-purpose';
      if (state.active_skill) {
        state.calls.push({ from: state.active_skill, to: agentType, edge: 'skill_agent' });
      }
    }
  }

  // ── PostToolUse ─────────────────────────────────────────────────────────────
  if (event === 'PostToolUse') {
    const tool = hook.tool_name;
    if (tool) state.tools[tool] = (state.tools[tool] || 0) + 1;
    state.turns++;

    if (tool === 'Skill') {
      const skillName = hook.tool_input?.skill || hook.tool_input?.skill_name || hook.tool_input?.name || '';
      if (skillName) {
        if (!state.skills.includes(skillName)) state.skills.push(skillName);
        const pavedMatch = Object.keys(pavedMap).find(n =>
          skillName.includes(n) || n.includes(skillName.split(':').pop())
        );
        if (pavedMatch) {
          fs.appendFileSync(USAGE, JSON.stringify({
            at: now, sid, artifact_name: pavedMatch,
            artifact_type: 'skill',
            invocation: skillName,
            source: hook.tool_input?.invocation_source || 'unknown'
          }) + '\n');
          if (!state.paved_used.includes(pavedMatch)) state.paved_used.push(pavedMatch);
        }
      }
      state.active_skill = null;
    }

    if (tool === 'Agent') {
      const agentType = hook.tool_input?.subagent_type || 'general-purpose';
      state.agents[agentType] = (state.agents[agentType] || 0) + 1;
    }

    if (tool === 'Bash') {
      const cmd = hook.tool_input?.command || '';
      const sig = cmd.trim().substring(0, 120);
      if (sig) state.bash_cmds[sig] = (state.bash_cmds[sig] || 0) + 1;
      Object.keys(pavedMap).forEach(name => {
        if (pavedMap[name] === 'hook' && cmd.includes(name)) {
          fs.appendFileSync(USAGE, JSON.stringify({
            at: now, sid, artifact_name: name, artifact_type: 'hook',
            invocation: cmd.substring(0, 80)
          }) + '\n');
        }
      });
    }
  }

  // ── UserPromptSubmit ────────────────────────────────────────────────────────
  if (event === 'UserPromptSubmit') {
    const txt = hook.prompt || hook.message || '';
    if (txt.trim()) {
      state.prompts.push({ t: now, p: txt.substring(0, 250) });
      if (state.prompts.length > 20) state.prompts = state.prompts.slice(-20);

      // Skill tool doesn't fire PostToolUse hooks — infer from /command prompts instead
      if (txt.trim().startsWith('/')) {
        const skillName = txt.trim().split(/\s+/)[0].slice(1); // strip leading /
        if (skillName) {
          state.commands[skillName] = (state.commands[skillName] || 0) + 1;
        }
        if (skillName && !state.skills.includes(skillName)) {
          state.skills.push(skillName);
          const pavedMatch = Object.keys(pavedMap).find(n =>
            skillName.includes(n) || n.includes(skillName.split(':').pop())
          );
          if (pavedMatch) {
            fs.appendFileSync(USAGE, JSON.stringify({
              at: now, sid, artifact_name: pavedMatch,
              artifact_type: 'skill', invocation: skillName, source: 'prompt'
            }) + '\n');
            if (!state.paved_used.includes(pavedMatch)) state.paved_used.push(pavedMatch);
          }
        }
      }

      const acceptance = /^(yes|ja|do it|create|make it|add it|sure|go ahead|ok|yep|doe het|maak het)/i;
      if (acceptance.test(txt.trim())) {
        try {
          const lastSuggest = loadJSON(path.join(DIR, 'last-suggestion.json'), null);
          if (lastSuggest) {
            const age = Date.now() - new Date(lastSuggest.at).getTime();
            if (age < 5 * 60 * 1000) {
              const existing = fs.existsSync(SUGGESTIONS)
                ? fs.readFileSync(SUGGESTIONS, 'utf8').trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
                : [];
              const alreadyLogged = existing.some(e =>
                e.outcome === 'accepted' &&
                e.pattern?.type === lastSuggest.pattern?.type &&
                e.pattern?.description === lastSuggest.pattern?.description
              );
              if (!alreadyLogged) {
                fs.appendFileSync(SUGGESTIONS, JSON.stringify({
                  at: now, sid, pattern: lastSuggest.pattern, outcome: 'accepted'
                }) + '\n');
              }
            }
          }
        } catch {}
      }
    }
  }

  fs.writeFileSync(STATE, JSON.stringify(state));

  // ── Stop: flush + compact ───────────────────────────────────────────────────
  if (event === 'Stop') {
    const topBash = Object.entries(state.bash_cmds)
      .filter(([,n]) => n >= 2)
      .sort((a,b) => b[1]-a[1])
      .slice(0, 5);

    // Compute implied denials: tools requested (pre) but not completed (post)
    const deniedTools = {};
    Object.entries(state.pre_tools || {}).forEach(([t, pre]) => {
      const post = state.tools[t] || 0;
      if (pre > post) deniedTools[t] = pre - post;
    });
    if (Object.keys(deniedTools).length > 0) {
      const existing = loadJSON(DENIED, {});
      Object.entries(deniedTools).forEach(([t, n]) => {
        existing[t] = (existing[t] || 0) + n;
      });
      fs.writeFileSync(DENIED, JSON.stringify(existing, null, 2));
    }

    fs.appendFileSync(SESSIONS, JSON.stringify({
      sid, at: now, started: state.started_at,
      tools: state.tools, skills: state.skills,
      commands: state.commands, agents: state.agents,
      prompts: state.prompts, turns: state.turns,
      paved_used: state.paved_used,
      top_bash: topBash,
      denied_tools: deniedTools,
      calls: state.calls
    }) + '\n');

    // Self-compact — runs in same process, no extra spawn
    compactSessions();
    compactUsage();

    // Clear state for next session
    fs.writeFileSync(STATE, '{}');

    // Check analysis threshold
    const hotCount  = readLines(SESSIONS).length;
    const archCount = loadJSON(ARCHIVE, { total_sessions: 0 }).total_sessions;
    const total     = hotCount + archCount;
    const lastCount = loadJSON(path.join(DIR,'latest-analysis.json'), {})._session_count_at_analysis || 0;
    if (total - lastCount >= 5) {
      fs.writeFileSync(ANALYSIS_DUE, JSON.stringify({ total_sessions: total, triggered_at: now }));
    }
  }

} catch (_) {}
process.exit(0);
