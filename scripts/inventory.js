#!/usr/bin/env node
/**
 * desire-path: inventory scanner
 *
 * Scans all installed skills, agents, commands, and hooks.
 * Crosses with usage data to find dead artifacts.
 * Writes ~/.claude/desire-path/inventory.json
 *
 * Called by:
 *   - checker.js  (on Stop, after pattern check — adds dead-artifact suggestions)
 *   - dashboard.js (to render the inventory panel)
 *   - /desire-path:cleanup skill (interactive cleanup)
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const HOME = os.homedir();
const DIR  = path.join(HOME, '.claude', 'desire-path');
const CWD  = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// ── Scan locations ────────────────────────────────────────────────────────────

const LOCATIONS = {
  skills: [
    { path: path.join(HOME, '.claude', 'skills'),   scope: 'user'    },
    { path: path.join(CWD,  '.claude', 'skills'),   scope: 'project' },
    { path: path.join(HOME, '.claude', 'commands'), scope: 'user',    type: 'command' },
    { path: path.join(CWD,  '.claude', 'commands'), scope: 'project', type: 'command' },
  ],
  agents: [
    { path: path.join(HOME, '.claude', 'agents'), scope: 'user'    },
    { path: path.join(CWD,  '.claude', 'agents'), scope: 'project' },
  ],
};

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm = {};
  match[1].split('\n').forEach(line => {
    const [k, ...v] = line.split(':');
    if (k && v.length) fm[k.trim()] = v.join(':').trim().replace(/^['"]|['"]$/g, '');
  });
  return fm;
}

function readFirstLines(file, n = 3) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').slice(0, n).join(' ').substring(0, 120);
  } catch { return ''; }
}

function scanSkills() {
  const results = [];
  for (const loc of LOCATIONS.skills) {
    if (!fs.existsSync(loc.path)) continue;
    try {
      const entries = fs.readdirSync(loc.path, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          // New skill format: dir/SKILL.md
          const skillMd = path.join(loc.path, entry.name, 'SKILL.md');
          if (fs.existsSync(skillMd)) {
            const content = fs.readFileSync(skillMd, 'utf8');
            const fm = parseFrontmatter(content);
            results.push({
              name: fm.name || entry.name,
              type: 'skill',
              scope: loc.scope,
              path: skillMd,
              dir: path.join(loc.path, entry.name),
              description: fm.description?.replace(/\n\s+/g, ' ').trim() || '',
              created: fs.statSync(skillMd).birthtime?.toISOString() || null,
              modified: fs.statSync(skillMd).mtime?.toISOString() || null,
            });
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          // Legacy command format: flat .md file
          const filePath = path.join(loc.path, entry.name);
          const content  = fs.readFileSync(filePath, 'utf8');
          const fm       = parseFrontmatter(content);
          results.push({
            name: entry.name.replace('.md', ''),
            type: loc.type || 'command',
            scope: loc.scope,
            path: filePath,
            dir: null,
            description: fm.description || readFirstLines(filePath, 2),
            created: fs.statSync(filePath).birthtime?.toISOString() || null,
            modified: fs.statSync(filePath).mtime?.toISOString() || null,
          });
        }
      }
    } catch {}
  }
  return results;
}

function scanAgents() {
  const results = [];
  for (const loc of LOCATIONS.agents) {
    if (!fs.existsSync(loc.path)) continue;
    try {
      const entries = fs.readdirSync(loc.path, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const filePath = path.join(loc.path, entry.name);
          const content  = fs.readFileSync(filePath, 'utf8');
          const fm       = parseFrontmatter(content);
          results.push({
            name: fm.name || entry.name.replace('.md', ''),
            type: 'agent',
            scope: loc.scope,
            path: filePath,
            dir: null,
            description: fm.description?.replace(/\n\s+/g, ' ').trim() || '',
            model: fm.model || 'sonnet',
            created: fs.statSync(filePath).birthtime?.toISOString() || null,
            modified: fs.statSync(filePath).mtime?.toISOString() || null,
          });
        }
      }
    } catch {}
  }
  return results;
}

function scanHooks() {
  const results = [];
  const settingsFiles = [
    { path: path.join(HOME, '.claude', 'settings.json'), scope: 'user'    },
    { path: path.join(CWD,  '.claude', 'settings.json'), scope: 'project' },
  ];
  for (const sf of settingsFiles) {
    if (!fs.existsSync(sf.path)) continue;
    try {
      const settings = JSON.parse(fs.readFileSync(sf.path, 'utf8'));
      const hooks = settings.hooks || {};
      for (const [event, groups] of Object.entries(hooks)) {
        for (const group of (groups || [])) {
          for (const hook of (group.hooks || [])) {
            const cmd = hook.command || hook.url || hook.prompt || '';
            results.push({
              name: `${event}:${cmd.substring(0, 40).replace(/\s+/g, '-')}`,
              type: 'hook',
              scope: sf.scope,
              path: sf.path,
              dir: null,
              event,
              matcher: group.matcher || '',
              command: cmd,
              hookType: hook.type || 'command',
              async: hook.async || false,
              description: `${event} → ${cmd.substring(0, 60)}`,
              created: fs.statSync(sf.path).birthtime?.toISOString() || null,
              modified: fs.statSync(sf.path).mtime?.toISOString() || null,
            });
          }
        }
      }
    } catch {}
  }
  return results;
}

// ── Kept artifacts ───────────────────────────────────────────────────────────

function loadKept() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(DIR, 'kept.json'), 'utf8'));
    return new Set((data.artifacts || []).map(a => a.name));
  } catch { return new Set(); }
}

// ── Cross with usage data ─────────────────────────────────────────────────────

function loadUsage() {
  // Merge compacted totals + recent raw rows
  let totals = {};
  try { totals = JSON.parse(fs.readFileSync(path.join(DIR, 'usage-totals.json'), 'utf8')); } catch {}
  try {
    fs.readFileSync(path.join(DIR, 'usage.jsonl'), 'utf8')
      .split('\n').filter(Boolean)
      .forEach(l => {
        const u = JSON.parse(l);
        if (!u.artifact_name) return;
        if (!totals[u.artifact_name]) totals[u.artifact_name] = { total_uses: 0, last_used: null };
        totals[u.artifact_name].total_uses++;
        if (!totals[u.artifact_name].last_used || u.at > totals[u.artifact_name].last_used)
          totals[u.artifact_name].last_used = u.at;
      });
  } catch {}
  return totals;
}

function daysSince(isoStr) {
  if (!isoStr) return 9999;
  return Math.round((Date.now() - new Date(isoStr).getTime()) / 86400000);
}

function classify(artifact, usageData) {
  const u = usageData[artifact.name] || usageData[artifact.name?.split(':').pop()] || {};
  const uses      = u.total_uses || 0;
  const lastUsed  = u.last_used  || null;
  const age       = daysSince(artifact.created);
  const staleness = daysSince(lastUsed);

  // Hooks are harder to track — give them benefit of the doubt
  if (artifact.type === 'hook') {
    return { uses, lastUsed, status: 'active', verdict: 'hook — usage hard to track', action: null };
  }

  if (uses === 0 && age > 14) {
    return {
      uses, lastUsed,
      status: 'dead',
      verdict: `never used (${age}d old)`,
      action: 'remove'
    };
  }
  if (uses === 0 && age <= 14) {
    return { uses, lastUsed, status: 'new', verdict: `new (${age}d old)`, action: null };
  }
  if (uses > 0 && staleness > 30) {
    return {
      uses, lastUsed,
      status: 'stale',
      verdict: `${uses} uses, last ${staleness}d ago`,
      action: 'review'
    };
  }
  if (uses >= 5) {
    return { uses, lastUsed, status: 'active', verdict: `${uses} uses ✓`, action: null };
  }
  return { uses, lastUsed, status: 'low', verdict: `${uses} uses`, action: null };
}

// ── Main ──────────────────────────────────────────────────────────────────────

try {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

  const usage     = loadUsage();
  const kept      = loadKept();
  const skills    = scanSkills();
  const agents    = scanAgents();
  const hooks     = scanHooks();
  const all       = [...skills, ...agents, ...hooks];

  // Attach classification to each artifact; override status for kept artifacts
  const enriched = all.map(a => {
    const c = classify(a, usage);
    if (kept.has(a.name) && (c.status === 'dead' || c.status === 'stale')) {
      return { ...a, ...c, status: 'kept', verdict: 'kept (explicitly retained)', action: null };
    }
    return { ...a, ...c };
  });

  const dead   = enriched.filter(a => a.status === 'dead');
  const stale  = enriched.filter(a => a.status === 'stale');
  const active = enriched.filter(a => a.status === 'active');
  const newArt = enriched.filter(a => a.status === 'new');

  const inventory = {
    scanned_at: new Date().toISOString(),
    cwd: CWD,
    summary: {
      total: enriched.length,
      active: active.length,
      new: newArt.length,
      stale: stale.length,
      dead: dead.length,
    },
    artifacts: enriched,
    dead,
    stale,
  };

  fs.writeFileSync(path.join(DIR, 'inventory.json'), JSON.stringify(inventory, null, 2));

  // Print summary for caller (checker.js picks this up)
  process.stdout.write(JSON.stringify({
    total: enriched.length,
    dead: dead.length,
    stale: stale.length,
    dead_names: dead.map(a => a.name),
    stale_names: stale.map(a => a.name),
  }));

} catch (e) {
  process.stdout.write('{}');
}

process.exit(0);
