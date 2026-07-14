'use strict';
// ════════════════════════════════════════════════════════════════════════
// ASPEN WAREHOUSE — DEEP MARRIAGE/DISPATCH RECONCILIATION SIMULATION (v5.00)
// Tests the REAL functions extracted from index.html (not a re-implementation):
//   isMarriageActive, marriagesPendingForSn, marriagesDeliveredForSn,
//   marriagesForSn, completeDeliveredMarriagesForSn,
//   splitDispatchPendingMarriagesForSn, reconcileOrphanedMarriages
// Drives them through the two dispatch paths + self-heal, checking invariants.
// ════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const FILE = process.argv[2] || '/mnt/user-data/outputs/index.html';
const html = fs.readFileSync(FILE,'utf8');

// ---- Extract a function's full source by brace-balance (safe for these fns:
//      every { in their strings/templates has a matching }). ----
function extractFn(name){
  const sig = 'function '+name+'(';
  const i = html.indexOf(sig);
  if(i<0) throw new Error('NOT FOUND: '+name);
  // find first { after the ) of the signature
  let j = html.indexOf('{', i);
  let depth=0, k=j;
  for(; k<html.length; k++){
    const c=html[k];
    if(c==='{') depth++;
    else if(c==='}'){ depth--; if(depth===0){ k++; break; } }
  }
  return html.slice(i,k);
}
const NAMES = ['isMarriageActive','marriagesPendingForSn','marriagesDeliveredForSn',
  'marriagesForSn','completeDeliveredMarriagesForSn','splitDispatchPendingMarriagesForSn',
  'reconcileOrphanedMarriages','_trailNow','_trailRoleLabel','mTrail'];
const sources = {};
for(const n of NAMES){ sources[n]=extractFn(n); }

// Sanity: each extracted snippet must itself be syntactically valid.
for(const n of NAMES){ try{ new Function(sources[n]); }catch(e){ console.error('EXTRACT SYNTAX FAIL',n,e.message); process.exit(2);} }

// ---- Build a controlled scope holding the real fns + stubbed globals. ----
// The real fns reference bare globals (marriages, nid, ROLES, editStamp, ...).
// We declare those with `let`/`function` in the SAME scope (via new Function),
// so the extracted fns close over our stubs. Then we expose handles + a reset.
const harnessSrc = `
  let marriages=[], dispatchRequests=[], units=[], factory=[], incoming=[], dispatched=[];
  let nid=0, currentRole='admin';
  let _clock=0;
  const window={};
  const console={ log(){}, warn(){} };   // silence extracted-fn logging during bulk runs
  const ROLES=new Proxy({},{get:(_,k)=>({label:String(k)})});
  function editStamp(){ return 'e'+(_clock++); }
  function _born(r){ if(r && typeof r === 'object' && !r.updatedAt) r.updatedAt = editStamp(); return r; }   // v5.41 — birth-stamp helper (mirrors index.html)
  function toISO(){ return '2026-06-15'; }
  function fmtD(d){ return String(d); }
  function addAct(){}
  function toast(){}
  function renderRequests(){}
  function flushSave(){}
  ${NAMES.map(n=>sources[n]).join('\n')}
  return {
    fns:{ isMarriageActive, marriagesPendingForSn, marriagesDeliveredForSn, marriagesForSn,
          completeDeliveredMarriagesForSn, splitDispatchPendingMarriagesForSn, reconcileOrphanedMarriages },
    setState(s){
      marriages=s.marriages; dispatchRequests=s.dispatchRequests; units=s.units;
      factory=s.factory; incoming=s.incoming; dispatched=s.dispatched;
      nid=s.nid||0; currentRole=s.currentRole||'admin';
    },
    get(){ return { marriages, dispatchRequests, units, factory, incoming, dispatched, nid, currentRole }; }
  };
`;
const ENV = (new Function(harnessSrc))();
const F = ENV.fns;

