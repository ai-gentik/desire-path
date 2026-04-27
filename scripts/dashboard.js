#!/usr/bin/env node
/**
 * desire-path: dashboard generator v3
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

// Merge last suggestion into suggestions list if not already there
const allSuggestions = [...suggestions];
if(lastSuggest?.pattern && !suggestions.find(s=>s.at===lastSuggest.at)){
  allSuggestions.push({at:lastSuggest.at,pattern:lastSuggest.pattern,outcome:'pending'});
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
  generatedAt: new Date().toLocaleString('nl-NL',{dateStyle:'medium',timeStyle:'short'}),
};

// ── HTML (self-contained, vanilla JS) ─────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Desire Path</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=DM+Mono:wght@300;400;500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#f6f2ec;--ink:#1c1814;--muted:#9a9088;--faint:#b0a898;
  --line:#ddd8d0;--soft:#ede7de;--white:#ffffff;
  --green:#2a6644;--green-bg:#edf5f0;--green-text:#2a5c40;
  --blue:#3a5f8a;--blue-bg:#edf2f8;--blue-text:#2a4a70;
  --amber:#8a6a2a;--amber-bg:#f8f2e8;--amber-text:#6a4e1a;
  --purple:#6a4a8a;--purple-bg:#f2edf8;--purple-text:#52367a;
  --red:#8a2a2a;--red-bg:#faf0f0;--red-line:#e8c8c8;
  --teal:#3a6a6a;--teal-bg:#edf5f5;--teal-text:#2a5050;
  --slate:#6a5a3a;--slate-bg:#f5f0e8;--slate-text:#4a3e28;
}
body{background:var(--bg);color:var(--ink);font-family:'EB Garamond','Georgia',serif;font-size:15px;line-height:1.5}
button{font-family:inherit;cursor:pointer;background:none;border:none;outline:none}
.wrap{max-width:680px;margin:0 auto;padding:40px 20px 72px}

/* Header */
.hdr{margin-bottom:28px}
.hdr-eyebrow{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-family:'DM Mono',monospace;margin-bottom:6px}
.hdr-row{display:flex;justify-content:space-between;align-items:flex-end}
.hdr-title{font-size:32px;font-weight:500;font-style:italic;letter-spacing:-.01em;line-height:1.1}
.hdr-count{text-align:right}
.hdr-n{font-size:36px;font-family:'DM Mono',monospace;font-weight:400;line-height:1}
.hdr-sub{font-size:10px;color:var(--muted);font-family:'DM Mono',monospace;margin-top:3px;line-height:1.5}

/* Pipeline */
.pipeline{display:grid;grid-template-columns:1fr 1fr 1fr;border:1px solid var(--line);border-radius:6px;overflow:hidden;margin-bottom:24px}
.pipeline-cell{padding:16px;border-right:1px solid var(--line)}
.pipeline-cell:last-child{border-right:none;background:var(--green-bg)}
.pipeline-n{font-size:30px;font-family:'DM Mono',monospace;font-weight:400;line-height:1;margin-bottom:5px}
.pipeline-label{font-size:12px;color:var(--ink);margin-bottom:2px}
.pipeline-note{font-size:10px;color:var(--muted);font-family:'DM Mono',monospace}

/* Tabs */
.tabs{display:flex;border-bottom:1px solid var(--line);margin-bottom:24px}
.tab{font-size:12px;padding:8px 14px 10px;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .1s;letter-spacing:.02em}
.tab.active{color:var(--ink);border-bottom-color:var(--ink)}

/* Section label */
.sec{font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-family:'DM Mono',monospace;font-weight:500;margin-bottom:12px}
.rule{height:1px;background:var(--soft);margin:24px 0}

