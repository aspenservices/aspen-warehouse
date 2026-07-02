'use strict';
// ════════════════════════════════════════════════════════════════════════════
//  Aspen Warehouse — Firebase SYNC convergence simulator
//  Models the REAL protocol: PUSH = (S = L_full);  RECEIVE = (L = merge(L,S)).
//  Tests, against the REAL extracted merge functions:
//    P1 IDEMPOTENCY  merge(merge(L,S),S) == merge(L,S)
//    P2 NO-LOSS      every (non-tombstoned) key in L∪S survives merge(L,S)
//    P3 CONVERGENCE  N devices + shared doc, random interleaved edits, quiesce →
//                    every device's state == shared doc == each other
// ════════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const FILE = process.argv[2] || '/home/claude/index.html';
const SEED = process.env.SEED ? parseInt(process.env.SEED) : 0x5;
const N_CONV = process.env.NCONV ? parseInt(process.env.NCONV) : 60000;
const N_IDEM = process.env.NIDEM ? parseInt(process.env.NIDEM) : 40000;
const src = fs.readFileSync(FILE, 'utf8');

// ── Extract a top-level function (brace-balanced) by name ──
function extractFn(name){
  const re = new RegExp('function\\s+' + name.replace(/[$]/g,'\\$') + '\\s*\\(', 'g');
  const m = re.exec(src);
  if(!m){ throw new Error('fn not found: ' + name); }
  let i = src.indexOf('{', m.index); let depth = 0, j = i;
  for(; j < src.length; j++){ const c = src[j]; if(c === '{') depth++; else if(c === '}'){ depth--; if(depth === 0){ j++; break; } } }
  return src.slice(m.index, j);
}
const FN_NAMES = ['mergeCfgPreservingPins','_mergeUnits','_mergeMatTransfers','_mergeMaterials',
  '_mergeRequests','_mergeIncoming','_mergeDispatched','_mergeFactory','_mergeCovers','_mergeMarriages'];
const fnSrc = FN_NAMES.map(extractFn).join('\n\n');

// ── Sandbox: mutable globals the merges read/write ──
const sandboxFactory = new Function(`
  'use strict';
  let cfg = {}, nid = 1000, units = [], dispatched = [];
  const DEFAULT_ROLE_PINS = {admin:'0000',warehouse:'0000',factory:'0000',marriages:'0000',transit:'0000',organizer:'0000',viewer:'0000'};
  let _lastMergeKept=0,_lastReqMergeKept=0,_lastIncMergeKept=0,_lastFacMergeKept=0,_lastCoverMergeKept=0,_lastMarMergeKept=0,_lastDispMergeKept=0;
  const console = { warn(){}, log(){}, error(){} };
  ${fnSrc}
  return {
    setGlobals(o){ if('cfg' in o) cfg=o.cfg; if('nid' in o) nid=o.nid; if('units' in o) units=o.units; if('dispatched' in o) dispatched=o.dispatched; },
    getNid(){ return nid; },
    getKept(){ return {u:_lastMergeKept,r:_lastReqMergeKept,i:_lastIncMergeKept,f:_lastFacMergeKept,c:_lastCoverMergeKept,m:_lastMarMergeKept}; },
    mergeCfgPreservingPins,_mergeUnits,_mergeMatTransfers,_mergeMaterials,_mergeRequests,
    _mergeIncoming,_mergeDispatched,_mergeFactory,_mergeCovers,_mergeMarriages
  };
`);
const SB = sandboxFactory();

