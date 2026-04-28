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

const usageByArtifact = {...usageTotals};
usageRaw.forEach(u=>{
  if(!u.artifact_name)return;
  if(!usageByArtifact[u.artifact_name])usageByArtifact[u.artifact_name]={total_uses:0,last_used:null};
  usageByArtifact[u.artifact_name].total_uses++;
  const cur = usageByArtifact[u.artifact_name].last_used;
  if(!cur||u.at>cur)usageByArtifact[u.artifact_name].last_used=u.at;
});

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
  const alreadyLogged = suggestions.find(s=>s.pattern?.description===desc);
  if(!alreadyLogged) allSuggestions.push({at:lastSuggest.at,pattern:lastSuggest.pattern,outcome:'pending'});
}

// ── Inject data into HTML ─────────────────────────────────────────────────────
const DATA = {
  totalSessions,
  archiveSessions: archive.total_sessions||0,
  hotSessions: sessions.length,
  pipeline: {
    detected: detectedPaths.length||0,
    proposed: allSuggestions.length,
    accepted,
    acceptRate,
    paved: paved.length,
    working: workingPaths,
  },
  activity: Object.values(dayMap),
  activityDates: Object.keys(dayMap),
  hours: hourMap,
  tools: topTools,
  skills: topSkills,
  paved: pavedEnriched,
  patterns: detectedPaths,
  suggestions: allSuggestions,
  inventory: inventory.artifacts||[],
  removals,
  generatedAt: new Date().toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'}),
  pendingCount: allSuggestions.filter(s=>s.outcome==='pending').length,
  deadCount: (inventory.artifacts||[]).filter(a=>a.status==='dead').length,
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
.bar-row{display:grid;grid-template-columns:88px 1fr 36px;gap:10px;align-items:center}
.bar-name{font-size:11px;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}
.bar-track{height:14px;position:relative;border-bottom:1px solid var(--line)}
.bar-track-inner{position:absolute;inset:auto 0 0 0;height:6px;display:flex;gap:1px;align-items:flex-end}
.bar-cell{flex:1;background:var(--ink-2);opacity:.3}
.bar-cell.on{background:var(--signal);opacity:1}
.bar-val{font-size:11px;color:var(--ink);text-align:right;font-variant-numeric:tabular-nums}

.spark-big{display:flex;align-items:flex-end;gap:3px;height:120px;padding-top:8px}
.spark-big .col{flex:1;background:var(--ink-2);position:relative;min-height:2px}
.spark-big .col.peak{background:var(--signal)}
.spark-big .col .lbl{position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);font-size:9px;color:var(--faint);white-space:nowrap}
.heat-wide{display:grid;grid-template-columns:repeat(24,1fr);gap:1px;height:120px;align-items:end}
.heat-wide .h{background:var(--signal-dim);min-height:1px}
.heat-wide .h.peak{background:var(--signal)}
.heat-axis{display:flex;justify-content:space-between;margin-top:8px;font-size:9px;color:var(--faint);letter-spacing:.08em}

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
  </div>
  <div class="strip-right">v4 · observatory · <b>${DATA.generatedAt}</b></div>
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
  <button class="tab" data-tab="patterns">Patterns <span class="count" id="t-pat"></span></button>
  <button class="tab" data-tab="inventory">Inventory <span class="count" id="t-inv"></span></button>
</nav>

<div id="tab-overview"></div>
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
    ["overview","patterns","inventory"].forEach(id=>{
      document.getElementById("tab-"+id).style.display = id===btn.dataset.tab?"block":"none";
    });
  });
});

