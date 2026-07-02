'use strict';
// ════════════════════════════════════════════════════════════════════════
// ASPEN WAREHOUSE v5.01 — DEEP TRAIL / PROVENANCE SIMULATION
// Focused on the marriage provenance-trail area. Extracts the REAL functions
// from index.html and hammers them:
//   _trailNow, _trailRoleLabel, mTrail, backfillMarriageTrails,
//   marriageDispatchMode, dispModeMeta (+DISPATCH_MODE_META),
//   completeDeliveredMarriagesForSn, splitDispatchPendingMarriagesForSn,
//   reconcileOrphanedMarriages, marriagesPendingForSn, isMarriageActive
// ════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const FILE = process.argv[2] || '/mnt/user-data/outputs/index.html';
const html = fs.readFileSync(FILE,'utf8');

function extractFn(name){
  const sig = 'function '+name+'(';
  const i = html.indexOf(sig);
  if(i<0) throw new Error('NOT FOUND fn: '+name);
  let j = html.indexOf('{', i), depth=0, k=j;
  for(; k<html.length; k++){ const c=html[k]; if(c==='{')depth++; else if(c==='}'){depth--; if(depth===0){k++;break;}} }
  return html.slice(i,k);
}
function extractConst(name){
  const sig = 'const '+name+' = ';
  const i = html.indexOf(sig);
  if(i<0) throw new Error('NOT FOUND const: '+name);
  let j = html.indexOf('{', i), depth=0, k=j;
  for(; k<html.length; k++){ const c=html[k]; if(c==='{')depth++; else if(c==='}'){depth--; if(depth===0){k++;break;}} }
  while(k<html.length && html[k] !== ';') k++; k++;
  return html.slice(i,k);
}
const FN_NAMES = ['isMarriageActive','marriagesPendingForSn','completeDeliveredMarriagesForSn',
  'splitDispatchPendingMarriagesForSn','reconcileOrphanedMarriages',
  '_trailNow','_trailRoleLabel','mTrail','backfillMarriageTrails','marriageDispatchMode','dispModeMeta'];
const fnSrc = {}; for(const n of FN_NAMES) fnSrc[n]=extractFn(n);
const DMM = extractConst('DISPATCH_MODE_META');
// Validate each extracted snippet compiles
for(const n of FN_NAMES){ try{ new Function(fnSrc[n]); }catch(e){ console.error('EXTRACT FAIL',n,e.message); process.exit(2);} }
try{ new Function(DMM+';null'); }catch(e){ console.error('EXTRACT FAIL DISPATCH_MODE_META', e.message); process.exit(2); }

const harnessSrc = `
  let marriages=[], dispatchRequests=[], units=[], factory=[], incoming=[], dispatched=[];
  let nid=0, currentRole='admin', _clock=0;
  const window={};
  const console={ log(){}, warn(){} };
  const ROLES=new Proxy({},{get:(_,k)=>({label:String(k)})});
  function editStamp(){ return 'e'+(_clock++); }
  function toISO(){ return '2026-06-15'; }
  function fmtD(d){ return String(d); }
  function addAct(){} function toast(){} function renderRequests(){} function flushSave(){}
  ${DMM}
  ${FN_NAMES.map(n=>fnSrc[n]).join('\n')}
  return {
    fns:{ isMarriageActive, marriagesPendingForSn, completeDeliveredMarriagesForSn,
          splitDispatchPendingMarriagesForSn, reconcileOrphanedMarriages,
          mTrail, backfillMarriageTrails, marriageDispatchMode, dispModeMeta, _trailNow },
    DISPATCH_MODE_META,
    setMarriages(arr){ marriages = arr; },
    setRole(r){ currentRole = r; },
    getMarriages(){ return marriages; }
  };
`;
const ENV = (new Function(harnessSrc))();
const F = ENV.fns;