// ── Deterministic PRNG ──
function mk(seed){ let s = seed>>>0; return function(){ s = (s + 0x9E3779B9) >>> 0; let z = s; z = Math.imul(z ^ (z>>>16), 0x21f0aaad); z = Math.imul(z ^ (z>>>15), 0x735a2d97); return ((z ^ (z>>>15))>>>0)/4294967296; }; }
const clone = x => JSON.parse(JSON.stringify(x));
function canon(v){ // recursively sort object keys → stable JSON
  if(Array.isArray(v)) return v.map(canon);
  if(v && typeof v === 'object'){ const o={}; Object.keys(v).sort().forEach(k=>o[k]=canon(v[k])); return o; }
  return v;
}
const recSig = r => JSON.stringify(canon(r));
function collEqual(a, b){ // same multiset of records (order-independent)
  const sa = (a||[]).map(recSig).sort(), sb = (b||[]).map(recSig).sort();
  if(sa.length !== sb.length) return false;
  for(let i=0;i<sa.length;i++) if(sa[i] !== sb[i]) return false;
  return true;
}
const isoOf = n => new Date(1700000000000 + n*1000).toISOString();
// Upsert: enforce the app's invariant that ONE device's collection holds at most
// one record per logical key (one S/N = one tub, one logical id = one row). The
// merges are NOT contracted to de-dupe keys already duplicated within a single
// device's array — that's upstream corruption — so the generators must not create it.
function upsert(arr, rec, keyFn){ const k = keyFn(rec); for(let i=0;i<arr.length;i++){ if(keyFn(arr[i])===k){ arr[i]=rec; return; } } arr.push(rec); }
   // monotonic clk → ISO

// ════════════════════════════════════════════════════════════════════════════
//  Per-collection drivers: keyOf (for asserts), genAdd, mutate, the merge call,
//  whether it supports tombstone-delete (units/factory), and reading kept count.
// ════════════════════════════════════════════════════════════════════════════
const SN_POOL = ['SN0','SN1','SN2','SN3','SN4'];
const COLORS = ['gray','blue']; const MODELS = ['8ft','7ft']; const SRC=['warehouse','factory'];
const MATNAMES = ['filter','jets']; const CATS=['chem','parts'];

function pick(rnd, arr){ return arr[(rnd()*arr.length)|0]; }