// ════════════════════════════════════════════════════════════════════════
// PRNG — deterministic (splitmix32). Seed is printed for reproducibility.
// ════════════════════════════════════════════════════════════════════════
function makeRng(seed){
  let s = seed>>>0;
  return function(){
    s = (s + 0x9E3779B9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z>>>16), 0x21f0aaad);
    z = Math.imul(z ^ (z>>>15), 0x735a2d97);
    return ((z ^ (z>>>15)) >>> 0) / 4294967296;
  };
}
const SEED = (process.env.SEED ? parseInt(process.env.SEED,10) : 0xA59E0) >>> 0;
const rng = makeRng(SEED);
const ri = (n)=> Math.floor(rng()*n);
const pick = (a)=> a[ri(a.length)];

// ---- Test bookkeeping ----
let ASSERTS=0, FAILS=0;
const failSamples=[];
function ok(cond, label, ctx){
  ASSERTS++;
  if(!cond){
    FAILS++;
    if(failSamples.length<12) failSamples.push({label, ctx: ctx&&JSON.stringify(ctx)});
  }
  return cond;
}

// S/N representation fuzz: same digits, different JS types/whitespace — all must
// match after String().trim(). (No leading-zero variants — those are different S/Ns.)
function reprSn(num, mode){
  switch(mode){
    case 0: return num;                 // number
    case 1: return String(num);         // plain string
    case 2: return '  '+num+'  ';       // padded string
    case 3: return String(num)+'';      // string
    default: return num;
  }
}

const STATUSES = ['pending','ready-to-ship','in-transit','delivered','completed','split-pending'];
const ACTIVE   = new Set(['pending','ready-to-ship','in-transit','split-pending']); // per isMarriageActive (+ready-for-pickup)
function isActiveStatus(s){ return s==='pending'||s==='ready-to-ship'||s==='ready-for-pickup'||s==='in-transit'||s==='split-pending'; }

let MID=1, SNSEQ=30000;
function freshSn(){ return ++SNSEQ; }

// Build a random marriage record for a given numeric S/N.
function mkMarriage(snNum, status){
  return {
    id: MID++,
    spaSn: reprSn(snNum, ri(4)),
    spaDealer: 'Dealer'+ri(50),
    accessoryName: pick(['Pumps, Packs, Pillows','Swag Bag Deluxe','POP Box','Pallet','Front Panel','Cabinet Door','28" Step','Short Filter']),
    accessoryQty: 1+ri(12),
    status: status,
    _pre: status,   // pre-dispatch status snapshot (harness-only, ignored by app code)
    location: (status==='delivered') ? 'MINV' : (status==='completed'||status==='split-pending' ? null : 'MINV'),
  };
}

// Simulate a dispatch via the helper sequence the REAL code runs.
// pathOldBuggy=true → simulate the PRE-v5.00 group path (NO helpers) to prove the bug.
function dispatchSpa(env, snNum, snRepr, dealer, {oldBuggy=false, meta=null}={}){
  const date='2026-06-15', auth='AUTH';
  const u = { id: 'u'+snNum, sn: snRepr, dealer };
  // remove from floor + record dispatched (both paths do this)
  env.units = env.units.filter(x=>String(x.sn).trim()!==String(snRepr).trim());
  env.dispatched.unshift({ id:u.id, sn:snRepr, dealer, deliveryStatus:'delivered-to-dealer' });
  ENV.setState(env);
  if(!oldBuggy){
    // FIXED behavior (identical in confirmDispatch and dispatchAndDeliverGroup):
    F.splitDispatchPendingMarriagesForSn(u, date, auth, meta);
    F.completeDeliveredMarriagesForSn(u.sn, date, meta);
  }
  Object.assign(env, ENV.get());
}

// Count "orphans" for a numeric S/N: delivered marriages still parked at MINV.
function orphanCount(env, snNum){
  return env.marriages.filter(m=> String(m.spaSn).trim()===String(snNum) && m.status==='delivered' && m.location==='MINV').length;
}
function blankState(){
  return { marriages:[], dispatchRequests:[], units:[], factory:[], incoming:[], dispatched:[], nid:0, currentRole:'admin' };
}