/* Bar chart */
.bars{display:flex;flex-direction:column;gap:8px}
.bar-row{display:flex;align-items:center;gap:8px}
.bar-name{text-align:right;font-size:11px;color:var(--muted);font-family:'DM Mono',monospace;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar-track{flex:1;height:3px;background:var(--soft);border-radius:2px}
.bar-fill{height:100%;border-radius:2px}
.bar-val{font-size:11px;color:var(--muted);font-family:'DM Mono',monospace;flex-shrink:0;text-align:right}

/* Charts */
.charts{display:grid;grid-template-columns:3fr 2fr;gap:20px;margin-bottom:24px}
.sparkline{display:flex;align-items:flex-end;gap:3px;height:40px}
.spark-bar{flex:1;border-radius:1px 1px 0 0;background:var(--blue)}
.heatmap{display:grid;grid-template-columns:repeat(12,1fr);gap:2px;height:40px;align-items:end}
.heat-bar{border-radius:1px 1px 0 0;background:var(--green)}
.chart-labels{display:flex;justify-content:space-between;margin-top:5px;font-size:10px;color:var(--faint);font-family:'DM Mono',monospace}

/* Paved table */
.paved-row{display:grid;grid-template-columns:1fr auto;gap:10px;padding:10px 0;border-bottom:1px solid var(--soft);align-items:center}
.paved-row:last-child{border-bottom:none}
.paved-left{display:flex;align-items:center;gap:8px;min-width:0}
.paved-name{font-size:13px;font-family:'DM Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.paved-right{display:flex;align-items:center;gap:10px;flex-shrink:0}
.paved-uses{font-size:13px;font-family:'DM Mono',monospace;font-weight:500;min-width:24px;text-align:right}
.paved-last{font-size:11px;color:var(--muted);font-family:'DM Mono',monospace;min-width:52px}
.paved-status{font-size:11px;font-family:'DM Mono',monospace;min-width:56px;text-align:right}

/* Patterns */
.pattern-row{display:grid;grid-template-columns:32px 1fr 36px;gap:14px;padding:14px 0;border-bottom:1px solid var(--soft);align-items:start}
.pattern-row:last-child{border-bottom:none}
.pattern-rank{font-size:10px;color:var(--faint);font-family:'DM Mono',monospace;padding-top:2px}
.pattern-desc{font-size:14px;line-height:1.45;margin-bottom:7px}
.pattern-freq{text-align:right}
.pattern-freq-n{font-size:20px;font-family:'DM Mono',monospace;line-height:1}
.pattern-freq-x{font-size:9px;color:var(--muted);font-family:'DM Mono',monospace}

/* Suggestion rows */
.sug-row{display:grid;grid-template-columns:52px 1fr 64px;gap:10px;padding:10px 0;align-items:center;border-bottom:1px solid var(--soft)}
.sug-row:last-child{border-bottom:none}
.sug-date{font-size:11px;color:var(--muted);font-family:'DM Mono',monospace}
.sug-mid{display:flex;align-items:center;gap:8px;min-width:0}
.sug-desc{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sug-status{font-size:10px;font-family:'DM Mono',monospace;text-align:right}

/* Inventory */
.inv-pills{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}
.inv-pill{display:flex;align-items:baseline;gap:5px;padding:6px 12px;background:var(--white);border:1px solid var(--line);border-radius:4px}
.inv-pill-n{font-size:20px;font-family:'DM Mono',monospace;line-height:1;font-weight:400}
.inv-pill-lbl{font-size:10px;letter-spacing:.1em;text-transform:uppercase;font-family:'DM Mono',monospace}
.inv-item{padding:10px 0;border-bottom:1px solid var(--soft)}
.inv-item:last-child{border-bottom:none}
.inv-row1{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px}
.inv-name-wrap{display:flex;align-items:center;gap:8px;min-width:0}
.inv-name{font-size:13px;font-family:'DM Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.inv-action{font-size:10px;letter-spacing:.06em;font-family:'DM Mono',monospace;flex-shrink:0}
.inv-uses{font-size:13px;font-family:'DM Mono',monospace;font-weight:500;flex-shrink:0;min-width:28px;text-align:right}
.inv-row2{display:flex;align-items:center;gap:8px;padding-left:14px;flex-wrap:wrap}
.inv-meta{font-size:10px;color:var(--faint);font-family:'DM Mono',monospace}
.dead-banner{margin-top:20px;padding:14px 16px;background:var(--red-bg);border:1px solid var(--red-line);border-radius:4px}
.dead-banner-text{font-size:13px;color:var(--red)}
.dead-banner-cmd{font-size:12px;color:var(--muted);font-family:'DM Mono',monospace;margin-left:8px}

/* Pills / dots */
.dot{display:inline-block;border-radius:50%;flex-shrink:0}
.pill{font-size:10px;letter-spacing:.06em;padding:2px 7px;border-radius:3px;font-family:'DM Mono',monospace;white-space:nowrap;line-height:16px;display:inline-block}

/* Footer */
.footer{margin-top:48px;padding-top:16px;border-top:1px solid var(--soft);display:flex;justify-content:space-between;align-items:center}
.footer-txt{font-size:10px;color:var(--faint);font-family:'DM Mono',monospace}
.footer-mid{font-size:10px;color:var(--faint);font-style:italic}
</style>
</head>
<body>
<div class="wrap">

<div class="hdr">
  <div class="hdr-eyebrow">desire-path · claude code</div>
  <div class="hdr-row">
    <h1 class="hdr-title">Pattern<br>Intelligence</h1>
    <div class="hdr-count">
      <div class="hdr-n" id="total-n"></div>
      <div class="hdr-sub" id="total-sub"></div>
    </div>
  </div>
</div>

<div class="pipeline" id="pipeline"></div>

<div class="tabs">
  <button class="tab active" data-tab="overview">Overview</button>
  <button class="tab" data-tab="patterns">Patterns</button>
  <button class="tab" data-tab="inventory" id="inv-tab">Inventory</button>
</div>

<div id="tab-overview"></div>
<div id="tab-patterns" style="display:none"></div>
<div id="tab-inventory" style="display:none"></div>

<div class="footer">
  <span class="footer-txt">desire-path v3</span>
  <span class="footer-mid">detect · propose · pave · measure · clean</span>
  <span class="footer-txt" id="gen-at"></span>
</div>

</div>

<script>
const D = ${JSON.stringify(DATA, null, 2)};

// ── Type config ───────────────────────────────────────────────────────────────
const TC = {
  skill:     {dot:"#3d7a5c",bg:"#edf5f0",text:"#2a5c40"},
  hook:      {dot:"#3a5f8a",bg:"#edf2f8",text:"#2a4a70"},
  agent:     {dot:"#6a4a8a",bg:"#f2edf8",text:"#52367a"},
  claude_md: {dot:"#8a6a2a",bg:"#f8f2e8",text:"#6a4e1a"},
  command:   {dot:"#6a5a3a",bg:"#f5f0e8",text:"#4a3e28"},
  plugin:    {dot:"#3a6a6a",bg:"#edf5f5",text:"#2a5050"},
};
const SC = {active:"#2a6644",working:"#2a6644",growing:"#7a5a1a",stale:"#7a5a1a",dead:"#8a2a2a"};
const SO = {dead:0,stale:1,growing:2,active:3};

function dot(type, size=7) {
  const c = TC[type]||TC.command;
  return \`<span class="dot" style="width:\${size}px;height:\${size}px;background:\${c.dot}"></span>\`;
}
function pill(type) {
  const c = TC[type]||TC.command;
  return \`<span class="pill" style="background:\${c.bg};color:\${c.text}">\${type}</span>\`;
}
function fmt(iso) {
  if(!iso||iso==='—') return '—';
  const d = new Date(iso);
  const diff = Math.round((Date.now()-d.getTime())/86400000);
  if(diff===0) return 'vandaag';
  if(diff===1) return 'gisteren';
  if(diff<7)   return diff+'d ago';
  return d.toLocaleDateString('nl-NL',{day:'numeric',month:'short'});
}

// ── Header ────────────────────────────────────────────────────────────────────
document.getElementById('total-n').textContent = D.totalSessions;
document.getElementById('total-sub').innerHTML = 'sessions<br>'+D.archiveSessions+' arc · '+D.hotSessions+' hot';
document.getElementById('gen-at').textContent = D.generatedAt;

// ── Pipeline ──────────────────────────────────────────────────────────────────
const pipeData = [
  {n: D.pipeline.detected||'—', label:'detected',  note:'patterns',         color:'#3a5f8a'},
  {n: D.pipeline.proposed,      label:'proposed',  note:D.pipeline.acceptRate+'% accepted', color:'#8a6a2a'},
  {n: D.pipeline.working+'/'+D.pipeline.paved, label:'working', note:'paths', color:'#2a6644'},
];
document.getElementById('pipeline').innerHTML = pipeData.map(p=>\`
  <div class="pipeline-cell">
    <div class="pipeline-n" style="color:\${p.color}">\${p.n}</div>
    <div class="pipeline-label">\${p.label}</div>
    <div class="pipeline-note">\${p.note}</div>
  </div>\`).join('');

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    ['overview','patterns','inventory'].forEach(id=>{
      document.getElementById('tab-'+id).style.display = id===btn.dataset.tab?'block':'none';
    });
  });
});

// Dead badge on Inventory tab
const deadCount = (D.inventory||[]).filter(a=>a.status==='dead').length;
if(deadCount>0) document.getElementById('inv-tab').textContent = 'Inventory ('+deadCount+')';

// ── Overview ──────────────────────────────────────────────────────────────────
function buildOverview() {
  const maxTool  = D.tools[0]?.[1]||1;
  const maxSkill = D.skills[0]?.[1]||1;
  const maxDay   = Math.max(...D.activity,1);
  const maxHour  = Math.max(...D.hours.slice(6,18),1);

  const toolBars = D.tools.map(([name,n])=>\`
    <div class="bar-row">
      <span class="bar-name" style="width:56px">\${name}</span>
      <div class="bar-track"><div class="bar-fill" style="width:\${Math.round(n/maxTool*100)}%;background:#3a5f8a"></div></div>
      <span class="bar-val" style="width:28px">\${n}</span>
    </div>\`).join('');

  const skillBars = D.skills.map(([name,n])=>\`
    <div class="bar-row">
      <span class="bar-name" style="width:80px">\${name}</span>
      <div class="bar-track"><div class="bar-fill" style="width:\${Math.round(n/maxSkill*100)}%;background:#3d7a5c"></div></div>
      <span class="bar-val" style="width:20px">\${n}</span>
    </div>\`).join('');

  const sparks = D.activity.map(v=>\`
    <div class="spark-bar" style="height:\${Math.max(2,Math.round(v/maxDay*36))}px;opacity:\${.15+v/maxDay*.7}"></div>\`).join('');

  const heats = D.hours.slice(6,18).map(v=>\`
    <div class="heat-bar" style="height:\${Math.max(2,Math.round(v/maxHour*36))}px;opacity:\${.12+v/maxHour*.7}"></div>\`).join('');

  const pavedRows = D.paved.length ? D.paved.map(p=>\`
    <div class="paved-row">
      <div class="paved-left">
        \${dot(p.type)}\${pill(p.type)}
        <span class="paved-name">/\${p.name}</span>
      </div>
      <div class="paved-right">
        <span class="paved-uses" style="color:\${p.uses>0?'#1c1814':'#c0b4a8'}">\${p.uses}</span>
        <span class="paved-last">\${fmt(p.last_used||p.last)}</span>
        <span class="paved-status" style="color:\${p.working?'#2a6644':'#7a5a1a'}">\${p.working?'✓ working':'growing'}</span>
      </div>
    </div>\`).join('')
  : '<div style="color:#9a9088;font-size:13px;padding:16px 0">Nothing paved yet — say yes to a suggestion.</div>';

  document.getElementById('tab-overview').innerHTML = \`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px">
      <div><div class="sec">Tools</div><div class="bars">\${toolBars}</div></div>
      <div><div class="sec">Skills</div><div class="bars">\${skillBars}</div></div>
    </div>
    <div class="rule"></div>
    <div class="sec">Activity</div>
    <div class="charts">
      <div>
        <div class="sparkline">\${sparks}</div>
        <div class="chart-labels"><span>\${D.activityDates[0]||''}</span><span>vandaag</span></div>
      </div>
      <div>
        <div class="heatmap">\${heats}</div>
        <div class="chart-labels"><span>6h</span><span>18h</span></div>
      </div>
    </div>
    <div class="rule"></div>
    <div class="sec">Paved Paths</div>
    \${pavedRows}
  \`;
}

// ── Patterns ──────────────────────────────────────────────────────────────────
function buildPatterns() {
  const patRows = D.patterns.length ? D.patterns.map((p,i)=>\`
    <div class="pattern-row">
      <span class="pattern-rank">\${String(i+1).padStart(2,'0')}</span>
      <div>
        <div class="pattern-desc">\${p.description||p.desc||''}</div>
        <div style="display:flex;align-items:center;gap:8px">
          \${pill(p.type)}
          <span style="font-size:10px;color:#9a9088">\${p.suggested_artifact?.trigger||p.tag||''}</span>
        </div>
      </div>
      <div class="pattern-freq">
        <div class="pattern-freq-n" style="color:\${TC[p.type]?.dot||'#666'}">\${p.frequency||p.freq||'?'}</div>
        <div class="pattern-freq-x">obs.</div>
      </div>
    </div>\`).join('')
  : '<div style="color:#9a9088;font-size:13px;padding:16px 0">Patterns emerge after 5+ sessions.</div>';

  const sugRows = D.suggestions.length ? D.suggestions.slice().reverse().map(s=>\`
    <div class="sug-row">
      <span class="sug-date">\${(s.at||s.date||'').slice(5,10).replace('-',' ')}</span>
      <div class="sug-mid">
        \${dot(s.pattern?.type||s.type,6)}
        <span class="sug-desc">\${s.pattern?.description||s.pattern?.hint||s.desc||''}</span>
      </div>
      <span class="sug-status" style="color:\${s.outcome==='accepted'?'#2a6644':'#8a6a2a'}">\${s.outcome}</span>
    </div>\`).join('')
  : '<div style="color:#9a9088;font-size:13px;padding:16px 0">No suggestions made yet.</div>';

  document.getElementById('tab-patterns').innerHTML = \`
    <div class="sec">Detected — \${D.patterns.length} patterns</div>
    \${patRows}
    <div class="rule"></div>
    <div class="sec">Proposed — \${D.suggestions.length} suggestions</div>
    \${sugRows}
  \`;
}

// ── Inventory ─────────────────────────────────────────────────────────────────
function buildInventory() {
  const inv = D.inventory||[];
  const counts = {
    total: inv.length,
    active: inv.filter(a=>['active','growing'].includes(a.status)).length,
    stale: inv.filter(a=>a.status==='stale').length,
    dead: inv.filter(a=>a.status==='dead').length,
  };
  const pillColors = {total:'#9a9088',active:'#2a6644',stale:'#7a5a1a',dead:'#8a2a2a'};

  const pills = Object.entries(counts).map(([k,n])\`
    <div class="inv-pill">
      <span class="inv-pill-n" style="color:\${pillColors[k]||'#9a9088'}">\${n}</span>
      <span class="inv-pill-lbl" style="color:\${pillColors[k]||'#9a9088'}">\${k}</span>
    </div>\`).join('');

  const sorted = [...inv].sort((a,b)=>(SO[a.status]??4)-(SO[b.status]??4));
  let prevStatus = null;
  const rows = sorted.map(a=>{
    const isDead  = a.status==='dead';
    const isStale = a.status==='stale';
    const sep = prevStatus && prevStatus!==a.status ? '<div style="height:1px;background:#ddd8d0;margin:3px 0"></div>' : '';
    prevStatus = a.status;
    return sep + \`
    <div class="inv-item" style="opacity:\${isDead?.5:1}">
      <div class="inv-row1">
        <div class="inv-name-wrap">
          \${dot(a.type,7)}
          <span class="inv-name" style="text-decoration:\${isDead?'line-through':'none'};text-decoration-color:#9a9088">\${a.name}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
          <span class="inv-uses" style="color:\${a.uses>0?'#1c1814':'#c0b4a8'}">\${a.uses}×</span>
          \${isDead?'<span class="inv-action" style="color:#8a2a2a">remove</span>':''}
          \${isStale?'<span class="inv-action" style="color:#7a5a1a">review</span>':''}
        </div>
      </div>
      <div class="inv-row2">
        \${pill(a.type)}
        <span class="inv-meta">\${a.scope}</span>
        <span class="inv-meta">last \${fmt(a.last_used||a.last||null)}</span>
        <span class="inv-meta">\${a.age}d old</span>
      </div>
    </div>\`;
  }).join('');

  const banner = counts.dead>0 ? \`
    <div class="dead-banner">
      <span class="dead-banner-text">\${counts.dead} artifact\${counts.dead>1?'s':''} never used</span>
      <span class="dead-banner-cmd">→ /desire-path:cleanup</span>
    </div>\` : '';

  document.getElementById('tab-inventory').innerHTML = \`
    <div class="inv-pills">\${pills}</div>
    \${rows}
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
process.stdout.write('Dashboard → ' + OUT + '\n');

const opener = process.platform==='darwin'?'open':process.platform==='win32'?'start':'xdg-open';
try { execSync(opener + ' "' + OUT + '"'); } catch {}