const DRIVERS = {
  units: {
    tomb: true,
    keyOf: u => (u.sn!=null&&String(u.sn).trim()!=='')?'sn:'+String(u.sn).trim():'id:'+u.id,
    gen: (rnd, clk, idgen) => ({ id: idgen(), sn: pick(rnd,SN_POOL), pos: (rnd()*20)|0, level:(rnd()*3)|0, updatedAt: isoOf(clk) }),
    mutate: (r, rnd, clk) => { r.pos=(rnd()*20)|0; r.updatedAt=isoOf(clk); },
    merge: (SBx, Lc, Sc, Sfull) => SBx._mergeUnits(Lc, Sc, Sfull),
  },
  factory: {
    tomb: true,
    keyOf: f => (f.sn!=null&&String(f.sn).trim()!=='')?'sn:'+String(f.sn).trim():'id:'+f.id,
    gen: (rnd, clk, idgen) => ({ id: idgen(), sn: pick(rnd,SN_POOL), type:'spa', trackingState: pick(rnd,['created-at-factory','ready-to-ship','in-transit','received-back-at-factory']), transitDir: pick(rnd,['to-warehouse','to-factory']), color: pick(rnd,COLORS), updatedAt: isoOf(clk) }),
    mutate: (r, rnd, clk) => { r.color=pick(rnd,COLORS); r.updatedAt=isoOf(clk); },
    merge: (SBx, Lc, Sc, Sfull) => SBx._mergeFactory(Lc, Sc, [], Sfull.cfg),
  },
  marriages: {
    tomb: false,
    keyOf: m => { const sn=(m.spaSn!=null&&String(m.spaSn).trim()!=='')?String(m.spaSn).trim():''; const acc=(m.accessoryId!=null&&m.accessoryId!=='')?'a'+m.accessoryId:(m.accessoryName||''); return (sn||acc)?'m:'+sn+'|'+acc:'id:'+m.id; },
    gen: (rnd, clk, idgen) => ({ id: idgen(), spaSn: pick(rnd,SN_POOL), accessoryId: (rnd()*3)|0, status: pick(rnd,['pending','ready-to-ship','in-transit','delivered','completed']), updatedAt: isoOf(clk) }),
    mutate: (r, rnd, clk) => { r.status=pick(rnd,['pending','ready-to-ship','delivered','completed']); r.updatedAt=isoOf(clk); },
    merge: (SBx, Lc, Sc) => SBx._mergeMarriages(Lc, Sc),
  },
  incoming: {
    tomb: false,
    keyOf: it => (it.sn!=null&&String(it.sn).trim()!=='')?'sn:'+String(it.sn).trim():(it.id!=null?'id:'+it.id:null),
    gen: (rnd, clk, idgen) => ({ id: idgen(), sn: pick(rnd,SN_POOL), status: pick(rnd,['pending','arrived']), updatedAt: isoOf(clk) }),
    mutate: (r, rnd, clk) => { r.status=pick(rnd,['pending','arrived']); r.updatedAt=isoOf(clk); },
    merge: (SBx, Lc, Sc) => SBx._mergeIncoming(Lc, Sc),
  },
  dispatched: {
    tomb: false,
    keyOf: d => { const sn=(d.sn!=null&&String(d.sn).trim()!=='')?String(d.sn).trim():null; return (sn&&d.dispatchedAt)?'d:'+sn+'@'+d.dispatchedAt:(d.id!=null?'id:'+d.id:null); },
    gen: (rnd, clk, idgen) => ({ id: idgen(), sn: pick(rnd,SN_POOL), dispatchedAt: isoOf((clk%3)+1), deliveryStatus: pick(rnd,['out','delivered','returned']), updatedAt: isoOf(clk) }),
    mutate: (r, rnd, clk) => { r.deliveryStatus=pick(rnd,['out','delivered','returned']); r.updatedAt=isoOf(clk); },
    merge: (SBx, Lc, Sc) => SBx._mergeDispatched(Lc, Sc),
  },
  matTransfers: {
    tomb: false,
    keyOf: t => 'id:'+t.id,
    gen: (rnd, clk, idgen) => { const id=idgen(); return { id, status: pick(rnd,['requested','in-transit','arrived','cancelled']), requestedAt: isoOf(clk), shippedAt: isoOf(clk), arrivedAt: isoOf(clk) }; },
    mutate: (r, rnd, clk) => { const order=['requested','in-transit','arrived']; r.status=pick(rnd,order); r.arrivedAt=isoOf(clk); },
    merge: (SBx, Lc, Sc) => SBx._mergeMatTransfers(Lc, Sc),
  },
  materials: {
    tomb: false,
    keyOf: m => (String(m.cat||'other').trim().toLowerCase())+'\u0000'+(String(m.source||'warehouse').trim().toLowerCase())+'\u0000'+(String(m.name||'').trim().toLowerCase()),
    gen: (rnd, clk, idgen) => ({ cat: pick(rnd,CATS), source: pick(rnd,SRC), name: pick(rnd,MATNAMES), qty: (rnd()*10)|0, updated: isoOf(clk), history:[{t:isoOf(clk), type:'recv', qty:(rnd()*5)|0, who:'x'}] }),
    mutate: (r, rnd, clk) => { r.qty=(rnd()*10)|0; r.updated=isoOf(clk); (r.history=r.history||[]).push({t:isoOf(clk),type:'adj',qty:(rnd()*3)|0,who:'y'}); },
    merge: (SBx, Lc, Sc) => SBx._mergeMaterials(Lc, Sc),
  },
  requests: {
    tomb: false,
    keyOf: r => { if(!r.requestedAt) return 'id:'+r.id; const k=(r.sn!=null&&String(r.sn).trim()!=='')?String(r.sn).trim():(r.description||''); return 'sig:'+[r.requestedAt,r.type||'',k].join('|'); },
    gen: (rnd, clk, idgen) => ({ id: idgen(), requestedAt: isoOf((clk%4)+1), type:'tub', sn: pick(rnd,SN_POOL), status: pick(rnd,['pending','approved','shipped','received']), notes:'', notesUpdatedAt:'' }),
    mutate: (r, rnd, clk) => { if(rnd()<0.5){ r.status=pick(rnd,['pending','approved','loading-bay','shipped','received']); } else { r.notes='n'+clk; r.notesUpdatedAt=isoOf(clk); } },
    merge: (SBx, Lc, Sc) => SBx._mergeRequests(Lc, Sc),
  },
  covers: {
    tomb: false,
    keyOf: c => [String(c.color||'').trim().toLowerCase(),String(c.model||'').trim().toLowerCase(),String(c.source||'warehouse').trim().toLowerCase()].join('|'),
    gen: (rnd, clk, idgen) => ({ color: pick(rnd,COLORS), model: pick(rnd,MODELS), source: pick(rnd,SRC), qty: 3+((rnd()*5)|0), history:[], pending:[], updated: isoOf(clk) }),
    mutate: (r, rnd, clk) => {
      const roll = rnd();
      if(roll < 0.45){ // decrement (idempotent per spaSn)
        const spaSn = 'D'+((rnd()*6)|0);
        if(!(r.history||[]).some(e=>e.action==='decrement'&&String(e.spaSn)===spaSn)){
          r.qty = Math.max(0, (r.qty||0)-1); (r.history=r.history||[]).push({action:'decrement', spaSn, at:isoOf(clk)});
        }
      } else if(roll < 0.75){ // arrival (idempotent per mid, carries qty)
        const mid = 'M'+clk; const q = 1+((rnd()*4)|0);
        if(!(r.history||[]).some(e=>e.action==='arrival'&&e.mid===mid)){ r.qty=(r.qty||0)+q; (r.history=r.history||[]).push({action:'arrival', mid, qty:q, at:isoOf(clk)}); }
      } else { // manual +1 (not uniquely keyable)
        r.qty=(r.qty||0)+1; (r.history=r.history||[]).push({action:'increment', mid:'I'+clk, at:isoOf(clk)});
      }
      r.updated = isoOf(clk);
    },
    merge: (SBx, Lc, Sc) => SBx._mergeCovers(Lc, Sc),
  },
};