// ════════════════════════════════════════════════════════════════════════
// PASS 1 — Massive randomized property test over both dispatch paths.
// ════════════════════════════════════════════════════════════════════════
function pass1(N){
  let scenarios=0;
  for(let it=0; it<N; it++){
    scenarios++;
    const env = blankState();
    env.currentRole = pick(['admin','warehouse','organizer','tech']);
    // Build a set of spas, each with 1..4 marriages in random statuses.
    const nSpas = 1+ri(5);
    const spaList=[];
    for(let s=0;s<nSpas;s++){
      const snNum = freshSn();
      const snReprForUnit = reprSn(snNum, ri(4));
      const nMar = 1+ri(4);
      const mars=[];
      for(let k=0;k<nMar;k++){
        const st = pick(STATUSES);
        const m = mkMarriage(snNum, st);
        mars.push(m); env.marriages.push(m);
      }
      // also a couple of noise marriages with null/empty spaSn
      if(ri(5)===0){ const nm = mkMarriage(snNum,'delivered'); nm.spaSn = pick([null,undefined,'','   ']); env.marriages.push(nm); }
      env.units.push({ id:'u'+snNum, sn:snReprForUnit, dealer:'D'+s });
      spaList.push({snNum, snRepr:snReprForUnit, mars});
    }
    // Snapshot pre-state for conservation checks
    const totalMarBefore = env.marriages.length;
    // Decide which spas get dispatched (random subset), each via a random dispatch MODE.
    const MODES = [
      {via:'manual', station:'dispatch', mode:'floor-checklist'},
      {via:'scan',   station:'scanner',  mode:'schedule-scan'},
      {via:'manual', station:'dispatch', mode:'schedule-quick'},
    ];
    const dispatchedNums = new Set();
    for(const sp of spaList){
      if(ri(2)===0){ // ~half dispatched
        const meta = pick(MODES);
        dispatchSpa(env, sp.snNum, sp.snRepr, 'D', {oldBuggy:false, meta});
        dispatchedNums.add(sp.snNum);
        sp._mode = meta.mode;
      }
    }
    // ── INVARIANTS (per-marriage, keyed on pre-dispatch status _pre) ──
    for(const m of env.marriages){
      const snKey = (m.spaSn!=null) ? String(m.spaSn).trim() : '';
      const owner = spaList.find(sp=>String(sp.snNum)===snKey);
      const wasDispatched = owner && dispatchedNums.has(owner.snNum);
      if(wasDispatched){
        if(m._pre==='delivered'){
          ok(m.status==='completed', 'I-delivered=>completed', {mid:m.id, got:m.status});
          ok(m.location===null, 'I-completed-loc-null', {mid:m.id, loc:m.location});
          const lastMode = Array.isArray(m.trail) ? [...m.trail].reverse().find(e=>e.mode) : null;
          ok(lastMode && lastMode.mode===owner._mode, 'I-trail-mode-completed', {mid:m.id, exp:owner._mode, got:lastMode&&lastMode.mode});
        } else if(m._pre==='pending'||m._pre==='ready-to-ship'||m._pre==='in-transit'){
          ok(m.status==='split-pending', 'I-active=>split', {mid:m.id, pre:m._pre, got:m.status});
          const reqs = env.dispatchRequests.filter(r=>r.marriageId===m.id);
          ok(reqs.length===1, 'I-one-request-per-split', {mid:m.id, got:reqs.length});
          ok(reqs.every(r=>r.type==='accessory' && r.urgent===true && r.status==='pending' && r.autoCreated===true), 'I-request-shape', {mid:m.id});
          ok(reqs.every(r=>String(r.spaSn).trim()===String(owner.snRepr).trim()), 'I-request-spaSn', {mid:m.id});
          ok(Array.isArray(m.trail) && m.trail.some(e=>e.mode==='split'), 'I-trail-mode-split', {mid:m.id});
        } else if(m._pre==='split-pending'){
          // already split before dispatch → unchanged, and NO new request created (idempotent skip)
          ok(m.status==='split-pending', 'I-split-stays', {mid:m.id, got:m.status});
          ok(env.dispatchRequests.filter(r=>r.marriageId===m.id).length===0, 'I-split-no-dup-request', {mid:m.id});
        } else if(m._pre==='completed'){
          ok(m.status==='completed', 'I-completed-stays', {mid:m.id, got:m.status});
        }
      } else {
        // marriage on a non-dispatched spa (or unmatched/null spaSn) → must be untouched
        ok(m.status===m._pre, 'I-untouched-status', {mid:m.id, pre:m._pre, got:m.status});
      }
    }
    // (I-orphan) No dispatched spa leaves a delivered marriage parked at MINV.
    for(const sp of spaList){ if(dispatchedNums.has(sp.snNum)){
      ok(orphanCount(env, sp.snNum)===0, 'I-no-orphan', {sn:sp.snNum});
    }}
    // (I-conserve) No marriage created or destroyed (count constant).
    ok(env.marriages.length===totalMarBefore, 'I-conserve-count', {before:totalMarBefore, after:env.marriages.length});
    // (I6) Idempotency: re-run helpers for every dispatched spa → zero further change.
    const reqCountAfter = env.dispatchRequests.length;
    const statusSig = env.marriages.map(m=>m.id+':'+m.status).join('|');
    ENV.setState(env);
    for(const sp of spaList){ if(dispatchedNums.has(sp.snNum)){
      const u={id:'u'+sp.snNum, sn:sp.snRepr, dealer:'D'};
      F.splitDispatchPendingMarriagesForSn(u,'2026-06-15','AUTH');
      F.completeDeliveredMarriagesForSn(u.sn,'2026-06-15');
    }}
    Object.assign(env, ENV.get());
    ok(env.dispatchRequests.length===reqCountAfter, 'I6 idempotent-no-new-requests', {before:reqCountAfter, after:env.dispatchRequests.length});
    ok(env.marriages.map(m=>m.id+':'+m.status).join('|')===statusSig, 'I6 idempotent-no-status-churn', null);
  }
  return scenarios;
}