// ── PRNG ──
function makeRng(seed){ let s=seed>>>0; return function(){ s=(s+0x9E3779B9)>>>0; let z=s; z=Math.imul(z^(z>>>16),0x21f0aaad); z=Math.imul(z^(z>>>15),0x735a2d97); return ((z^(z>>>15))>>>0)/4294967296; }; }
const SEED=(process.env.SEED?parseInt(process.env.SEED,10):0x7A11).valueOf()>>>0;
const rng=makeRng(SEED); const ri=n=>Math.floor(rng()*n); const pick=a=>a[ri(a.length)];

let ASSERTS=0, FAILS=0; const failSamples=[];
function ok(cond,label,ctx){ ASSERTS++; if(!cond){ FAILS++; if(failSamples.length<15) failSamples.push({label,ctx:ctx&&JSON.stringify(ctx)}); } return cond; }

// Monotonic ISO timestamps for a scenario (created < ready < transit < delivered < dispatched)
function isoChain(baseMs){
  const H=3600000;
  return {
    created:     new Date(baseMs).toISOString(),
    readyAt:     new Date(baseMs+1*H).toISOString(),
    inTransitAt: new Date(baseMs+2*H).toISOString(),
    deliveredDate:new Date(baseMs+3*H).toISOString(),
    dispatchedDate:new Date(baseMs+4*H).toISOString(),
  };
}
function ascending(arr){ for(let i=1;i<arr.length;i++){ if(new Date(arr[i-1].at).getTime() > new Date(arr[i].at).getTime()) return false; } return true; }

// ════════════════════════════════════════════════════════════════════════
// PASS A — BACKFILL correctness (the heavy pass; runs on every legacy record).
// ════════════════════════════════════════════════════════════════════════
function passA(N){
  let scen=0;
  const KINDS = ['created','ready-to-ship','ready-for-pickup','in-transit','delivered',
                 'delivered-direct','completed','completed-dealer','split-pending'];
  for(let it=0; it<N; it++){
    scen++;
    const t = isoChain(Date.UTC(2026,0,1) + it*60000);
    const kind = pick(KINDS);
    const m = { id: it, spaSn: String(30000+(it%9000)), spaDealer:'D'+(it%50),
                accessoryName:'Acc'+(it%20), accessoryQty:1+ri(12), created:t.created };
    // Build a self-consistent legacy record (NO trail yet)
    let expectTerminalState, expectTerminalMode, expectResolvedMode;
    switch(kind){
      case 'created': m.status='pending'; expectTerminalState='created'; expectTerminalMode=undefined; expectResolvedMode=null; break;
      case 'ready-to-ship': m.status='ready-to-ship'; m.readyAt=t.readyAt; expectTerminalState='ready-to-ship'; expectResolvedMode=null; break;
      case 'ready-for-pickup': m.status='ready-for-pickup'; m.readyAt=t.readyAt; expectTerminalState='ready-for-pickup'; expectResolvedMode=null; break;
      case 'in-transit': m.status='in-transit'; m.readyAt=t.readyAt; m.inTransitAt=t.inTransitAt; expectTerminalState='in-transit'; expectResolvedMode=null; break;
      case 'delivered': m.status='delivered'; m.readyAt=t.readyAt; m.inTransitAt=t.inTransitAt; m.deliveredDate=t.deliveredDate; m.location='MINV'; expectTerminalState='delivered'; expectResolvedMode=null; break;
      case 'delivered-direct': m.status='delivered'; m.deliveredDate=t.deliveredDate; m.location='MINV'; expectTerminalState='delivered'; expectResolvedMode=null; break; // no ready/transit (direct receive)
      case 'completed': m.status='completed'; m.deliveredDate=t.deliveredDate; m.dispatchedDate=t.dispatchedDate; expectTerminalState='completed'; expectTerminalMode=null; expectResolvedMode=null; break;
      case 'completed-dealer': m.status='completed'; m.dispatchedDate=t.dispatchedDate; m.via='dealer-pickup-at-factory'; expectTerminalState='completed'; expectTerminalMode='dealer-pickup'; expectResolvedMode='dealer-pickup'; break;
      case 'split-pending': m.status='split-pending'; m.splitDispatchedDate=t.dispatchedDate; expectTerminalState='split-pending'; expectTerminalMode='split'; expectResolvedMode='split'; break;
    }
    ENV.setMarriages([m]);
    const n1 = F.backfillMarriageTrails();
    const mm = ENV.getMarriages()[0];

    // (A1) exactly one record backfilled
    ok(n1===1, 'A1 backfilled-one', {kind,n1});
    // (A2) trail exists + starts with 'created'
    ok(Array.isArray(mm.trail) && mm.trail.length>=1, 'A2 trail-nonempty', {kind});
    ok(mm.trail[0] && mm.trail[0].state==='created', 'A2 starts-created', {kind, got:mm.trail[0]&&mm.trail[0].state});
    // (A3) terminal entry matches the record's lifecycle stage
    const term = mm.trail[mm.trail.length-1];
    ok(term.state===expectTerminalState, 'A3 terminal-state', {kind, exp:expectTerminalState, got:term.state});
    if(expectTerminalMode!==undefined){ ok((term.mode||null)===expectTerminalMode, 'A3 terminal-mode', {kind, exp:expectTerminalMode, got:term.mode}); }
    // (A4) chronological ordering of the reconstructed timeline
    ok(ascending(mm.trail), 'A4 chronological', {kind, ats: mm.trail.map(e=>e.at)});
    // (A5) marriageDispatchMode resolves as expected
    ok(F.marriageDispatchMode(mm)===expectResolvedMode, 'A5 resolved-mode', {kind, exp:expectResolvedMode, got:F.marriageDispatchMode(mm)});
    // (A6) idempotent: second backfill changes nothing
    const before = JSON.stringify(mm.trail);
    const n2 = F.backfillMarriageTrails();
    ok(n2===0, 'A6 idempotent-count', {kind,n2});
    ok(JSON.stringify(ENV.getMarriages()[0].trail)===before, 'A6 idempotent-content', {kind});
    // (A7) every entry has the required shape
    ok(mm.trail.every(e=> typeof e.at==='string' && typeof e.state==='string' && ('via' in e) && ('mode' in e)), 'A7 entry-shape', {kind});
  }
  return scen;
}