// ════════════════════════════════════════════════════════════════════════════
let FAIL = 0, ASSERT = 0;
const fails = [];
function fail(coll, prop, scenarioSeed, extra){ FAIL++; if(fails.length<25) fails.push(`[${coll}] ${prop} seed=${scenarioSeed} ${extra||''}`); }

// ── P1 + P2: idempotency & no-loss on random L,S pairs ──
function genColl(D, rnd, clk, idgen, n){ const a=[]; for(let i=0;i<n;i++) upsert(a, D.gen(rnd,clk(),idgen), D.keyOf); return a; }

function runIdem(coll, scenarioSeed){
  const D = DRIVERS[coll];
  const rnd = mk(scenarioSeed);
  let c = 1; const clk = () => c++;
  let idc = 1000; const idgen = () => ++idc;
  const L = genColl(D, rnd, clk, idgen, 1+((rnd()*5)|0));
  const S = genColl(D, rnd, clk, idgen, 1+((rnd()*5)|0));
  // sometimes share keys deliberately by copying a few S records into L with edits
  if(rnd()<0.7 && S.length){ const r = clone(S[(rnd()*S.length)|0]); D.mutate(r, rnd, clk()); upsert(L, r, D.keyOf); } // shared key, newer local edit
  if(rnd()<0.4 && S.length){ const r = clone(S[(rnd()*S.length)|0]); upsert(L, r, D.keyOf); } // shared key, exact tie
  const Sfull = { cfg:{ _deletedUnits:{} }, factory:[], units:[], dispatched:[], incoming:[], marriages:[] };
  Sfull[coll] = S;
  // tombstones for tomb collections (~30%)
  if(D.tomb && rnd()<0.3 && (L.length||S.length)){ const victim = (L.concat(S))[(rnd()* (L.length+S.length))|0]; if(victim){ Sfull.cfg._deletedUnits[D.keyOf(victim)] = isoOf(clk()); } }

  SB.setGlobals({ cfg: clone(Sfull.cfg), nid: idc, units: coll==='factory'?[]:[], dispatched: [] });
  const A = D.merge(SB, clone(L), clone(S), clone(Sfull));
  SB.setGlobals({ cfg: clone(Sfull.cfg), nid: SB.getNid(), units: [], dispatched: [] });
  const B = D.merge(SB, clone(A), clone(S), clone(Sfull));
  ASSERT++;
  if(!collEqual(A, B)){ fail(coll,'IDEMPOTENCY',scenarioSeed, `|A|=${A.length} |B|=${B.length}`); }

  // P2 no-loss: every key present in L or S survives in A, unless tombstoned
  const tomb = (D.tomb && Sfull.cfg._deletedUnits) ? Sfull.cfg._deletedUnits : {};
  const presentKeys = new Set(A.map(D.keyOf));
  const wantKeys = new Set([...L.map(D.keyOf), ...S.map(D.keyOf)]);
  for(const k of wantKeys){
    if(k==null) continue;
    // skip keys legitimately dropped: tombstoned, OR (units/factory) accounted elsewhere — not modeled here, so only check tomb
    if(tomb[k]) continue;
    ASSERT++;
    if(!presentKeys.has(k)){ fail(coll,'NO-LOSS',scenarioSeed,`missing ${k}`); break; }
  }
}