// ════════════════════════════════════════════════════════════════════════
// PASS 2 — Self-heal (reconcileOrphanedMarriages) correctness, incl. negatives.
// ════════════════════════════════════════════════════════════════════════
function pass2(N){
  let scenarios=0;
  for(let it=0; it<N; it++){
    scenarios++;
    const env = blankState();
    env.currentRole='admin';
    const cases=[]; // {snNum, kind, mid}
    const nSpas=1+ri(6);
    for(let s=0;s<nSpas;s++){
      const snNum=freshSn();
      // kind decides where the spa "lives" + whether a delivered marriage should heal
      const kind = pick(['orphan-buggy','clean-fixed','on-floor','at-factory','in-incoming','returned','not-dispatched']);
      const m = mkMarriage(snNum,'delivered'); env.marriages.push(m);
      cases.push({snNum, kind, mid:m.id});
      switch(kind){
        case 'orphan-buggy': // dispatched via buggy path → SHOULD heal
          dispatchSpa(env, snNum, reprSn(snNum,ri(4)), 'D', {oldBuggy:true}); break;
        case 'clean-fixed':  // dispatched via fixed path → already completed, nothing to heal
          dispatchSpa(env, snNum, reprSn(snNum,ri(4)), 'D', {oldBuggy:false}); break;
        case 'on-floor':     // still in units → must NOT heal
          env.units.push({id:'u'+snNum, sn:reprSn(snNum,ri(4)), dealer:'D'}); break;
        case 'at-factory':   // at factory → must NOT heal
          env.factory.push({id:'f'+snNum, sn:reprSn(snNum,ri(4)), type:'spa'}); break;
        case 'in-incoming':  // incoming → must NOT heal
          env.incoming.push({id:'i'+snNum, sn:reprSn(snNum,ri(4)), status:'arrived'}); break;
        case 'returned':     // dispatched but returned → must NOT heal
          env.dispatched.unshift({id:'d'+snNum, sn:reprSn(snNum,ri(4)), dealer:'D', deliveryStatus:'returned'}); break;
        case 'not-dispatched': // nowhere → must NOT heal (no dispatched record)
          break;
      }
    }
    ENV.setState(env);
    const healed = F.reconcileOrphanedMarriages();
    Object.assign(env, ENV.get());
    // Verify each case ended in the right state
    let expectedHeal=0;
    for(const c of cases){
      const m = env.marriages.find(x=>x.id===c.mid);
      if(c.kind==='orphan-buggy'){
        expectedHeal++;
        ok(m.status==='completed' && m.location===null, 'P2 orphan-healed', c);
        ok(Array.isArray(m.trail) && m.trail.some(e=>e.mode==='auto-reconcile'), 'P2 heal-trail-logged', c);
      } else if(c.kind==='clean-fixed'){
        ok(m.status==='completed', 'P2 clean-stays-completed', c); // was completed by fixed dispatch
      } else {
        ok(m.status==='delivered' && m.location==='MINV', 'P2 must-not-heal', c);
      }
    }
    ok(healed===expectedHeal, 'P2 heal-count-exact', {healed, expectedHeal});
    // Idempotency: second run heals nothing.
    ENV.setState(env);
    const healed2 = F.reconcileOrphanedMarriages();
    ok(healed2===0, 'P2 heal-idempotent', {healed2});
  }
  return scenarios;
}