// ════════════════════════════════════════════════════════════════════════
// PASS B — mTrail structural invariants.
// ════════════════════════════════════════════════════════════════════════
function passB(N){
  let scen=0;
  const STATES=['ready-to-ship','in-transit','delivered','completed','split-pending','reverted','ready-for-pickup'];
  const VIAS=['scan','manual','auto',undefined];
  const STATIONS=['factory','truck','warehouse','dispatch','dealer','scanner',undefined];
  const MODES=['floor-checklist','schedule-scan','schedule-quick','dealer-pickup','split',null,undefined];
  for(let it=0; it<N; it++){
    scen++;
    const m={ id:it, spaSn:String(it), created:new Date(Date.UTC(2026,0,1)+it*1000).toISOString(), status:'pending' };
    // first event (not 'created')
    const st1=pick(STATES), via1=pick(VIAS), station1=pick(STATIONS), mode1=pick(MODES);
    ENV.setRole(pick(['admin','warehouse','truck','factory']));
    F.mTrail(m, st1, {via:via1, station:station1, mode:mode1});
    // (B1) synthesized 'created' seeded first → length 2, [0]=created
    ok(m.trail.length===2, 'B1 seed-created-len', {len:m.trail.length});
    ok(m.trail[0].state==='created', 'B1 seed-created-state', {got:m.trail[0].state});
    // (B2) the pushed entry reflects inputs (via defaults to manual)
    const e1=m.trail[1];
    ok(e1.state===st1, 'B2 state', {exp:st1,got:e1.state});
    ok(e1.via===(via1||'manual'), 'B2 via-default', {exp:via1||'manual',got:e1.via});
    ok((e1.mode||null)===(mode1||null), 'B2 mode', {exp:mode1||null,got:e1.mode});
    ok(e1.station===(station1||''), 'B2 station', {exp:station1||'',got:e1.station});
    // (B3) second event grows by exactly 1 (no extra seed)
    const before=m.trail.length;
    F.mTrail(m, pick(STATES), {via:pick(VIAS)});
    ok(m.trail.length===before+1, 'B3 grow-by-one', {before, after:m.trail.length});
    // (B4) a fresh marriage whose first event IS 'created' → length 1
    const m2={ id:'b'+it, created:t0, status:'pending' };
    F.mTrail(m2, 'created', {});
    ok(m2.trail.length===1 && m2.trail[0].state==='created', 'B4 explicit-created', {len:m2.trail.length});
  }
  return scen;
}
const t0=new Date(Date.UTC(2026,0,1)).toISOString();