// ── P3: multi-device convergence under the real protocol ──
function runConverge(scenarioSeed){
  const rnd = mk(scenarioSeed);
  const NDEV = 2 + ((rnd()*3)|0);   // 2..4 devices
  // choose a subset of collections to exercise this scenario (1..3 for speed/variety)
  const allColls = Object.keys(DRIVERS);
  const nColl = 1 + ((rnd()*3)|0);
  const colls = [];
  for(let i=0;i<nColl;i++){ const c = pick(rnd, allColls); if(!colls.includes(c)) colls.push(c); }

  let clk = 1; const tick = (tie) => tie ? clk : ++clk;   // tie reuses current clk
  let GID = 5000; const idgen = () => ++GID;

  // shared doc
  const S = { cfg: { _deletedUnits:{}, rolePasswords:{}, rolePasswordsUpdatedAt:{} } };
  colls.forEach(c => S[c] = []);
  // devices: each has its own state incl. cfg
  const devs = [];
  for(let d=0; d<NDEV; d++){ const st = { cfg: { _deletedUnits:{}, rolePasswords:{}, rolePasswordsUpdatedAt:{} } }; colls.forEach(c=>st[c]=[]); devs.push(st); }

  // seed shared doc with a few records per collection
  colls.forEach(c => { const D=DRIVERS[c]; const n=(rnd()*3)|0; for(let i=0;i<n;i++) upsert(S[c], D.gen(rnd, tick(), idgen), D.keyOf); });
  // each device starts by pulling S
  devs.forEach(dev => RECEIVE(dev, S, colls));

  function PUSH(dev){ colls.forEach(c => S[c] = clone(dev[c])); S.cfg = clone(dev.cfg); }
  function RECEIVE(dev, shared, colls){
    // replicate orchestrator order & global wiring
    SB.setGlobals({ cfg: dev.cfg, nid: GID, units: dev.units||[], dispatched: dev.dispatched||[] });
    if(colls.includes('units'))        dev.units = SB._mergeUnits(dev.units, clone(shared.units), clone(shared));
    if(colls.includes('dispatched'))   dev.dispatched = SB._mergeDispatched(dev.dispatched, clone(shared.dispatched));
    if(colls.includes('incoming'))     dev.incoming = SB._mergeIncoming(dev.incoming, clone(shared.incoming));
    if(colls.includes('materials'))    dev.materials = SB._mergeMaterials(dev.materials, clone(shared.materials));
    if(colls.includes('matTransfers')) dev.matTransfers = SB._mergeMatTransfers(dev.matTransfers, clone(shared.matTransfers));
    // refresh globals so factory sees reconciled units/dispatched
    SB.setGlobals({ cfg: dev.cfg, nid: SB.getNid(), units: dev.units||[], dispatched: dev.dispatched||[] });
    if(colls.includes('factory'))      dev.factory = SB._mergeFactory(dev.factory, clone(shared.factory), dev.incoming||[], clone(shared.cfg));
    if(colls.includes('marriages'))    dev.marriages = SB._mergeMarriages(dev.marriages, clone(shared.marriages));
    if(colls.includes('requests'))     dev.requests = SB._mergeRequests(dev.requests, clone(shared.requests));
    if(colls.includes('covers'))       dev.covers = SB._mergeCovers(dev.covers, clone(shared.covers));
    dev.cfg = SB.mergeCfgPreservingPins(dev.cfg, clone(shared.cfg));
    GID = SB.getNid();
  }

  // random interleaved activity
  const STEPS = 6 + ((rnd()*18)|0);
  for(let s=0; s<STEPS; s++){
    const dev = devs[(rnd()*NDEV)|0];
    const c = pick(rnd, colls); const D = DRIVERS[c];
    const act = rnd();
    if(act < 0.4 || dev[c].length === 0){           // ADD (upsert: unique key per device)
      upsert(dev[c], D.gen(rnd, tick(rnd()<0.12), idgen), D.keyOf);
    } else if(act < 0.8){                            // UPDATE existing
      const r = dev[c][(rnd()*dev[c].length)|0];
      D.mutate(r, rnd, tick(rnd()<0.12));
    } else if(D.tomb){                                // DELETE (tombstone) — units/factory only
      const i = (rnd()*dev[c].length)|0; const r = dev[c][i];
      dev.cfg._deletedUnits[D.keyOf(r)] = isoOf(tick());
      dev[c].splice(i,1);
    } else {                                          // non-tomb: treat as another update
      const r = dev[c][(rnd()*dev[c].length)|0]; D.mutate(r, rnd, tick(rnd()<0.12));
    }
    // randomly push or receive to interleave
    if(rnd() < 0.5) PUSH(dev);
    else RECEIVE(devs[(rnd()*NDEV)|0], S, colls);
  }

  // ── QUIESCE: rounds of (everyone RECEIVE then PUSH) until S signature stable ──
  function sSig(){ return colls.map(c => (S[c]||[]).map(recSig).sort().join('|')).join('#') + '##' + recSig(S.cfg._deletedUnits||{}); }
  const maxRounds = 4*NDEV + 6;
  let stable = false, prev = '';
  for(let r=0; r<maxRounds; r++){
    for(const dev of devs){ RECEIVE(dev, S, colls); PUSH(dev); }
    const sig = sSig();
    if(sig === prev){ stable = true; break; }
    prev = sig;
  }
  // one more settle: everyone receive final S
  for(const dev of devs) RECEIVE(dev, S, colls);

  if(!stable){ fail('multi','CONVERGENCE(no-fixpoint)',scenarioSeed, `colls=${colls.join(',')} dev=${NDEV}`); return; }
  // assert every device == S for each exercised collection
  for(const c of colls){
    for(let d=0; d<NDEV; d++){
      ASSERT++;
      if(!collEqual(devs[d][c], S[c])){ fail('multi','CONVERGENCE-DIVERGE',scenarioSeed, `coll=${c} dev${d} (|dev|=${devs[d][c].length} |S|=${S[c].length})`); break; }
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('════════════════════════════════════════════════════════════════════');
console.log(' FIREBASE SYNC CONVERGENCE SIM —', FILE);
console.log(' base seed', '0x'+SEED.toString(16), '· extracted', FN_NAMES.length, 'merge fns');
console.log('════════════════════════════════════════════════════════════════════');
const t0 = Date.now();
const colls = Object.keys(DRIVERS);
// P1/P2 idempotency + no-loss across all collections
let idemEach = Math.floor(N_IDEM / colls.length);
for(const c of colls){ for(let i=0;i<idemEach;i++) runIdem(c, (SEED*2654435761 + i*40503 + c.length*7919)>>>0); }
console.log(`P1+P2  idempotency & no-loss : ${idemEach*colls.length} scenarios across ${colls.length} collections`);
// P3 convergence
for(let i=0;i<N_CONV;i++) runConverge((SEED*40503 + i*2654435761 + 17)>>>0);
console.log(`P3     multi-device converge  : ${N_CONV} scenarios (2–4 devices, random collection subsets)`);
const secs = ((Date.now()-t0)/1000).toFixed(1);

console.log('');
console.log('────────────────────────────────────────────────────────────────────');
console.log('Total assertions :', ASSERT.toLocaleString());
console.log('Failures         :', FAIL);
console.log('Runtime          :', secs + 's');
if(FAIL){ console.log('\nFIRST FAILURES:'); fails.forEach(f=>console.log('  ✗ '+f)); }
else console.log('\n✅ VERDICT: every merge is idempotent, lossless, and all devices CONVERGE.');
