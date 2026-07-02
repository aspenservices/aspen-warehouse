'use strict';
// Validates the v5.05 fix: a dispatched S/N-less factory accessory/cover must NOT be
// resurrected by a stale remote merge, while the dispatched record persists. Uses the
// REAL _mergeFactory + _mergeDispatched. Includes a negative control (no tombstone →
// must resurrect) to prove the test is meaningful, plus an undo-survives case.
const fs=require('fs'); const FILE=process.argv[2]||'/home/claude/index.html'; const src=fs.readFileSync(FILE,'utf8');
function extractFn(name){const re=new RegExp('function\\s+'+name.replace(/[$]/g,'\\$')+'\\s*\\(','g');const m=re.exec(src);let i=src.indexOf('{',m.index);let d=0,j=i;for(;j<src.length;j++){const c=src[j];if(c==='{')d++;else if(c==='}'){d--;if(d===0){j++;break;}}}return src.slice(m.index,j);}
const SB=new Function(`'use strict';
  let cfg={_deletedUnits:{}},nid=5000,units=[],dispatched=[];
  let _lastFacMergeKept=0,_lastDispMergeKept=0;
  const console={warn(){},log(){}};
  ${extractFn('_mergeFactory')}
  ${extractFn('_mergeDispatched')}
  return { set(o){if('cfg'in o)cfg=o.cfg;if('units'in o)units=o.units;if('dispatched'in o)dispatched=o.dispatched;}, _mergeFactory,_mergeDispatched };
`)();
const clone=x=>JSON.parse(JSON.stringify(x));
const iso=n=>new Date(1700000000000+n*1000).toISOString();
const facKey=f=>(f.sn!=null&&String(f.sn).trim()!=='')?'sn:'+String(f.sn).trim():'id:'+f.id;

let PASS=0, FAIL=0; const fails=[];
function check(cond,label){ if(cond)PASS++; else {FAIL++; if(fails.length<15)fails.push(label);} }

// ── Scenario builder: device A dispatches a factory row; device B is STALE (still has it) ──
function scenario({withTombstone, sn, type, undo}){
  const id=5001, t0=10, tDispatch=20, tUndo=30;
  // The factory row both devices originally had (synced)
  const row = { id, sn:sn||'', dealer:'Fisher Pools', type:type||'accessory', trackingState:'ready-for-pickup', updatedAt:iso(t0) };
  // Device A AFTER dispatch: factory row removed, dispatched record added, tombstone (if fixed)
  const A = { factory:[], dispatched:[{ id:9001, sn:sn||'', dealer:'Fisher Pools', type:type||'accessory', dispatchedAt:iso(tDispatch), trackingState:'dispatched-from-factory', via:'dealer-pickup-at-factory' }],
              cfg:{ _deletedUnits: withTombstone ? { [facKey(row)]: iso(tDispatch) } : {} } };
  if(undo){ // device A later UNDID the dispatch: row re-added with a NEWER updatedAt, dispatched removed
    A.factory=[{ ...clone(row), trackingState:'ready-for-pickup', updatedAt:iso(tUndo) }];
    A.dispatched=[];
  }
  // Device B STALE: still has the original factory row, no dispatch, no tombstone
  const B = { factory:[clone(row)], dispatched:[], cfg:{ _deletedUnits:{} } };
  // A receives B's stale push → merge (orchestrator order: dispatched first, then factory)
  SB.set({ cfg:A.cfg, units:[], dispatched:A.dispatched });
  const mergedDispatched = SB._mergeDispatched(clone(A.dispatched), clone(B.dispatched));
  SB.set({ cfg:A.cfg, units:[], dispatched:mergedDispatched });   // factory reads global dispatched
  const mergedFactory = SB._mergeFactory(clone(A.factory), clone(B.factory), [], clone(B.cfg));
  return { mergedFactory, mergedDispatched, rowKey:facKey(row) };
}

// TEST 1 — THE FIX: S/N-less accessory dispatched WITH tombstone → must NOT resurrect; dispatched persists
{
  const r=scenario({withTombstone:true, sn:'', type:'accessory'});
  check(!r.mergedFactory.some(f=>facKey(f)===r.rowKey), 'T1 accessory resurrected despite tombstone');
  check(r.mergedDispatched.length===1, 'T1 dispatched record lost');
}
// TEST 2 — NEGATIVE CONTROL: same WITHOUT tombstone → MUST resurrect (proves bug + test validity)
{
  const r=scenario({withTombstone:false, sn:'', type:'accessory'});
  check(r.mergedFactory.some(f=>facKey(f)===r.rowKey), 'T2 control: accessory did NOT resurrect (test not meaningful)');
}
// TEST 3 — spa WITH S/N dispatched: protected by dispatchedOutSns even pre-fix; tombstone also fine
{
  const r=scenario({withTombstone:true, sn:'30999', type:'spa'});
  check(!r.mergedFactory.some(f=>facKey(f)===r.rowKey), 'T3 serialized spa resurrected');
}
// TEST 4 — UNDO survives the tombstone: re-added row has newer updatedAt → must remain
{
  const r=scenario({withTombstone:true, sn:'', type:'accessory', undo:true});
  check(r.mergedFactory.some(f=>facKey(f)===r.rowKey), 'T4 undo wiped by stale tombstone (re-add should survive)');
}
// TEST 5 — randomized fuzz: many ids/sn/type combos, tombstone always prevents resurrection
let fuzz=0;
function mk(s){let x=s>>>0;return()=>{x=(x+0x9E3779B9)>>>0;let z=x;z=Math.imul(z^(z>>>16),0x21f0aaad);z=Math.imul(z^(z>>>15),0x735a2d97);return((z^(z>>>15))>>>0)/4294967296;};}
const rnd=mk(0xF00D);
for(let i=0;i<50000;i++){
  const hasSn = rnd()<0.5;
  const sn = hasSn ? ('SN'+((rnd()*50)|0)) : '';
  const type = rnd()<0.5 ? 'accessory' : (rnd()<0.5?'misc':'spa');
  const r=scenario({withTombstone:true, sn, type});
  // With a tombstone the row must never survive (regardless of sn/type)
  if(r.mergedFactory.some(f=>facKey(f)===r.rowKey)){ FAIL++; if(fails.length<15)fails.push('FUZZ resurrect sn='+sn+' type='+type); }
  else fuzz++;
  if(r.mergedDispatched.length!==1){ FAIL++; if(fails.length<15)fails.push('FUZZ dispatched lost'); }
}
PASS+=fuzz;

console.log('═══ FACTORY-RESURRECTION FIX VALIDATION ═══');
console.log('Checks passed :', PASS.toLocaleString());
console.log('Failures      :', FAIL);
if(FAIL){ fails.forEach(f=>console.log('  ✗ '+f)); }
else console.log('✅ tombstone blocks stale-remote resurrection for accessories/covers; dispatched persists; undo survives; spas unaffected.');