// ════════════════════════════════════════════════════════════════════════
// PASS C — Full lifecycle through real dispatch helpers + mTrail (mirrors app).
// ════════════════════════════════════════════════════════════════════════
function passC(N){
  let scen=0;
  const DISPATCH=[
    {via:'manual',station:'dispatch',mode:'floor-checklist'},
    {via:'scan',station:'scanner',mode:'schedule-scan'},
    {via:'manual',station:'dispatch',mode:'schedule-quick'},
  ];
  for(let it=0; it<N; it++){
    scen++;
    const sn=String(40000+(it%9000));
    const m={ id:it, spaSn:sn, spaDealer:'D', accessoryName:'A'+(it%10), accessoryQty:1+ri(6),
              created:new Date(Date.UTC(2026,0,1)+it*1000).toISOString(), status:'pending', location:'MINV' };
    ENV.setMarriages([m]);
    // Walk the real lifecycle by replaying the exact mTrail calls each transition fn makes:
    ENV.setRole('factory');   F.mTrail(m,'ready-to-ship',{via:'manual',station:'factory',note:'Factory ready'});
    ENV.setRole('truck');     F.mTrail(m,'in-transit',{via:'scan',station:'truck',note:'Truck scan'});
    const recScan = ri(2)===0;
    ENV.setRole('warehouse');
    if(recScan){ m.status='delivered'; F.mTrail(m,'delivered',{via:'scan',station:'warehouse',note:'QR receive'}); }
    else       { m.status='delivered'; F.mTrail(m,'delivered',{via:'manual',station:'warehouse',note:'Manual receive'}); }
    // Now dispatch via the REAL helper with a mode
    const dm=pick(DISPATCH);
    ENV.setMarriages([m]);
    F.completeDeliveredMarriagesForSn(sn, '2026-06-15', dm);
    const mm=ENV.getMarriages()[0];
    // (C1) end state completed
    ok(mm.status==='completed', 'C1 completed', {got:mm.status});
    // (C2) full ordered stage sequence present
    const states=mm.trail.map(e=>e.state);
    ok(states[0]==='created', 'C2 created-first', {states});
    ok(states.includes('ready-to-ship') && states.includes('in-transit') && states.includes('delivered') && states[states.length-1]==='completed', 'C2 full-chain', {states});
    // (C3) receive via matches what happened
    const recv=mm.trail.find(e=>e.state==='delivered');
    ok(recv && recv.via===(recScan?'scan':'manual'), 'C3 receive-via', {exp:recScan?'scan':'manual', got:recv&&recv.via});
    ok(recv && recv.station==='warehouse', 'C3 receive-station', {got:recv&&recv.station});
    // (C4) truck leg is a scan
    const tr=mm.trail.find(e=>e.state==='in-transit');
    ok(tr && tr.via==='scan' && tr.station==='truck', 'C4 truck-scan', {got:tr});
    // (C5) dispatch mode recorded + resolvable
    const comp=mm.trail[mm.trail.length-1];
    ok(comp.mode===dm.mode && comp.via===dm.via, 'C5 dispatch-mode', {exp:dm.mode, got:comp.mode});
    ok(F.marriageDispatchMode(mm)===dm.mode, 'C5 resolved', {exp:dm.mode, got:F.marriageDispatchMode(mm)});
    // (C6) chronological
    ok(ascending(mm.trail), 'C6 chronological', null);
  }
  return scen;
}

