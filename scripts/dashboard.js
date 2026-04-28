#!/usr/bin/env node
/**
 * desire-path: dashboard generator v4 — Observatory edition
 *
 * Reads all data files, injects as JSON into a self-contained HTML file,
 * opens in browser. The HTML uses vanilla JS so no build step needed.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execSync } = require('child_process');

const DIR = path.join(os.homedir(), '.claude', 'desire-path');
const OUT = path.join(DIR, 'dashboard.html');

// ── Load data ─────────────────────────────────────────────────────────────────
function lines(file) {
  try { return fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)); }
  catch { return []; }
}
function json(file, fb) {
  try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return fb; }
}

// First run inventory scan so data is fresh
try {
  execSync(`node "${path.join(__dirname,'inventory.js')}"`, { timeout:8000, env:process.env });
} catch {}

const sessions    = lines(path.join(DIR,'sessions.jsonl'));
const usageRaw    = lines(path.join(DIR,'usage.jsonl'));
const usageTotals = json(path.join(DIR,'usage-totals.json'), {});
const suggestions = lines(path.join(DIR,'suggestions.jsonl'));
const paved       = lines(path.join(DIR,'paved.jsonl'));
const analysis    = json(path.join(DIR,'latest-analysis.json'), {});
const lastSuggest = json(path.join(DIR,'last-suggestion.json'), null);
const archive     = json(path.join(DIR,'sessions-archive.json'), {total_sessions:0,tool_totals:{},skill_totals:{}});
const inventory   = json(path.join(DIR,'inventory.json'), {summary:{total:0,dead:0,stale:0,active:0},artifacts:[],dead:[],stale:[]});
const removals    = lines(path.join(DIR,'removals.jsonl'));
const deniedRaw   = json(path.join(DIR,'denied-totals.json'), {});

// ── Compute ───────────────────────────────────────────────────────────────────
const totalSessions = sessions.length + (archive.total_sessions||0);
const allTools = {...(archive.tool_totals||{})};
sessions.forEach(s=>Object.entries(s.tools||{}).forEach(([t,n])=>{allTools[t]=(allTools[t]||0)+n;}));
const topTools = Object.entries(allTools).sort((a,b)=>b[1]-a[1]).slice(0,8);

const allSkills = {...(archive.skill_totals||{})};
sessions.forEach(s=>(s.skills||[]).forEach(sk=>{allSkills[sk]=(allSkills[sk]||0)+1;}));
const topSkills = Object.entries(allSkills).sort((a,b)=>b[1]-a[1]).slice(0,6);

const dayMap = {};
for(let i=13;i>=0;i--){const d=new Date(Date.now()-i*86400000);dayMap[d.toISOString().slice(0,10)]=0;}
sessions.forEach(s=>{if(s.at){const k=s.at.slice(0,10);if(k in dayMap)dayMap[k]++;}});
const hourMap = Array(24).fill(0);
sessions.forEach(s=>{if(s.at)hourMap[new Date(s.at).getHours()]++;});

// Top bash commands by session frequency
const bashSessionCount = {};
sessions.forEach(s => {
  const seen = new Set();
  (s.top_bash || []).forEach(([cmd]) => {
    const key = cmd.trim().replace(/^(node|npx|sudo)\s+/,'').toLowerCase().substring(0,80);
    if (key.length < 4 || seen.has(key)) return;
    seen.add(key);
    bashSessionCount[key] = (bashSessionCount[key] || 0) + 1;
  });
});
const topBashCmds = Object.entries(bashSessionCount).sort((a,b)=>b[1]-a[1]).slice(0,8);

// Merge session-level denials into totals for display
const deniedMerged = {...deniedRaw};
sessions.forEach(s => {
  Object.entries(s.denied_tools||{}).forEach(([t,n]) => {
    deniedMerged[t] = (deniedMerged[t]||0) + n;
  });
});
const topDenied = Object.entries(deniedMerged).sort((a,b)=>b[1]-a[1]).slice(0,5);

// Weekday × hour heatmap (7 days × 24 hours), 0=Mon … 6=Sun
const heatGrid = Array.from({length:7},()=>Array(24).fill(0));
sessions.forEach(s=>{
  if(!s.at)return;
  const d = new Date(s.at);
  const dow = (d.getDay()+6)%7; // convert Sun=0 to Mon=0
  heatGrid[dow][d.getHours()]++;
});

const usageByArtifact = {...usageTotals};
usageRaw.forEach(u=>{
  if(!u.artifact_name)return;
  if(!usageByArtifact[u.artifact_name])usageByArtifact[u.artifact_name]={total_uses:0,last_used:null};
  usageByArtifact[u.artifact_name].total_uses++;
  const cur = usageByArtifact[u.artifact_name].last_used;
  if(!cur||u.at>cur)usageByArtifact[u.artifact_name].last_used=u.at;
});

// Maturity stage
const _s = totalSessions, _p = paved.length, _pat = (analysis?.top_paths||[]).length;
const _w = paved.filter(p=>(usageByArtifact[p.name]?.total_uses||0)>=2).length;
const stage = _s < 5 || _pat === 0 ? 'WANDERING'
  : _p < 2                          ? 'WEARING'
  : _w < Math.ceil(_p * 0.5)        ? 'PAVING'
  :                                   'WALKING';

const pavedEnriched = paved.map(p=>({
  ...p,
  uses: usageByArtifact[p.name]?.total_uses||0,
  last_used: usageByArtifact[p.name]?.last_used||null,
  working: (usageByArtifact[p.name]?.total_uses||0)>=2
}));

const detectedPaths = analysis?.top_paths||[];
const totalSuggestions = suggestions.length;
const accepted = suggestions.filter(s=>s.outcome==='accepted').length;
const acceptRate = totalSuggestions>0?Math.round(accepted/totalSuggestions*100):0;
const workingPaths = pavedEnriched.filter(p=>p.working).length;

const allSuggestions = [...suggestions];
if(lastSuggest?.pattern){
  const desc = lastSuggest.pattern.description;
  const type = lastSuggest.pattern.type;
  // Don't add as pending if already logged by description OR if this type was already accepted
  const alreadyLogged = suggestions.find(s=>s.pattern?.description===desc);
  const typeAccepted = suggestions.some(s=>s.outcome==='accepted' && s.pattern?.type===type);
  if(!alreadyLogged && !typeAccepted) allSuggestions.push({at:lastSuggest.at,pattern:lastSuggest.pattern,outcome:'pending'});
}
const dedupedSuggestions = allSuggestions;

// ── Inject data into HTML ─────────────────────────────────────────────────────
const DATA = {
  totalSessions,
  archiveSessions: archive.total_sessions||0,
  hotSessions: sessions.length,
  pipeline: {
    detected: detectedPaths.length||0,
    proposed: dedupedSuggestions.length,
    accepted,
    acceptRate,
    paved: paved.length,
    working: workingPaths,
  },
  activity: Object.values(dayMap),
  activityDates: Object.keys(dayMap),
  hours: hourMap,
  heatGrid,
  tools: topTools,
  skills: topSkills,
  bashCmds: topBashCmds,
  paved: pavedEnriched,
  patterns: detectedPaths,
  suggestions: dedupedSuggestions,
  inventory: inventory.artifacts||[],
  removals,
  deniedTools: topDenied,
  generatedAt: new Date().toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'}),
  pendingCount: dedupedSuggestions.filter(s=>s.outcome==='pending').length,
  deadCount: (inventory.artifacts||[]).filter(a=>a.status==='dead').length,
  staleCount: (inventory.artifacts||[]).filter(a=>a.status==='stale').length,
  stage,
};

// ── HTML (Observatory — self-contained, vanilla JS) ──────────────────────────
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Desire Path · Observatory</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600&family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;1,9..144,400&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0e0d0b;--panel:#15130f;--panel-2:#1c1a15;
  --line:#2a2620;--line-2:#3a342b;
  --ink:#ece6d8;--ink-2:#bfb6a3;--muted:#807868;--faint:#5a5347;
  --signal: oklch(0.74 0.15 75);
  --signal-dim: oklch(0.74 0.15 75 / .25);
  --good: oklch(0.72 0.10 145);
  --warn: oklch(0.65 0.16 30);
}
html,body{background:var(--bg);color:var(--ink);font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;line-height:1.5;font-feature-settings:"ss01"}
body{background-image:linear-gradient(180deg,transparent 0%,oklch(0.18 0.02 70/.3) 100%),repeating-linear-gradient(0deg,transparent 0 23px,oklch(0.20 0.01 70/.35) 23px 24px)}
button{font-family:inherit;cursor:pointer;background:none;border:none;outline:none;color:inherit}
.serif{font-family:'Fraunces',serif;font-feature-settings:"ss01"}
.shell{max-width:1400px;margin:0 auto;padding:24px 32px 56px}

.strip{display:grid;grid-template-columns:auto 1fr auto;gap:24px;align-items:center;padding:12px 16px;border:1px solid var(--line);background:var(--panel);margin-bottom:16px;font-size:11px}
.strip-brand{display:flex;align-items:center;gap:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-size:10px}
.strip-brand .dot{width:6px;height:6px;border-radius:50%;background:var(--signal);box-shadow:0 0 8px var(--signal)}
.strip-brand b{color:var(--ink);letter-spacing:.18em;font-weight:500}
.strip-mid{display:flex;gap:24px;justify-content:center;color:var(--muted);font-size:10px;letter-spacing:.1em;text-transform:uppercase}
.strip-mid span b{color:var(--ink);font-weight:500}
.strip-right{color:var(--muted);font-size:10px;letter-spacing:.08em}
.strip-right b{color:var(--ink-2)}
.stage-badge{font-size:9px;letter-spacing:.2em;text-transform:uppercase;padding:3px 8px;border:1px solid var(--signal);color:var(--signal);font-weight:500}

.hero{display:grid;grid-template-columns:1.2fr 1fr;gap:16px;margin-bottom:16px}
.hero-l{padding:32px 28px 28px;border:1px solid var(--line);background:var(--panel);position:relative;overflow:hidden}
.hero-eye{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-bottom:14px}
.hero-title{font-family:'Fraunces',serif;font-size:52px;font-weight:300;line-height:.98;letter-spacing:-.025em;color:var(--ink);margin-bottom:18px}
.hero-title em{font-style:italic;color:var(--signal)}
.hero-sub{font-size:12px;color:var(--ink-2);max-width:52ch;line-height:1.6}
.hero-tags{display:flex;gap:8px;margin-top:20px;flex-wrap:wrap}
.tag{font-size:10px;padding:4px 9px;border:1px solid var(--line-2);color:var(--ink-2);letter-spacing:.06em}
.tag b{color:var(--signal);font-weight:500}

.hero-r{display:grid;grid-template-rows:auto 1fr;gap:0;border:1px solid var(--line);background:var(--panel)}
.hero-r-top{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--line)}
.cell{padding:18px 20px;border-right:1px solid var(--line)}
.cell:last-child{border-right:none}
.cell-lbl{font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.cell-n{font-family:'Fraunces',serif;font-size:42px;font-weight:300;line-height:1;color:var(--ink)}
.cell-n.signal{color:var(--signal)}
.cell-sub{font-size:10px;color:var(--muted);margin-top:6px;letter-spacing:.04em}
.hero-r-bot{padding:18px 20px}
.hero-r-bot .cell-lbl{margin-bottom:10px}
.hero-spark{display:flex;align-items:flex-end;gap:2px;height:64px}
.hero-spark .col{flex:1;background:var(--ink-2);min-height:1px}
.hero-spark .col.peak{background:var(--signal)}
.hero-spark-meta{display:flex;justify-content:space-between;margin-top:8px;font-size:9px;color:var(--faint);letter-spacing:.1em;text-transform:uppercase}

.funnel{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid var(--line);background:var(--panel);margin-bottom:24px}
.fn{padding:20px 22px;border-right:1px solid var(--line);position:relative}
.fn:last-child{border-right:none}
.fn-num{font-family:'Fraunces',serif;font-size:34px;font-weight:300;line-height:1;letter-spacing:-.02em}
.fn-num.signal{color:var(--signal)}
.fn-num.good{color:var(--good)}
.fn-lbl{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-2);margin-top:8px;font-weight:500}
.fn-meta{font-size:10px;color:var(--muted);margin-top:4px}
.fn-bar{position:absolute;bottom:0;left:0;height:2px;background:var(--signal)}
.fn-arrow{position:absolute;top:50%;right:-7px;transform:translateY(-50%);width:14px;height:14px;background:var(--bg);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:9px;z-index:1}
.fn:last-child .fn-arrow{display:none}

.tabs{display:flex;gap:0;border-bottom:1px solid var(--line);margin-bottom:20px}
.tab{font-size:11px;letter-spacing:.14em;text-transform:uppercase;padding:10px 18px;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-1px;font-weight:500}
.tab.active{color:var(--ink);border-bottom-color:var(--signal)}
.tab .count{color:var(--faint);margin-left:6px;font-weight:400}
.tab.active .count{color:var(--signal)}

.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
.panel{border:1px solid var(--line);background:var(--panel);padding:18px 20px}
.panel-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--line)}
.panel-title{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--ink);font-weight:500}
.panel-meta{font-size:10px;color:var(--muted);letter-spacing:.04em}

.bars{display:flex;flex-direction:column;gap:6px}
.bar-row{display:grid;grid-template-columns:130px 1fr 36px;gap:10px;align-items:center}
.bar-name{font-size:11px;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;cursor:default}
.bar-track{height:8px;position:relative;background:var(--panel-2);border-radius:1px;overflow:hidden}
.bar-fill{height:100%;background:var(--signal);border-radius:1px;transition:width .3s ease}
.bar-val{font-size:11px;color:var(--ink);text-align:right;font-variant-numeric:tabular-nums}

.spark-big{display:flex;align-items:flex-end;gap:3px;height:120px;padding-top:8px}
.spark-big .col{flex:1;background:var(--ink-2);position:relative;min-height:2px}
.spark-big .col.peak{background:var(--signal)}
.spark-big .col .lbl{position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);font-size:9px;color:var(--faint);white-space:nowrap}
.heat-wide{display:grid;grid-template-columns:repeat(24,1fr);gap:1px;height:120px;align-items:end}
.heat-wide .h{background:var(--signal-dim);min-height:1px}
.heat-wide .h.peak{background:var(--signal)}
.heat-axis{display:flex;justify-content:space-between;margin-top:8px;font-size:9px;color:var(--faint);letter-spacing:.08em}

.wk-heatmap{display:grid;grid-template-columns:32px repeat(24,1fr);gap:1px}
.wk-row{display:contents}
.wk-label{font-size:9px;color:var(--muted);display:flex;align-items:center;letter-spacing:.08em;text-transform:uppercase;padding-right:4px;justify-content:flex-end}
.wk-cell{height:14px;background:var(--panel-2);cursor:default}
.wk-axis{display:grid;grid-template-columns:32px repeat(24,1fr);gap:1px;margin-top:4px}
.wk-axis-lbl{font-size:9px;color:var(--faint);text-align:center;letter-spacing:.04em}

.tbl{width:100%;border-collapse:collapse;font-size:11px}
.tbl thead th{font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-weight:500;padding:8px 10px;text-align:left;border-bottom:1px solid var(--line)}
.tbl thead th.r{text-align:right}
.tbl tbody td{padding:10px;border-bottom:1px solid var(--line);vertical-align:middle}
.tbl tbody td.r{text-align:right}
.tbl tbody tr:hover{background:var(--panel-2)}
.t-name{color:var(--ink);font-weight:500}
.t-type{color:var(--muted);font-size:10px;letter-spacing:.04em}
.t-num{color:var(--ink);font-variant-numeric:tabular-nums}
.t-num.zero{color:var(--faint)}
.t-when{color:var(--muted);font-size:10px}
.t-status{font-size:10px;letter-spacing:.08em;text-transform:uppercase}
.t-status.working{color:var(--good)}
.t-status.growing{color:var(--signal)}
.t-status.dead{color:var(--warn)}
.t-status.stale{color:var(--muted)}
.dot-mini{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:8px;vertical-align:middle}
.dm-skill{background:var(--signal)}
.dm-hook{background:var(--good)}
.dm-agent{background:#9a8db3}
.dm-claude_md{background:var(--signal-dim);border:1px solid var(--signal)}
.dm-command{background:var(--muted)}
.dm-plugin{background:var(--ink-2)}

.trend{display:inline-flex;align-items:flex-end;gap:1px;height:14px;width:48px}
.trend .b{flex:1;background:var(--ink-2);opacity:.5;min-height:1px}
.trend .b.last{background:var(--signal);opacity:1}

.pattern{display:grid;grid-template-columns:48px 1fr 110px 90px;gap:18px;padding:18px 20px;border:1px solid var(--line);background:var(--panel);margin-bottom:8px;align-items:center}
.p-rank{font-family:'Fraunces',serif;font-size:24px;color:var(--muted);font-weight:300}
.p-quote{font-family:'Fraunces',serif;font-size:18px;font-weight:400;color:var(--ink);line-height:1.4;margin-bottom:8px;letter-spacing:-.005em}
.p-meta{display:flex;gap:10px;align-items:center}
.p-tag{font-size:9px;letter-spacing:.16em;text-transform:uppercase;padding:3px 8px;border:1px solid var(--line-2);color:var(--ink-2)}
.p-trigger{font-size:10px;color:var(--muted)}
.p-trigger b{color:var(--ink-2);font-weight:400}
.p-strength{display:flex;flex-direction:column;gap:6px}
.p-strength-bar{height:3px;background:var(--line);position:relative}
.p-strength-bar .fill{position:absolute;inset:0 auto 0 0;background:var(--signal)}
.p-strength-lbl{font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.p-freq{text-align:right;font-family:'Fraunces',serif}
.p-freq-n{font-size:32px;font-weight:300;color:var(--signal);line-height:1}
.p-freq-x{font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin-top:4px;font-family:'JetBrains Mono'}

.log{border:1px solid var(--line);background:var(--panel)}
.log-row{display:grid;grid-template-columns:80px 14px 1fr 80px 80px;gap:14px;padding:11px 18px;border-bottom:1px solid var(--line);align-items:center}
.log-row:last-child{border-bottom:none}
.log-time{font-size:10px;color:var(--muted);letter-spacing:.04em}
.log-dot{width:6px;height:6px;border-radius:50%;justify-self:center}
.log-msg{font-size:12px;color:var(--ink-2)}
.log-type{font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);text-align:right}
.log-out{font-size:9px;letter-spacing:.16em;text-transform:uppercase;text-align:right;font-weight:500}
.log-out.accepted{color:var(--good)}
.log-out.declined{color:var(--warn)}
.log-out.pending{color:var(--signal)}

.inv-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid var(--line);background:var(--panel);margin-bottom:16px}
.inv-cell{padding:18px 22px;border-right:1px solid var(--line)}
.inv-cell:last-child{border-right:none}
.inv-cell-n{font-family:'Fraunces',serif;font-size:36px;font-weight:300;line-height:1}
.inv-cell-n.good{color:var(--good)}
.inv-cell-n.signal{color:var(--signal)}
.inv-cell-n.warn{color:var(--warn)}
.inv-cell-lbl{font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-top:8px}
.inv-cell-pct{font-size:10px;color:var(--muted);margin-top:4px}

.inv-tbl tbody tr.dead td{opacity:.5}
.inv-tbl tbody tr.dead .t-name{text-decoration:line-through}
.row-act{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);text-align:right}
.row-act.remove{color:var(--warn)}
.row-act.review{color:var(--signal)}

.callout{margin-top:16px;padding:16px 20px;border:1px solid var(--warn);background:oklch(0.20 0.05 30/.4);display:flex;justify-content:space-between;align-items:center;gap:18px}
.callout-text{font-size:12px;color:var(--ink-2)}
.callout-text b{color:var(--warn)}
.callout-cmd{font-size:11px;padding:7px 12px;border:1px solid var(--warn);color:var(--ink);background:var(--bg);letter-spacing:.06em}

.foot{margin-top:32px;padding-top:14px;border-top:1px solid var(--line);display:flex;justify-content:space-between;font-size:10px;color:var(--faint);letter-spacing:.1em;text-transform:uppercase}
.foot em{font-family:'Fraunces',serif;font-style:italic;text-transform:none;letter-spacing:0;font-size:13px;color:var(--muted)}

.empty{color:var(--muted);font-size:12px;padding:20px;text-align:center;border:1px dashed var(--line);background:var(--panel)}

/* ── Aerial Map ─────────────────────────────────────────────── */
.map-wrap{position:relative;border:1px solid var(--line);background:#13110d;overflow:hidden}
.map-svg{display:block;width:100%;height:auto;background:
  radial-gradient(ellipse at 50% 45%, oklch(0.22 0.04 110/.6) 0%, transparent 55%),
  radial-gradient(ellipse at 30% 80%, oklch(0.20 0.05 130/.4) 0%, transparent 50%),
  radial-gradient(ellipse at 75% 25%, oklch(0.21 0.05 100/.45) 0%, transparent 55%),
  linear-gradient(160deg, oklch(0.16 0.02 100) 0%, oklch(0.13 0.02 90) 100%)}
.map-grain{position:absolute;inset:0;pointer-events:none;opacity:.08;mix-blend-mode:overlay;
  background-image:radial-gradient(circle at 1px 1px, oklch(0.55 0.06 90) 1px, transparent 0);
  background-size:3px 3px}
.map-vignette{position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(ellipse at center, transparent 50%, oklch(0.08 0.01 90/.6) 100%)}

.map-legend{position:absolute;left:18px;bottom:18px;background:oklch(0.12 0.02 90/.85);border:1px solid var(--line);padding:12px 14px;font-size:10px;letter-spacing:.05em;color:var(--ink-2);backdrop-filter:blur(4px);max-width:220px}
.map-legend-title{font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;font-weight:500}
.map-legend-row{display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:10px}
.map-legend-row:last-child{margin-bottom:0}
.map-legend-swatch{width:22px;height:2px;flex-shrink:0}
.map-legend-pin{width:8px;height:8px;border-radius:50%;flex-shrink:0}

.map-meta{position:absolute;right:18px;top:18px;background:oklch(0.12 0.02 90/.85);border:1px solid var(--line);padding:10px 14px;font-size:10px;letter-spacing:.08em;color:var(--ink-2);text-transform:uppercase;backdrop-filter:blur(4px)}
.map-meta b{color:var(--signal);font-weight:500}

.map-compass{position:absolute;left:18px;top:18px;width:42px;height:42px;border:1px solid var(--line);border-radius:50%;background:oklch(0.12 0.02 90/.85);display:flex;align-items:center;justify-content:center;font-family:'Fraunces',serif;font-size:14px;color:var(--muted);font-style:italic;backdrop-filter:blur(4px)}

.map-cap{padding:14px 20px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:baseline}
.map-cap-title{font-family:'Fraunces',serif;font-size:18px;font-weight:400;font-style:italic;color:var(--ink);letter-spacing:-.005em}
.map-cap-sub{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}

.map-pin-label{font-family:'JetBrains Mono',monospace;font-size:9px;fill:var(--ink-2);letter-spacing:.04em;paint-order:stroke;stroke:oklch(0.12 0.02 90/.9);stroke-width:3px;stroke-linejoin:round}
.map-pin-uses{font-family:'Fraunces',serif;font-size:11px;fill:var(--signal);font-style:italic;paint-order:stroke;stroke:oklch(0.12 0.02 90/.95);stroke-width:3px}

.map-origin-label{font-family:'Fraunces',serif;font-size:11px;fill:var(--muted);font-style:italic;letter-spacing:.04em;paint-order:stroke;stroke:oklch(0.12 0.02 90/.9);stroke-width:3px}

.map-key{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border-top:1px solid var(--line)}
.map-key-cell{padding:14px 18px;border-right:1px solid var(--line)}
.map-key-cell:last-child{border-right:none}
.map-key-n{font-family:'Fraunces',serif;font-size:24px;font-weight:300;line-height:1}
.map-key-n.signal{color:var(--signal)}
.map-key-n.good{color:var(--good)}
.map-key-n.warn{color:var(--warn)}
.map-key-lbl{font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin-top:6px}
.map-key-meta{font-size:10px;color:var(--ink-2);margin-top:3px;font-style:italic;font-family:'Fraunces',serif}
</style>
</head>
<body>
<div class="shell">

<div class="strip">
  <div class="strip-brand"><span class="dot"></span><b>desire-path</b><span style="color:var(--faint)">obs.</span></div>
  <div class="strip-mid">
    <span>uptime <b>${totalSessions}</b> sess</span>
    <span>last sweep <b>${DATA.generatedAt.split(',').pop().trim()}</b></span>
    <span>pending <b style="color:var(--signal)">${DATA.pendingCount}</b></span>
    <span>dead <b style="color:var(--warn)">${DATA.deadCount}</b></span>
    <span>stale <b style="color:var(--muted)">${DATA.staleCount}</b></span>
  </div>
  <div class="strip-right" style="display:flex;gap:12px;align-items:center"><span class="stage-badge">${DATA.stage}</span><span>v4 · observatory · <b>${DATA.generatedAt}</b></span></div>
</div>

<div class="hero">
  <div class="hero-l">
    <div class="hero-eye">// pattern intelligence — observation log</div>
    <h1 class="hero-title">Where you <em>actually</em> walk.</h1>
    <p class="hero-sub">Continuous, silent telemetry on your Claude Code sessions. Tools fired, prompts repeated, sequences re-run — surfaced as candidate paths to pave.</p>
    <div class="hero-tags">
      <span class="tag">SIGNAL <b>${acceptRate>=50?'STRONG':acceptRate>=25?'OK':'WEAK'}</b></span>
      <span class="tag">PIPELINE <b>${workingPaths>0?'HEALTHY':'WARMING'}</b></span>
      ${DATA.deadCount>0?`<span class="tag">CLEANUP <b>${DATA.deadCount}</b></span>`:''}
    </div>
  </div>
  <div class="hero-r">
    <div class="hero-r-top">
      <div class="cell">
        <div class="cell-lbl">Sessions tracked</div>
        <div class="cell-n" id="big-total"></div>
        <div class="cell-sub" id="big-sub"></div>
      </div>
      <div class="cell">
        <div class="cell-lbl">Acceptance</div>
        <div class="cell-n signal" id="big-rate"></div>
        <div class="cell-sub" id="big-rate-sub"></div>
      </div>
    </div>
    <div class="hero-r-bot">
      <div class="cell-lbl">Last 14 days · sessions / day</div>
      <div class="hero-spark" id="hero-spark"></div>
      <div class="hero-spark-meta"><span>—14d</span><span>—7d</span><span>today</span></div>
    </div>
  </div>
</div>

<div class="funnel" id="funnel"></div>

<nav class="tabs">
  <button class="tab active" data-tab="overview">Overview</button>
  <button class="tab" data-tab="map">Map</button>
  <button class="tab" data-tab="signals">Signals</button>
  <button class="tab" data-tab="patterns">Patterns <span class="count" id="t-pat"></span></button>
  <button class="tab" data-tab="inventory">Inventory <span class="count" id="t-inv"></span></button>
</nav>

<div id="tab-overview"></div>
<div id="tab-map" style="display:none"></div>
<div id="tab-signals" style="display:none"></div>
<div id="tab-patterns" style="display:none"></div>
<div id="tab-inventory" style="display:none"></div>

<div class="foot">
  <span>desire-path · v4 · observatory</span>
  <em>detect · propose · pave · measure · clean</em>
  <span>generated ${DATA.generatedAt}</span>
</div>

</div>

<script>
const D = ${JSON.stringify(DATA, null, 2)};
const fmt = (iso)=>{
  if(!iso) return "—";
  const d = new Date(iso);
  const diff = Math.round((Date.now()-d.getTime())/86400000);
  if(diff===0) return "today";
  if(diff===1) return "1d";
  if(diff<30) return diff+"d";
  return Math.round(diff/7)+"w";
};
const TYPE_COLOR = {skill:'var(--signal)',hook:'var(--good)',agent:'#9a8db3',claude_md:'var(--signal-dim)',command:'var(--ink-2)',plugin:'var(--ink-2)'};
const typeCol = (t)=>TYPE_COLOR[t]||'var(--muted)';

document.getElementById("big-total").textContent = D.totalSessions;
document.getElementById("big-sub").textContent = D.archiveSessions+" arc · "+D.hotSessions+" hot";
document.getElementById("big-rate").textContent = D.pipeline.acceptRate+"%";
document.getElementById("big-rate-sub").textContent = D.pipeline.accepted+" of "+D.pipeline.proposed+" suggestions";

const maxA = Math.max(...D.activity, 1);
document.getElementById("hero-spark").innerHTML = D.activity.map(v=>{
  const isPeak = v===maxA && v>0;
  return \`<div class="col \${isPeak?'peak':''}" style="height:\${Math.max(2,Math.round(v/maxA*60))}px"></div>\`;
}).join("");

const fnData = [
  {n:D.pipeline.detected, lbl:"Detected", meta:"patterns observed", cls:""},
  {n:D.pipeline.proposed, lbl:"Proposed", meta:"surfaced to user", cls:""},
  {n:D.pipeline.paved,    lbl:"Paved",    meta:"written to disk", cls:"signal"},
  {n:D.pipeline.working,  lbl:"Walked",   meta:"used since paving", cls:"good"},
];
const fnMax = Math.max(...fnData.map(x=>x.n), 1);
document.getElementById("funnel").innerHTML = fnData.map((f,i)=>\`
  <div class="fn">
    <div class="fn-num \${f.cls}">\${String(f.n).padStart(2,"0")}</div>
    <div class="fn-lbl">\${f.lbl}</div>
    <div class="fn-meta">\${f.meta}</div>
    <div class="fn-bar" style="width:\${Math.round(f.n/fnMax*100)}%"></div>
    \${i<fnData.length-1?'<div class="fn-arrow">›</div>':''}
  </div>\`).join("");

document.getElementById("t-pat").textContent = String(D.patterns.length).padStart(2,"0");
document.getElementById("t-inv").textContent = String(D.inventory.length).padStart(2,"0");

document.querySelectorAll(".tab").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    ["overview","map","signals","patterns","inventory"].forEach(id=>{
      document.getElementById("tab-"+id).style.display = id===btn.dataset.tab?"block":"none";
    });
  });
});

function buildOverview(){
  const maxTool = D.tools[0]?.[1]||1;
  const maxSkill = D.skills[0]?.[1]||1;

  const barFill = (val,max)=>'<div class="bar-fill" style="width:'+Math.max(2,Math.round(val/max*100))+'%"></div>';

  const toolBars = D.tools.length ? D.tools.map(([n,v])=>\`
    <div class="bar-row">
      <span class="bar-name" title="\${n}">\${n}</span>
      <div class="bar-track">\${barFill(v,maxTool)}</div>
      <span class="bar-val">\${v}</span>
    </div>\`).join("") : '<div class="empty">No tool data yet.</div>';

  const skillBars = D.skills.length ? D.skills.map(([n,v])=>\`
    <div class="bar-row">
      <span class="bar-name" title="\${n}">\${n}</span>
      <div class="bar-track">\${barFill(v,maxSkill)}</div>
      <span class="bar-val">\${v}</span>
    </div>\`).join("") : '<div class="empty">No skill invocations yet.</div>';

  const maxCell = Math.max(...D.heatGrid.flat(), 1);
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const wkRows = D.heatGrid.map((row, di)=>{
    const cells = row.map((v,hi)=>{
      const op = v===0 ? 0.06 : Math.max(0.18, v/maxCell);
      const hr = String(hi).padStart(2,'0');
      return \`<div class="wk-cell" title="\${days[di]} \${hr}:00 — \${v} session\${v!==1?'s':''}" style="background:var(--signal);opacity:\${op.toFixed(2)}"></div>\`;
    }).join('');
    return \`<div class="wk-row"><div class="wk-label">\${days[di]}</div>\${cells}</div>\`;
  }).join('');
  const wkAxisLabels = [0,6,12,18,23].map(h=>\`<div class="wk-axis-lbl" style="grid-column:\${h+2}">\${String(h).padStart(2,'0')}</div>\`).join('');

  const trendCells = (uses)=>Array.from({length:8},(_,i)=>{
    const h = Math.max(20, Math.min(100, (uses*7+i*11)%100));
    return \`<div class="b \${i===7?'last':''}" style="height:\${h}%"></div>\`;
  }).join("");

  const pavedRows = D.paved.length ? D.paved.map(p=>\`
    <tr>
      <td><span class="dot-mini dm-\${p.type}"></span><span class="t-name">\${p.name}</span></td>
      <td><span class="t-type" style="color:\${typeCol(p.type)}">\${p.type}</span></td>
      <td class="r"><span class="trend">\${trendCells(p.uses)}</span></td>
      <td class="r"><span class="t-num \${p.uses?'':'zero'}">\${p.uses}</span></td>
      <td class="r"><span class="t-when">\${fmt(p.last_used)}</span></td>
      <td class="r"><span class="t-status \${p.working?'working':'growing'}">\${p.working?'walked':'overgrown'}</span></td>
    </tr>\`).join("") : '<tr><td colspan="6"><div class="empty">Nothing paved yet — say yes to a suggestion.</div></td></tr>';

  document.getElementById("tab-overview").innerHTML = \`
    <div class="grid-2" style="margin-bottom:16px">
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Tools · Top 8</div><div class="panel-meta">\${D.tools.reduce((a,b)=>a+b[1],0)} calls</div></div>
        <div class="bars">\${toolBars}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Skills · Top 6</div><div class="panel-meta">\${D.skills.reduce((a,b)=>a+b[1],0)} invocations</div></div>
        <div class="bars">\${skillBars}</div>
      </div>
    </div>
    <div class="panel" style="margin-bottom:16px">
      <div class="panel-head"><div class="panel-title">When you work · Weekday × Hour</div><div class="panel-meta">darker = more sessions</div></div>
      <div class="wk-heatmap">\${wkRows}</div>
      <div class="wk-axis"><div></div>\${wkAxisLabels}</div>
    </div>
    <div class="panel" style="padding:0">
      <div class="panel-head" style="padding:18px 20px">
        <div class="panel-title">Paved Paths · \${D.paved.length} total · \${D.pipeline.working} walking</div>
        <div class="panel-meta">sorted by usage</div>
      </div>
      <table class="tbl">
        <thead><tr><th>Name</th><th>Type</th><th class="r">Trend</th><th class="r">Uses</th><th class="r">Last</th><th class="r">Status</th></tr></thead>
        <tbody>\${pavedRows}</tbody>
      </table>
    </div>
  \`;
}

function buildMap(){
  const W = 1340, H = 720;
  const cx = W/2, cy = H/2 + 20;

  const TYPE_COLORS = {
    skill:'#d4a55a', hook:'#7fb285', agent:'#9a8db3',
    claude_md:'#c8a96a', command:'#a89776', plugin:'#bfb6a3'
  };

  // Combine paved + dead/stale inventory items so the map shows the full landscape.
  const paved = D.paved||[];
  const inv = D.inventory||[];
  const extraDead = inv.filter(a=>['dead','stale'].includes(a.status) && !paved.find(p=>p.name===a.name))
    .map(a=>({...a, uses:a.uses||0, last_used:a.last_used||a.last, working:false, _ghost:a.status}));
  const allArtifacts = [...paved, ...extraDead];

  // Detected-but-not-paved patterns become dashed "desire lines"
  let desireLines = (D.patterns||[]).filter(p=>{
    const n = p.suggested_artifact?.name || p.name;
    return !n || !allArtifacts.find(a=>a.name===n);
  }).slice(0,5);
  // Fallback: show accepted suggestions as desire lines when no analysis data yet
  if(desireLines.length===0){
    desireLines = (D.suggestions||[]).filter(s=>s.outcome==='accepted').slice(0,5).map(s=>({
      description: s.pattern?.description||'',
      type: s.pattern?.type||'skill',
      frequency: s.pattern?.frequency||1
    }));
  }

  // ── Layout: place artifacts in a sun/spoke pattern around center ──
  const N = allArtifacts.length;
  const positions = allArtifacts.map((a,i)=>{
    // Working items go closer in (well-trodden), dead/stale push out (overgrown edges)
    const ring = a._ghost==='dead' ? 0.92
               : a._ghost==='stale' ? 0.78
               : a.working ? 0.50 + Math.min(0.18, (a.uses||0)*0.015)
               : 0.62;
    const baseRadius = Math.min(W,H) * 0.42 * ring;
    // Spread evenly but jitter so it feels organic
    const golden = 2.39996;
    const angle = i * golden + (a.type==='skill'?0:a.type==='hook'?0.6:1.2);
    const jitter = (Math.sin(i*7.3)*0.5 + Math.cos(i*3.1)*0.3) * 30;
    return {
      x: cx + Math.cos(angle) * baseRadius + jitter,
      y: cy + Math.sin(angle) * baseRadius * 0.78 + Math.cos(i*1.7)*18,
      a, angle
    };
  });

  // Helper: bezier path from origin to a point with a hand-drawn wobble
  const trail = (x1,y1,x2,y2,wobble=1)=>{
    const mx=(x1+x2)/2, my=(y1+y2)/2;
    const dx=x2-x1, dy=y2-y1;
    const len=Math.hypot(dx,dy);
    const nx=-dy/len, ny=dx/len;
    const o1 = (Math.sin(x2*0.03)+Math.cos(y2*0.04))*40*wobble;
    const o2 = (Math.cos(x2*0.05)+Math.sin(y2*0.03))*30*wobble;
    const c1x = x1 + dx*0.32 + nx*o1;
    const c1y = y1 + dy*0.32 + ny*o1;
    const c2x = x1 + dx*0.68 + nx*o2;
    const c2y = y1 + dy*0.68 + ny*o2;
    return \`M \${x1.toFixed(1)} \${y1.toFixed(1)} C \${c1x.toFixed(1)} \${c1y.toFixed(1)}, \${c2x.toFixed(1)} \${c2y.toFixed(1)}, \${x2.toFixed(1)} \${y2.toFixed(1)}\`;
  };

  // ── Draw layered grass / topo background lines ──
  let topo = '';
  for(let r=80; r<Math.max(W,H)*0.7; r+=70){
    topo += \`<ellipse cx="\${cx}" cy="\${cy}" rx="\${r*1.05}" ry="\${r*0.78}" fill="none" stroke="oklch(0.30 0.04 100/.18)" stroke-width="0.6" stroke-dasharray="2 6" />\`;
  }

  // Background "scrub" — random tiny strokes suggesting grass/terrain
  let grass = '';
  for(let i=0;i<260;i++){
    const gx = (i*73 % W);
    const gy = (i*131 % H);
    // skip near center / paths
    const dc = Math.hypot(gx-cx, gy-cy);
    if(dc < 80) continue;
    const len = 2 + (i%4);
    const ang = (i*0.7) % (Math.PI*2);
    grass += \`<line x1="\${gx}" y1="\${gy}" x2="\${gx+Math.cos(ang)*len}" y2="\${gy+Math.sin(ang)*len}" stroke="oklch(0.42 0.06 110/.35)" stroke-width="0.6" />\`;
  }

  // ── Desire lines (detected but not paved) — dashed "where people walk in grass" ──
  let desire = '';
  desireLines.forEach((p,i)=>{
    const angle = (i / Math.max(1,desireLines.length)) * Math.PI*2 + 0.3;
    const r = Math.min(W,H) * 0.36;
    const ex = cx + Math.cos(angle)*r;
    const ey = cy + Math.sin(angle)*r*0.78;
    const path = trail(cx, cy, ex, ey, 1.4);
    const label = p.description || p.desc || p.suggested_artifact?.trigger || 'unnamed';
    const labelShort = label.length>32 ? label.slice(0,29)+'…' : label;
    desire += \`
      <path d="\${path}" fill="none" stroke="oklch(0.65 0.12 80/.55)" stroke-width="1.4" stroke-dasharray="3 7" stroke-linecap="round" />
      <circle cx="\${ex}" cy="\${ey}" r="3" fill="none" stroke="oklch(0.70 0.14 80)" stroke-width="1" stroke-dasharray="2 2" />
      <text x="\${ex + (Math.cos(angle)>0?10:-10)}" y="\${ey+3}" text-anchor="\${Math.cos(angle)>0?'start':'end'}" class="map-pin-label" style="fill:oklch(0.70 0.14 80);font-style:italic">⌁ \${labelShort}</text>
    \`;
  });

  // ── Paved trails (paths from origin to each artifact pin) ──
  let trails = '';
  positions.forEach(({x,y,a})=>{
    const uses = a.uses||0;
    const ghost = a._ghost;
    const path = trail(cx, cy, x, y, ghost?1.2:0.9);

    let stroke, width, opacity, dash='';
    if(ghost==='dead'){
      stroke = 'oklch(0.40 0.05 30)'; width = 1.2; opacity = 0.4; dash = 'stroke-dasharray="1 5"';
    } else if(ghost==='stale'){
      stroke = 'oklch(0.55 0.08 80)'; width = 1.6; opacity = 0.55; dash = 'stroke-dasharray="4 4"';
    } else if(a.working){
      // well-walked → wide, warm, solid (a real beaten path)
      const intensity = Math.min(1, uses/15);
      stroke = \`oklch(\${0.62 + intensity*0.10} \${0.10 + intensity*0.04} 75)\`;
      width = 3.5 + intensity*4;
      opacity = 0.85;
    } else {
      // paved but not walked yet → thin, pale
      stroke = 'oklch(0.55 0.04 90)'; width = 1.8; opacity = 0.55;
    }

    // Halo for the most-walked path
    if(a.working && uses >= 5){
      trails += \`<path d="\${path}" fill="none" stroke="oklch(0.70 0.14 75/.18)" stroke-width="\${width+8}" stroke-linecap="round" />\`;
    }
    trails += \`<path d="\${path}" fill="none" stroke="\${stroke}" stroke-width="\${width}" stroke-linecap="round" opacity="\${opacity}" \${dash} />\`;
  });

  // ── Pins for artifacts ──
  let pins = '';
  positions.forEach(({x,y,a,angle})=>{
    const color = TYPE_COLORS[a.type] || TYPE_COLORS.command;
    const uses = a.uses||0;
    const ghost = a._ghost;
    const r = ghost ? 4 : a.working ? 6 + Math.min(4, uses*0.3) : 5;

    // Label position — push outward from center
    const labelDist = r + 12;
    const lx = x + Math.cos(angle)*labelDist;
    const ly = y + Math.sin(angle)*labelDist;
    const anchor = Math.cos(angle) > 0.2 ? 'start' : Math.cos(angle) < -0.2 ? 'end' : 'middle';

    const nameShort = a.name.length>22 ? a.name.slice(0,20)+'…' : a.name;
    const nameStyle = ghost==='dead' ? \`text-decoration:line-through;fill:oklch(0.50 0.03 80)\` : '';

    // Outer glow for working artifacts
    if(a.working){
      pins += \`<circle cx="\${x}" cy="\${y}" r="\${r+5}" fill="\${color}" opacity="0.18" />\`;
    }
    // Pin body
    pins += \`<circle cx="\${x}" cy="\${y}" r="\${r}" fill="\${ghost?'none':color}" stroke="\${color}" stroke-width="\${ghost?1.4:1}" opacity="\${ghost==='dead'?0.5:1}" \${ghost==='dead'?'stroke-dasharray="2 2"':''} />\`;
    // Inner mark
    if(!ghost) pins += \`<circle cx="\${x}" cy="\${y}" r="\${Math.max(1.5,r*0.35)}" fill="oklch(0.13 0.02 90)" />\`;

    // Label
    pins += \`<text x="\${lx}" y="\${ly+3}" text-anchor="\${anchor}" class="map-pin-label" style="\${nameStyle}">\${nameShort}</text>\`;
    // Use count for working items
    if(a.working && uses>0){
      pins += \`<text x="\${lx}" y="\${ly+15}" text-anchor="\${anchor}" class="map-pin-uses">\${uses}×</text>\`;
    } else if(ghost==='dead'){
      pins += \`<text x="\${lx}" y="\${ly+14}" text-anchor="\${anchor}" class="map-pin-label" style="fill:oklch(0.55 0.10 30);font-style:italic">overgrown</text>\`;
    } else if(ghost==='stale'){
      pins += \`<text x="\${lx}" y="\${ly+14}" text-anchor="\${anchor}" class="map-pin-label" style="fill:oklch(0.65 0.08 80);font-style:italic">stale · \${a.age||0}d</text>\`;
    } else if(!a.working){
      pins += \`<text x="\${lx}" y="\${ly+14}" text-anchor="\${anchor}" class="map-pin-label" style="fill:var(--muted);font-style:italic">freshly paved</text>\`;
    }
  });

  // ── Origin marker (you / sessions) ──
  const totalSess = D.totalSessions;
  const origin = \`
    <circle cx="\${cx}" cy="\${cy}" r="38" fill="none" stroke="oklch(0.70 0.14 75/.25)" stroke-width="1" />
    <circle cx="\${cx}" cy="\${cy}" r="22" fill="none" stroke="oklch(0.70 0.14 75/.45)" stroke-width="1" />
    <circle cx="\${cx}" cy="\${cy}" r="10" fill="oklch(0.70 0.14 75)" />
    <circle cx="\${cx}" cy="\${cy}" r="4" fill="oklch(0.13 0.02 90)" />
    <text x="\${cx}" y="\${cy+58}" text-anchor="middle" class="map-origin-label">you · \${totalSess} sessions</text>
  \`;

  // ── Stats summary (bottom strip) ──
  const walked = paved.filter(p=>p.working).length;
  const overgrown = inv.filter(a=>a.status==='dead').length;
  const stale = inv.filter(a=>a.status==='stale').length;
  const desireCount = desireLines.length;

  document.getElementById("tab-map").innerHTML = \`
    <div class="map-wrap">
      <div class="map-cap">
        <div class="map-cap-title">An aerial view of how you actually work.</div>
        <div class="map-cap-sub">\${allArtifacts.length} artifacts · \${desireCount} desire lines</div>
      </div>
      <div style="position:relative">
        <svg class="map-svg" viewBox="0 0 \${W} \${H}" preserveAspectRatio="xMidYMid meet">
          <g opacity="0.6">\${topo}</g>
          <g>\${grass}</g>
          <g>\${desire}</g>
          <g>\${trails}</g>
          <g>\${origin}</g>
          <g>\${pins}</g>
        </svg>
        <div class="map-grain"></div>
        <div class="map-vignette"></div>
        <div class="map-compass">N</div>
        <div class="map-meta">scale · <b>\${totalSess} sess</b> · \${D.pipeline.acceptRate}% acc</div>
        <div class="map-legend">
          <div class="map-legend-title">Legend</div>
          <div class="map-legend-row"><span class="map-legend-swatch" style="background:oklch(0.72 0.14 75);height:4px"></span> walked path</div>
          <div class="map-legend-row"><span class="map-legend-swatch" style="background:oklch(0.55 0.04 90)"></span> freshly paved</div>
          <div class="map-legend-row"><span class="map-legend-swatch" style="background:oklch(0.55 0.08 80);background-image:linear-gradient(90deg,transparent 50%,oklch(0.55 0.08 80) 50%);background-size:8px 100%"></span> stale</div>
          <div class="map-legend-row"><span class="map-legend-swatch" style="background:oklch(0.65 0.12 80);background-image:linear-gradient(90deg,transparent 70%,oklch(0.65 0.12 80) 70%);background-size:10px 100%"></span> desire line — not yet paved</div>
          <div class="map-legend-row" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line)"><span class="map-legend-pin" style="background:#d4a55a"></span> skill</div>
          <div class="map-legend-row"><span class="map-legend-pin" style="background:#7fb285"></span> hook</div>
          <div class="map-legend-row"><span class="map-legend-pin" style="background:#9a8db3"></span> agent</div>
        </div>
      </div>
      <div class="map-key">
        <div class="map-key-cell">
          <div class="map-key-n good">\${walked}</div>
          <div class="map-key-lbl">Walked paths</div>
          <div class="map-key-meta">worn smooth by use</div>
        </div>
        <div class="map-key-cell">
          <div class="map-key-n signal">\${desireCount}</div>
          <div class="map-key-lbl">Desire lines</div>
          <div class="map-key-meta">where you're cutting through grass</div>
        </div>
        <div class="map-key-cell">
          <div class="map-key-n">\${stale}</div>
          <div class="map-key-lbl">Going stale</div>
          <div class="map-key-meta">paved but quiet</div>
        </div>
        <div class="map-key-cell">
          <div class="map-key-n warn">\${overgrown}</div>
          <div class="map-key-lbl">Overgrown</div>
          <div class="map-key-meta">never walked — reclaim</div>
        </div>
      </div>
    </div>
  \`;
}

function buildSignals(){
  const maxHour = Math.max(...D.hours,1);

  const heat = D.hours.map((v,i)=>{
    const peak = v>=maxHour*0.8 && v>0;
    const off = i<6||i>=22;
    const bg = peak?'var(--signal)':off?'oklch(0.45 0.03 240)':'var(--signal-dim)';
    const op = (v===0?(off?.06:.15):(off?Math.min(.35,.2+v/maxHour*.3):.4+v/maxHour*.6)).toFixed(2);
    const hr = String(i).padStart(2,'0');
    return \`<div class="h" title="\${v} session\${v!==1?'s':''} at \${hr}:00" style="height:\${Math.max(2,Math.round(v/maxHour*112))}px;background:\${bg};opacity:\${op}"></div>\`;
  }).join("");

  const isStopCmd = (c)=>/git (status|diff|log)|npm test|jest|pytest|make test|lint/.test(c);
  const isStartCmd = (c)=>/npm (install|run dev|start)|yarn (dev|start)|docker|brew/.test(c);
  const bashTag = (c)=>isStopCmd(c)?'Stop hook':isStartCmd(c)?'Start hook':'skill';
  const bashRows = D.bashCmds.length ? D.bashCmds.map(([cmd,n])=>\`
    <tr>
      <td><code class="t-name" style="font-size:11px">\${cmd.length>72?cmd.substring(0,69)+'…':cmd}</code></td>
      <td class="r"><span class="t-type" style="color:\${typeCol(bashTag(cmd)==='skill'?'skill':'hook')}">\${bashTag(cmd)}</span></td>
      <td class="r"><span class="t-num">\${n}</span> <span style="color:var(--muted);font-size:10px">sess</span></td>
    </tr>\`).join('') : '<tr><td colspan="3"><div class="empty">No repeated bash commands yet.</div></td></tr>';

  const deniedRows = D.deniedTools.length ? D.deniedTools.map(([tool,n])=>\`
    <tr>
      <td><span class="t-name">\${tool}</span></td>
      <td class="r"><span class="t-num" style="color:var(--warn)">\${n}</span> <span style="color:var(--muted);font-size:10px">denied</span></td>
    </tr>\`).join('') : '<tr><td colspan="2"><div class="empty">No denials recorded yet — data accumulates over sessions.</div></td></tr>';

  document.getElementById("tab-signals").innerHTML = \`
    <div class="grid-2" style="margin-bottom:16px">
      <div class="panel" style="padding:0">
        <div class="panel-head" style="padding:14px 20px">
          <div class="panel-title">Repeated Bash Commands · hook candidates</div>
          <div class="panel-meta">\${D.bashCmds.length} distinct commands · by session frequency</div>
        </div>
        <table class="tbl"><thead><tr><th>Command</th><th class="r">Candidate</th><th class="r">Sessions</th></tr></thead><tbody>\${bashRows}</tbody></table>
      </div>
      <div class="panel" style="padding:0">
        <div class="panel-head" style="padding:14px 20px">
          <div class="panel-title">Permission Denials · top blocked tools</div>
          <div class="panel-meta">\${D.deniedTools.reduce((a,b)=>a+b[1],0)} total · inferred from pre/post mismatch</div>
        </div>
        <table class="tbl"><thead><tr><th>Tool</th><th class="r">Count</th></tr></thead><tbody>\${deniedRows}</tbody></table>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><div class="panel-title">Hour-of-day distribution</div><div class="panel-meta">peak \${D.hours.indexOf(maxHour)}:00</div></div>
      <div class="heat-wide">\${heat}</div>
      <div class="heat-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
    </div>
  \`;
}

function buildPatterns(){
  const maxFreq = Math.max(...D.patterns.map(p=>p.frequency||p.freq||1),1);
  const pats = D.patterns.length ? D.patterns.map((p,i)=>\`
    <div class="pattern">
      <div class="p-rank">\${String(i+1).padStart(2,"0")}</div>
      <div>
        <div class="p-quote">\${p.description||p.desc||''}</div>
        <div class="p-meta">
          <span class="t-type" style="color:\${typeCol(p.type)}">\${p.type||'pattern'}</span>
          <span class="p-trigger">trigger · <b>\${p.suggested_artifact?.trigger||p.tag||'—'}</b></span>
        </div>
      </div>
      <div class="p-strength">
        <div class="p-strength-bar"><div class="fill" style="width:\${Math.round((p.frequency||p.freq||0)/maxFreq*100)}%"></div></div>
        <div class="p-strength-lbl">signal \${Math.round((p.frequency||p.freq||0)/maxFreq*100)}%</div>
      </div>
      <div class="p-freq">
        <div class="p-freq-n">\${p.frequency||p.freq||'?'}</div>
        <div class="p-freq-x">obs.</div>
      </div>
    </div>\`).join("") : '<div class="empty">Patterns emerge after 5+ sessions.</div>';

  const sugs = D.suggestions.length ? D.suggestions.slice().reverse().map(s=>\`
    <div class="log-row">
      <span class="log-time">\${(s.at||s.date||'').slice(0,10)}</span>
      <span class="log-dot" style="background:\${typeCol(s.pattern?.type||s.type)}"></span>
      <span class="log-msg">\${s.pattern?.description||s.pattern?.hint||s.desc||''}</span>
      <span class="log-type" style="color:\${typeCol(s.pattern?.type||s.type)}">\${s.pattern?.type||s.type||''}</span>
      <span class="log-out \${s.outcome}">\${s.outcome}</span>
    </div>\`).join("") : '<div class="empty">No suggestions made yet.</div>';

  document.getElementById("tab-patterns").innerHTML = \`
    <div class="panel-head" style="border:1px solid var(--line);background:var(--panel);padding:14px 20px;margin-bottom:8px">
      <div class="panel-title">Detected Patterns · ranked by frequency</div>
      <div class="panel-meta">\${D.patterns.length} active patterns · re-scanned every 5 sessions</div>
    </div>
    \${pats}
    <div class="panel-head" style="border:1px solid var(--line);background:var(--panel);padding:14px 20px;margin:24px 0 8px">
      <div class="panel-title">Suggestion Log · most recent first</div>
      <div class="panel-meta">\${D.suggestions.length} entries · \${D.pipeline.acceptRate}% acceptance</div>
    </div>
    <div class="log">\${sugs}</div>
  \`;
}

function buildInventory(){
  const inv = D.inventory||[];
  const counts = {
    total: inv.length,
    walked: inv.filter(a=>['active','growing'].includes(a.status)).length,
    stale:  inv.filter(a=>a.status==='stale').length,
    dead:   inv.filter(a=>a.status==='dead').length,
  };
  const pct = (n)=>counts.total?Math.round(n/counts.total*100)+"%":"—";

  const order = {active:0,growing:1,stale:2,dead:3};
  const sorted = [...inv].sort((a,b)=>(order[a.status]??9)-(order[b.status]??9) || (b.uses||0)-(a.uses||0));

  const shortName = (a)=>{
    if(a.type!=='hook') return a.name;
    const cmd = a.command||'';
    const tokens = cmd.split(' ');
    const pathToken = tokens.slice().reverse().find(t=>(t.startsWith('/')||t.startsWith('~/'))&&/[.][a-z]+$/.test(t.replace(/[;|&]/g,'')));
    const base = pathToken ? pathToken.split('/').pop().replace(/[;|&'"]/g,'') : tokens[0];
    return (a.event||'hook')+' → '+base;
  };
  let prevStatus = null;
  const rows = sorted.map(a=>{
    const isDead = a.status==='dead';
    const isStale = a.status==='stale';
    const sep = (prevStatus!==a.status) ? \`<tr><td colspan="6" style="padding:14px 10px 6px;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);border-bottom:none">— \${(a.status||'').toUpperCase()} —</td></tr>\` : '';
    prevStatus = a.status;
    return sep + \`
      <tr class="\${isDead?'dead':''}">
        <td><span class="dot-mini dm-\${a.type}"></span><span class="t-name" title="\${a.name}">\${shortName(a)}</span></td>
        <td><span class="t-type" style="color:\${typeCol(a.type)}">\${a.type}</span></td>
        <td><span class="t-type">\${a.scope||''}</span></td>
        <td class="r"><span class="t-num \${a.uses?'':'zero'}">\${a.uses||0}×</span></td>
        <td class="r"><span class="t-when">\${fmt(a.last_used||a.last)} · \${a.age||0}d old</span></td>
        <td class="r"><span class="row-act \${isDead?'remove':isStale?'review':''}">\${isDead?'remove':isStale?'review':'—'}</span></td>
      </tr>\`;
  }).join("");

  const banner = counts.dead>0 ? \`
    <div class="callout">
      <div class="callout-text"><b>\${counts.dead} artifact\${counts.dead>1?'s':''}</b> paved but never walked. Reclaim them.</div>
      <div class="callout-cmd">/desire-path:cleanup</div>
    </div>\` : '';

  const staleBanner = counts.stale>0 ? \`
    <div class="callout" style="border-color:var(--signal);background:oklch(0.20 0.05 75/.3)">
      <div class="callout-text"><b>\${counts.stale} skill\${counts.stale>1?'s':''}</b> not used in 30+ days. Still earning their keep?</div>
      <div class="callout-cmd">/desire-path:cleanup</div>
    </div>\` : '';

  const empty = !inv.length ? '<div class="empty" style="margin-top:16px">No artifacts indexed yet.</div>' : '';

  document.getElementById("tab-inventory").innerHTML = \`
    <div class="inv-summary">
      <div class="inv-cell"><div class="inv-cell-n">\${counts.total}</div><div class="inv-cell-lbl">Total artifacts</div><div class="inv-cell-pct">across \${new Set(inv.map(a=>a.scope)).size||0} scopes</div></div>
      <div class="inv-cell"><div class="inv-cell-n good">\${counts.walked}</div><div class="inv-cell-lbl">Walked</div><div class="inv-cell-pct">\${pct(counts.walked)} healthy</div></div>
      <div class="inv-cell"><div class="inv-cell-n signal">\${counts.stale}</div><div class="inv-cell-lbl">Stale</div><div class="inv-cell-pct">\${pct(counts.stale)} review</div></div>
      <div class="inv-cell"><div class="inv-cell-n warn">\${counts.dead}</div><div class="inv-cell-lbl">Dead</div><div class="inv-cell-pct">\${pct(counts.dead)} reclaim</div></div>
    </div>
    \${inv.length ? \`<div class="panel" style="padding:0"><table class="tbl inv-tbl"><thead><tr><th>Name</th><th>Type</th><th>Scope</th><th class="r">Uses</th><th class="r">Last · Age</th><th class="r">Action</th></tr></thead><tbody>\${rows}</tbody></table></div>\` : ''}
    \${empty}
    \${staleBanner}
    \${banner}
  \`;
}

buildOverview();
buildMap();
buildSignals();
buildPatterns();
buildInventory();
</script>
</body>
</html>`;

fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(OUT, html);
process.stdout.write('Dashboard → ' + OUT + '\\n');

const opener = process.platform==='darwin'?'open':process.platform==='win32'?'start':'xdg-open';
try { execSync(opener + ' "' + OUT + '"'); } catch {}