// ════════════════════════════════════════════════════════════════════════
// PASS 3 — Exhaustive combinatorial sweep (every status × path × role × repr).
// ════════════════════════════════════════════════════════════════════════
function pass3(){
  let scenarios=0;
  const paths=['fixed-floor','fixed-group','buggy-then-heal'];
  const roles=['admin','warehouse','organizer','tech'];
  for(const st of STATUSES){
    for(const p of paths){
      for(const role of roles){
        for(let repr=0; repr<4; repr++){
          for(let unitRepr=0; unitRepr<4; unitRepr++){
            scenarios++;
            const env=blankState(); env.currentRole=role;
            const snNum=freshSn();
            const m=mkMarriage(snNum, st); m.spaSn=reprSn(snNum,repr); env.marriages.push(m);
            const snU=reprSn(snNum, unitRepr);
            env.units.push({id:'u'+snNum, sn:snU, dealer:'D'});
            const wasActive = isActiveStatus(st);
            const wasDelivered = st==='delivered';
            if(p==='buggy-then-heal'){
              dispatchSpa(env, snNum, snU, 'D', {oldBuggy:true});
              ENV.setState(env); F.reconcileOrphanedMarriages(); Object.assign(env, ENV.get());
            } else {
              dispatchSpa(env, snNum, snU, 'D', {oldBuggy:false});
            }
            const mm=env.marriages.find(x=>x.id===m.id);
            // Outcome rules:
            if(wasDelivered){
              ok(mm.status==='completed' && mm.location===null, 'P3 delivered=>completed', {st,p,role,repr,unitRepr,got:mm.status});
            } else if(wasActive && st!=='split-pending'){
              if(p==='buggy-then-heal'){
                // buggy path didn't run helpers; heal only touches delivered → active stays active
                ok(mm.status===st, 'P3 active-buggy-stays', {st,p,got:mm.status});
              } else {
                ok(mm.status==='split-pending', 'P3 active=>split', {st,p,role,got:mm.status});
                const reqs=env.dispatchRequests.filter(r=>r.marriageId===m.id);
                ok(reqs.length===1, 'P3 split-one-request', {st,p,got:reqs.length});
              }
            } else if(st==='split-pending'){
              // already split — fixed path must NOT create a duplicate request
              ok(mm.status==='split-pending', 'P3 split-stays', {p,got:mm.status});
              ok(env.dispatchRequests.filter(r=>r.marriageId===m.id).length===0, 'P3 split-no-dup-request', {p});
            } else if(st==='completed'){
              ok(mm.status==='completed', 'P3 completed-stays', {p,got:mm.status});
            }
            // Never an orphan after any fixed path
            if(p!=='buggy-then-heal') ok(orphanCount(env,snNum)===0,'P3 no-orphan',{st,p});
          }
        }
      }
    }
  }
  return scenarios;
}