function buildOverview(){
  const maxTool = D.tools[0]?.[1]||1;
  const maxSkill = D.skills[0]?.[1]||1;
  const maxDay = Math.max(...D.activity,1);
  const maxHour = Math.max(...D.hours,1);

  const cellsForVal = (val,max)=>{
    const segs = 24;
    const filled = Math.round(val/max*segs);
    return Array.from({length:segs},(_,i)=>\`<div class="bar-cell \${i<filled?'on':''}"></div>\`).join("");
  };

  const toolBars = D.tools.length ? D.tools.map(([n,v])=>\`
    <div class="bar-row">
      <span class="bar-name">\${n}</span>
      <div class="bar-track"><div class="bar-track-inner">\${cellsForVal(v,maxTool)}</div></div>
      <span class="bar-val">\${v}</span>
    </div>\`).join("") : '<div class="empty">No tool data yet.</div>';

  const skillBars = D.skills.length ? D.skills.map(([n,v])=>\`
    <div class="bar-row">
      <span class="bar-name">\${n}</span>
      <div class="bar-track"><div class="bar-track-inner">\${cellsForVal(v,maxSkill)}</div></div>
      <span class="bar-val">\${v}</span>
    </div>\`).join("") : '<div class="empty">No skill invocations yet.</div>';

  const heat = D.hours.map((v,i)=>{
    const peak = v>=maxHour*0.8 && v>0;
    const off = i<6||i>=22;
    const bg = peak?'var(--signal)':off?'oklch(0.45 0.03 240)':'var(--signal-dim)';
    const op = (v===0?(off?.06:.15):(off?Math.min(.35,.2+v/maxHour*.3):.4+v/maxHour*.6)).toFixed(2);
    const hr = String(i).padStart(2,'0');
    return \`<div class="h" title="\${v} session\${v!==1?'s':''} at \${hr}:00" style="height:\${Math.max(2,Math.round(v/maxHour*112))}px;background:\${bg};opacity:\${op}"></div>\`;
  }).join("");

  const dayLabels = D.activityDates.map((d,i)=>{
    const dt = new Date(d);
    return (i%2===0)?dt.getDate():"";
  });
  const bigSpark = D.activity.map((v,i)=>{
    const isPeak = v===maxDay && v>0;
    return \`<div class="col \${isPeak?'peak':''}" title="\${D.activityDates[i]}: \${v} session\${v!==1?'s':''}" style="height:\${Math.max(2,Math.round(v/maxDay*112))}px">\${dayLabels[i]?\`<span class="lbl">\${dayLabels[i]}</span>\`:""}</div>\`;
  }).join("");

  const trendCells = (uses)=>Array.from({length:8},(_,i)=>{
    const h = Math.max(20, Math.min(100, (uses*7+i*11)%100));
    return \`<div class="b \${i===7?'last':''}" style="height:\${h}%"></div>\`;
  }).join("");

  const pavedRows = D.paved.length ? D.paved.map(p=>\`
    <tr>
      <td><span class="dot-mini dm-\${p.type}"></span><span class="t-name">\${p.name}</span></td>
      <td><span class="t-type">\${p.type}</span></td>
      <td class="r"><span class="trend">\${trendCells(p.uses)}</span></td>
      <td class="r"><span class="t-num \${p.uses?'':'zero'}">\${p.uses}</span></td>
      <td class="r"><span class="t-when">\${fmt(p.last_used)}</span></td>
      <td class="r"><span class="t-status \${p.working?'working':'growing'}">\${p.working?'walked':'overgrown'}</span></td>
    </tr>\`).join("") : '<tr><td colspan="6"><div class="empty">Nothing paved yet — say yes to a suggestion.</div></td></tr>';

  document.getElementById("tab-overview").innerHTML = \`
    <div class="grid-2">
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Tools · Top 8</div><div class="panel-meta">\${D.tools.reduce((a,b)=>a+b[1],0)} calls</div></div>
        <div class="bars">\${toolBars}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Skills · Top 6</div><div class="panel-meta">\${D.skills.reduce((a,b)=>a+b[1],0)} invocations</div></div>
        <div class="bars">\${skillBars}</div>
      </div>
    </div>
    <div class="grid-2">
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Activity · 14d</div><div class="panel-meta">\${D.activity.reduce((a,b)=>a+b,0)} sessions · peak \${maxDay}</div></div>
        <div class="spark-big">\${bigSpark}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><div class="panel-title">Hour-of-day distribution</div><div class="panel-meta">peak \${D.hours.indexOf(maxHour)}:00</div></div>
        <div class="heat-wide">\${heat}</div>
        <div class="heat-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
      </div>
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

function buildPatterns(){
  const maxFreq = Math.max(...D.patterns.map(p=>p.frequency||p.freq||1),1);
  const pats = D.patterns.length ? D.patterns.map((p,i)=>\`
    <div class="pattern">
      <div class="p-rank">\${String(i+1).padStart(2,"0")}</div>
      <div>
        <div class="p-quote">\${p.description||p.desc||''}</div>
        <div class="p-meta">
          <span class="p-tag">\${p.type||'pattern'}</span>
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

  const dotColor = (t)=>({skill:'var(--signal)',hook:'var(--good)',agent:'#9a8db3',claude_md:'var(--signal-dim)',command:'var(--muted)',plugin:'var(--ink-2)'})[t]||'var(--muted)';

  const sugs = D.suggestions.length ? D.suggestions.slice().reverse().map(s=>\`
    <div class="log-row">
      <span class="log-time">\${(s.at||s.date||'').slice(0,10)}</span>
      <span class="log-dot" style="background:\${dotColor(s.pattern?.type||s.type)}"></span>
      <span class="log-msg">\${s.pattern?.description||s.pattern?.hint||s.desc||''}</span>
      <span class="log-type">\${s.pattern?.type||s.type||''}</span>
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

  const typeColor = {skill:'var(--signal)',hook:'var(--good)',agent:'#9a8db3',claude_md:'var(--signal-dim)',command:'var(--ink-2)',plugin:'var(--ink-2)'};
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
        <td><span class="t-type" style="color:\${typeColor[a.type]||'var(--muted)'}">\${a.type}</span></td>
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
    \${banner}
  \`;
}

buildOverview();
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
