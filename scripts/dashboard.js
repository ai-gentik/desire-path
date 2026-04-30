#!/usr/bin/env node
/**
 * desire-path: dashboard module — Observatory edition
 *
 * Exports computeData() which reads all data files and returns
 * a structured data object. Used by server.js to serve the /data endpoint.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execSync } = require('child_process');

const DIR = path.join(os.homedir(), '.claude', 'desire-path');

// ── Load data ─────────────────────────────────────────────────────────────────
function lines(file) {
  try { return fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)); }
  catch { return []; }
}
function json(file, fb) {
  try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return fb; }
}

function computeData() {

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

const allCommands = {};
sessions.forEach(s=>Object.entries(s.commands||{}).forEach(([c,n])=>{allCommands[c]=(allCommands[c]||0)+n;}));
const topCommands = Object.entries(allCommands).sort((a,b)=>b[1]-a[1]).slice(0,6);

const allAgents = {};
sessions.forEach(s=>Object.entries(s.agents||{}).forEach(([a,n])=>{allAgents[a]=(allAgents[a]||0)+n;}));
const topAgents = Object.entries(allAgents).sort((a,b)=>b[1]-a[1]).slice(0,6);

// Aggregate call edges: {from→to: {count, edge}}
const callEdges = {};
sessions.forEach(s=>(s.calls||[]).forEach(c=>{
  const key = `${c.from}→${c.to}`;
  if(!callEdges[key]) callEdges[key] = {from:c.from, to:c.to, edge:c.edge||'skill_agent', count:0};
  callEdges[key].count++;
}));
const topCallEdges = Object.values(callEdges).sort((a,b)=>b.count-a.count);

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

const acceptedSugsServer = suggestions.filter(s=>s.outcome==='accepted');
const acceptedDescsServer = new Set(acceptedSugsServer.map(s=>s.pattern?.description||s.desc||''));
const dismissedDescsServer = new Set(suggestions.filter(s=>s.outcome==='dismissed').map(s=>s.pattern?.description||s.desc||''));

// Resolution source of truth: _resolved flag written directly into latest-analysis.json by suggest skill.
// Description match kept as backward-compat fallback for suggestions logged before this fix.
const detectedPaths = (analysis?.top_paths||[]).map(p => {
  const desc = p.description||p.desc||'';
  return {
    ...p,
    _resolved: p._resolved === true || acceptedDescsServer.has(desc),
    _dismissed: p._dismissed === true || dismissedDescsServer.has(desc)
  };
});

const totalSuggestions = suggestions.length;
const accepted = acceptedSugsServer.length;
const acceptRate = totalSuggestions>0?Math.round(accepted/totalSuggestions*100):0;
const workingPaths = pavedEnriched.filter(p=>p.working).length;

const allSuggestions = [...suggestions];
if(lastSuggest?.pattern){
  const desc = lastSuggest.pattern.description;
  const alreadyLogged = suggestions.find(s=>s.pattern?.description===desc);
  const descAccepted = acceptedDescsServer.has(desc);
  if(!alreadyLogged && !descAccepted) allSuggestions.push({at:lastSuggest.at,pattern:lastSuggest.pattern,outcome:'pending'});
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
  commands: topCommands,
  agents: topAgents,
  callEdges: topCallEdges,
  bashCmds: topBashCmds,
  paved: pavedEnriched,
  patterns: detectedPaths,
  suggestions: dedupedSuggestions,
  inventory: inventory.artifacts||[],
  removals,
  deniedTools: topDenied,
  generatedAt: new Date().toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'}),
  pluginVersion: __dirname.match(/desire-path\/(\d+\.\d+\.\d+)\//)?.[1] || 'dev',
  pendingCount: dedupedSuggestions.filter(s=>s.outcome==='pending').length,
  deadCount: (inventory.artifacts||[]).filter(a=>a.status==='dead').length,
  staleCount: (inventory.artifacts||[]).filter(a=>a.status==='stale').length,
  stage,
};

return DATA;
}


module.exports = { computeData };

if (require.main === module) {
  process.stdout.write('dashboard.js is now a module — use server.js to serve\n');
}