// ════════════════════════════════════════════════════════════════════════
// PASS D — dispModeMeta completeness + marriageDispatchMode field fallbacks.
// ════════════════════════════════════════════════════════════════════════
function passD(){
  let scen=0;
  const modes=Object.keys(ENV.DISPATCH_MODE_META);
  for(const mode of modes){ scen++;
    const meta=F.dispModeMeta(mode);
    ok(meta && typeof meta.label==='string' && meta.label.length>0 && typeof meta.icon==='string' && /^#/.test(meta.color), 'D meta-shape', {mode, meta});
  }
  // unknown mode → safe fallback
  scen++; const fb=F.dispModeMeta('totally-unknown-xyz');
  ok(fb && typeof fb.label==='string' && typeof fb.color==='string', 'D unknown-fallback', {fb});
  // marriageDispatchMode field fallbacks (no trail)
  scen++; ok(F.marriageDispatchMode({status:'pending'})===null, 'D field-pending-null');
  scen++; ok(F.marriageDispatchMode({status:'delivered'})===null, 'D field-delivered-null');
  scen++; ok(F.marriageDispatchMode({status:'split-pending'})==='split', 'D field-split');
  scen++; ok(F.marriageDispatchMode({status:'completed', via:'dealer-pickup-at-factory'})==='dealer-pickup', 'D field-dealer');
  scen++; ok(F.marriageDispatchMode({status:'completed'})===null, 'D field-completed-unknown-null');
  // trail overrides fields (last mode entry wins)
  scen++; ok(F.marriageDispatchMode({status:'completed', trail:[{state:'completed',mode:'floor-checklist'}]})==='floor-checklist', 'D trail-overrides');
  scen++; ok(F.marriageDispatchMode({status:'completed', trail:[{state:'x'},{state:'completed',mode:'schedule-scan'},{state:'y'}]})==='schedule-scan', 'D trail-last-mode');
  scen++; ok(F.marriageDispatchMode({status:'completed', trail:[{state:'delivered',via:'scan'}]})===null, 'D trail-no-mode-null');
  scen++; ok(F.marriageDispatchMode(null)===null, 'D null-safe');
  return scen;
}

// ════════════════════════════════════════════════════════════════════════
const tStart=Date.now();
const NA=parseInt(process.env.NA||'780000',10);
const NB=parseInt(process.env.NB||'140000',10);
const NC=parseInt(process.env.NC||'140000',10);
console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║  ASPEN WAREHOUSE v5.01 — DEEP TRAIL / PROVENANCE SIMULATION         ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');
console.log('File   :', FILE);
console.log('Seed   : 0x'+SEED.toString(16).toUpperCase(), '(set SEED env to reproduce)');
console.log('Extracted real fns:', FN_NAMES.join(', '));
console.log('');
const a=passA(NA), b=passB(NB), c=passC(NC), d=passD();
const dt=((Date.now()-tStart)/1000).toFixed(1);
console.log('── PASS A  backfill correctness (legacy-record reconstruction) ─────');
console.log('   scenarios:', a.toLocaleString(), '· 7 invariants each (state/order/idempotency/mode)');
console.log('── PASS B  mTrail structural invariants ────────────────────────────');
console.log('   scenarios:', b.toLocaleString(), '· created-seed / via-default / grow-by-one');
console.log('── PASS C  full lifecycle via real helpers (created→…→dispatched) ──');
console.log('   scenarios:', c.toLocaleString(), '· full ordered chain + receive/truck/dispatch via');
console.log('── PASS D  dispModeMeta + marriageDispatchMode fallbacks ───────────');
console.log('   checks   :', d.toLocaleString());
console.log('');
console.log('────────────────────────────────────────────────────────────────────');
console.log('Total scenarios :', (a+b+c+d).toLocaleString());
console.log('Total assertions:', ASSERTS.toLocaleString());
console.log('Failures        :', FAILS.toLocaleString());
console.log('Runtime         :', dt+'s');
if(FAILS){
  console.log('\n✗ FAILURE SAMPLES:');
  for(const f of failSamples) console.log('   -', f.label, f.ctx||'');
  console.log('\n❌ VERDICT: trail area has invariant violations.');
  process.exit(1);
} else {
  console.log('\n✅ VERDICT: trail/provenance area holds across '+ASSERTS.toLocaleString()+' assertions.');
  process.exit(0);
}