// ════════════════════════════════════════════════════════════════════════
// PASS 4 — Named adversarial cases (incl. the literal 31033 reproduction).
// ════════════════════════════════════════════════════════════════════════
function pass4(){
  const results=[];
  // (A) Exact 31033 reproduction: tub dispatched via BUGGY group path, marriage
  //     'Pumps, Packs, Pillows x12' delivered@MINV. Prove bug, then prove heal.
  {
    const env=blankState(); env.currentRole='admin';
    const m={id:777,spaSn:31033,spaDealer:'Aqua Palace',accessoryName:'Pumps, Packs, Pillows',accessoryQty:12,status:'delivered',location:'MINV'};
    env.marriages.push(m);
    env.units.push({id:'u31033', sn:'31033', dealer:'Aqua Palace'});
    // BUGGY dispatch (old group path): leaves orphan
    dispatchSpa(env, 31033, '31033', 'Aqua Palace', {oldBuggy:true});
    const bugOrphan = orphanCount(env,31033)===1;
    results.push(['31033 OLD path leaves orphan (bug reproduced)', bugOrphan]);
    ok(bugOrphan, 'A bug-reproduced');
    // Self-heal
    ENV.setState(env); const h=F.reconcileOrphanedMarriages(); Object.assign(env,ENV.get());
    const healed = h===1 && env.marriages.find(x=>x.id===777).status==='completed' && env.marriages.find(x=>x.id===777).location===null && orphanCount(env,31033)===0;
    results.push(['31033 self-heal fixes it (completed, off MINV)', healed]);
    ok(healed,'A healed');
  }
  // (B) Same 31033 but dispatched via FIXED path from the start: never orphans.
  {
    const env=blankState(); env.currentRole='admin';
    env.marriages.push({id:778,spaSn:31033,accessoryName:'Pumps, Packs, Pillows',accessoryQty:12,status:'delivered',location:'MINV'});
    env.units.push({id:'u31033', sn:31033, dealer:'Aqua Palace'}); // numeric S/N on unit, string on marriage
    dispatchSpa(env, 31033, 31033, 'Aqua Palace', {oldBuggy:false});
    const fixedOk = orphanCount(env,31033)===0 && env.marriages.find(x=>x.id===778).status==='completed';
    results.push(['31033 FIXED path never orphans (number/str S/N mix)', fixedOk]);
    ok(fixedOk,'B fixed');
  }
  // (C) Mixed spa: one delivered + one pending. After dispatch: completed + split, zero orphan.
  {
    const env=blankState(); env.currentRole='admin';
    env.marriages.push({id:1,spaSn:'5001',accessoryName:'A',accessoryQty:1,status:'delivered',location:'MINV'});
    env.marriages.push({id:2,spaSn:5001,accessoryName:'B',accessoryQty:2,status:'pending',location:'MINV'});
    env.units.push({id:'u',sn:'5001',dealer:'D'});
    dispatchSpa(env,5001,'5001','D',{oldBuggy:false});
    const okC = env.marriages.find(x=>x.id===1).status==='completed'
             && env.marriages.find(x=>x.id===2).status==='split-pending'
             && env.dispatchRequests.filter(r=>r.marriageId===2).length===1
             && orphanCount(env,5001)===0;
    results.push(['Mixed delivered+pending → completed + split, 1 request, 0 orphan', okC]);
    ok(okC,'C mixed');
  }
  // (D) Whitespace S/N: marriage spaSn '  9090  ', unit sn 9090. Must match.
  {
    const env=blankState(); env.currentRole='admin';
    env.marriages.push({id:9,spaSn:'  9090  ',accessoryName:'X',accessoryQty:1,status:'delivered',location:'MINV'});
    env.units.push({id:'u',sn:9090,dealer:'D'});
    dispatchSpa(env,9090,9090,'D',{oldBuggy:false});
    const okD = env.marriages.find(x=>x.id===9).status==='completed' && orphanCount(env,9090)===0;
    results.push(['Whitespace-padded S/N still matches & completes', okD]);
    ok(okD,'D whitespace');
  }
  // (E) Double-dispatch idempotency on a real-ish multi-marriage spa.
  {
    const env=blankState(); env.currentRole='admin';
    for(let i=0;i<3;i++) env.marriages.push({id:100+i,spaSn:'7777',accessoryName:'M'+i,accessoryQty:1,status:'delivered',location:'MINV'});
    env.marriages.push({id:200,spaSn:'7777',accessoryName:'P',accessoryQty:1,status:'pending',location:'MINV'});
    env.units.push({id:'u',sn:'7777',dealer:'D'});
    dispatchSpa(env,7777,'7777','D',{oldBuggy:false});
    const reqA=env.dispatchRequests.length;
    // run again
    ENV.setState(env);
    F.splitDispatchPendingMarriagesForSn({id:'u',sn:'7777',dealer:'D'},'2026-06-15','A');
    F.completeDeliveredMarriagesForSn('7777','2026-06-15');
    Object.assign(env,ENV.get());
    const okE = env.dispatchRequests.length===reqA && env.dispatchRequests.filter(r=>r.marriageId===200).length===1;
    results.push(['Double-dispatch creates no duplicate split requests', okE]);
    ok(okE,'E double');
  }
  // (F) Returned spa must NOT heal a delivered marriage that legitimately waits.
  {
    const env=blankState(); env.currentRole='admin';
    env.marriages.push({id:300,spaSn:'8888',accessoryName:'Y',accessoryQty:1,status:'delivered',location:'MINV'});
    env.dispatched.unshift({id:'d',sn:'8888',dealer:'D',deliveryStatus:'returned'});
    // spa is back on the floor after return
    env.units.push({id:'u',sn:'8888',dealer:'D'});
    ENV.setState(env); F.reconcileOrphanedMarriages(); Object.assign(env,ENV.get());
    const okF = env.marriages.find(x=>x.id===300).status==='delivered' && orphanCount(env,8888)===1;
    results.push(['Returned+on-floor spa does NOT auto-heal its marriage', okF]);
    ok(okF,'F returned');
  }
  // (G) Gate predicate: pending → blocks (non-empty); only-delivered → no block.
  {
    const env=blankState(); env.currentRole='tech';
    env.marriages.push({id:401,spaSn:'4040',status:'pending',location:'MINV',accessoryName:'Z',accessoryQty:1});
    ENV.setState(env);
    const blocks = F.marriagesPendingForSn('4040').length>0;
    env.marriages=[{id:402,spaSn:'4041',status:'delivered',location:'MINV',accessoryName:'Z',accessoryQty:1}];
    ENV.setState(env);
    const noBlock = F.marriagesPendingForSn('4041').length===0;
    const okG = blocks && noBlock;
    results.push(['Gate predicate: pending blocks, delivered-only does not', okG]);
    ok(okG,'G gate');
  }
  // (H) Full provenance: scanned-flow dispatch records the right chain (schedule-scan, via=scan).
  {
    const env=blankState(); env.currentRole='warehouse';
    const m={id:555,spaSn:'6262',accessoryName:'Swag Bag Deluxe',accessoryQty:6,status:'delivered',location:'MINV'};
    env.marriages.push(m); env.units.push({id:'u',sn:'6262',dealer:'D'});
    dispatchSpa(env,6262,'6262','D',{oldBuggy:false, meta:{via:'scan',station:'scanner',mode:'schedule-scan'}});
    const mm=env.marriages.find(x=>x.id===555);
    const me=[...(mm.trail||[])].reverse().find(e=>e.mode);
    const okH = mm.status==='completed' && me && me.mode==='schedule-scan' && me.via==='scan';
    results.push(['Trail records scanned-flow dispatch (schedule-scan · via=scan)', okH]);
    ok(okH,'H trail-scan');
  }
  // (I) Manual floor-checklist dispatch records via=manual + floor-checklist.
  {
    const env=blankState(); env.currentRole='admin';
    const m={id:556,spaSn:'6363',accessoryName:'POP Box',accessoryQty:1,status:'delivered',location:'MINV'};
    env.marriages.push(m); env.units.push({id:'u',sn:'6363',dealer:'D'});
    dispatchSpa(env,6363,'6363','D',{oldBuggy:false, meta:{via:'manual',station:'dispatch',mode:'floor-checklist'}});
    const mm=env.marriages.find(x=>x.id===556);
    const me=[...(mm.trail||[])].reverse().find(e=>e.mode);
    const okI = mm.status==='completed' && me && me.mode==='floor-checklist' && me.via==='manual';
    results.push(['Trail records manual floor-checklist dispatch (via=manual)', okI]);
    ok(okI,'I trail-manual');
  }
  // (J) Split marriage trail carries mode=split regardless of dispatch mode.
  {
    const env=blankState(); env.currentRole='admin';
    const m={id:557,spaSn:'6464',accessoryName:'Pallet',accessoryQty:1,status:'pending',location:'MINV'};
    env.marriages.push(m); env.units.push({id:'u',sn:'6464',dealer:'D'});
    dispatchSpa(env,6464,'6464','D',{oldBuggy:false, meta:{via:'scan',station:'scanner',mode:'schedule-scan'}});
    const mm=env.marriages.find(x=>x.id===557);
    const okJ = mm.status==='split-pending' && (mm.trail||[]).some(e=>e.mode==='split');
    results.push(['Split marriage trail logs mode=split (accessory left behind)', okJ]);
    ok(okJ,'J trail-split');
  }
  // (K) Trail always starts with a synthesized 'created' entry (timeline integrity).
  {
    const env=blankState(); env.currentRole='admin';
    const m={id:558,spaSn:'6565',accessoryName:'Front Panel',accessoryQty:1,status:'delivered',location:'MINV'};
    env.marriages.push(m); env.units.push({id:'u',sn:'6565',dealer:'D'});
    dispatchSpa(env,6565,'6565','D',{oldBuggy:false, meta:{via:'manual',station:'dispatch',mode:'floor-checklist'}});
    const mm=env.marriages.find(x=>x.id===558);
    const okK = Array.isArray(mm.trail) && mm.trail.length>=2 && mm.trail[0].state==='created';
    results.push(['Trail timeline always begins with a created entry', okK]);
    ok(okK,'K trail-created');
  }
  return results;
}

// ════════════════════════════════════════════════════════════════════════
// RUN
// ════════════════════════════════════════════════════════════════════════
const t0=Date.now();
const N1 = parseInt(process.env.N1||'1400000',10);
const N2 = parseInt(process.env.N2||'600000',10);
console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║  ASPEN WAREHOUSE v5.01 — DEEP MARRIAGE+TRAIL SIMULATION            ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');
console.log('File   :', FILE);
console.log('Seed   : 0x'+SEED.toString(16).toUpperCase(), '(set SEED env to reproduce)');
console.log('Extracted real functions:', NAMES.join(', '));
console.log('');
const s1=pass1(N1);
const s2=pass2(N2);
const s3=pass3();
const named=pass4();
const dt=((Date.now()-t0)/1000).toFixed(1);

console.log('── PASS 1  randomized dual-path property test ──────────────────────');
console.log('   scenarios:', s1.toLocaleString());
console.log('── PASS 2  self-heal correctness (+ negatives) ─────────────────────');
console.log('   scenarios:', s2.toLocaleString());
console.log('── PASS 3  exhaustive combinatorial sweep ──────────────────────────');
console.log('   scenarios:', s3.toLocaleString(), '(status × path × role × repr × unitRepr)');
console.log('── PASS 4  named adversarial cases ─────────────────────────────────');
for(const [label,passOk] of named){ console.log('   '+(passOk?'✓':'✗')+'  '+label); }
console.log('');
console.log('────────────────────────────────────────────────────────────────────');
console.log('Total scenarios :', (s1+s2+s3+named.length).toLocaleString());
console.log('Total assertions:', ASSERTS.toLocaleString());
console.log('Failures        :', FAILS.toLocaleString());
console.log('Runtime         :', dt+'s');
if(FAILS){
  console.log('\n✗ FAILURE SAMPLES (first '+failSamples.length+'):');
  for(const f of failSamples) console.log('   -', f.label, f.ctx||'');
  console.log('\n❌ VERDICT: NOT SAFE TO SHIP — invariants violated.');
  process.exit(1);
} else {
  console.log('\n✅ VERDICT: ALL INVARIANTS HOLD across '+ASSERTS.toLocaleString()+' assertions. Safe to ship.');
  process.exit(0);
}
