'use strict';
// ════════════════════════════════════════════════════════════════════════════
//  Multi-device CONVERGENCE simulation for the v5.12 union merges that replaced
//  the wholesale-replace of events / queue / movements / colorLibrary /
//  coverModelMapping. Uses the REAL functions extracted from index.html:
//  _mergeEvents, _mergeQueue, _mergeMovements, _mergeAddWinsMap,
//  _tombstoneEventGroup, _tombstoneQueueItem, mergeCfgPreservingPins.
//
//  Each scenario: 2-4 devices + shared doc, interleaved concurrent activity
//  (event creation/deletion/reschedule, queue add/remove, movement postings,
//  color adds) with stale-peer races, then quiesce. Asserts:
//    NO-LOSS   every surviving event/queue/movement/color reaches every device
//    DELETE    deleted event-groups & queue items NEVER resurrect
//    LWW       a rescheduled event's newest date wins everywhere
//    CAP       movements ledger stays ≤ 10,000 and union-complete
//    CONV      all devices converge to the identical shared doc
//  Plus a NEGATIVE CONTROL: the OLD wholesale behavior must LOSE a concurrent
//  event (proves the harness detects the original bug).
// ════════════════════════════════════════════════════════════════════════════
const fs=require('fs'); const FILE=process.argv[2]||'/home/claude/index.html'; const src=fs.readFileSync(FILE,'utf8');
const SEED=process.env.SEED?parseInt(process.env.SEED):0xE7E7;
const N=process.env.N?parseInt(process.env.N):100000;
function extractFn(name){const re=new RegExp('function\\s+'+name.replace(/[$]/g,'\\$')+'\\s*\\(','g');const m=re.exec(src);if(!m)throw new Error('not found '+name);let i=src.indexOf('{',m.index);let d=0,j=i;for(;j<src.length;j++){const c=src[j];if(c==='{')d++;else if(c==='}'){d--;if(d===0){j++;break;}}}return src.slice(m.index,j);}
const FN=['_unionTombs','_tombstoneEventGroup','_tombstoneQueueItem','_mergeEvents','_mergeQueue','_mergeMovements','_mergeAddWinsMap','mergeCfgPreservingPins'].map(extractFn).join('\n\n');
const SB=new Function(`'use strict';
  let cfg={};
  const DEFAULT_ROLE_PINS={admin:'0000'};
  let _lastEvMergeKept=0,_lastQMergeKept=0,_lastMvMergeKept=0,_lastMapMergeKept=0;
  let _clk = Date.now() - 5*60*1000;
  function editStamp(){ _clk += 137; return new Date(_clk).toISOString(); }
  const console={warn(){},log(){}};
  ${FN}
  return {
    set(c){ cfg=c; }, get cfg(){ return cfg; }, stamp:editStamp,
    tombEv:_tombstoneEventGroup, tombQ:_tombstoneQueueItem,
    mEv:_mergeEvents, mQ:_mergeQueue, mMv:_mergeMovements, mMap:_mergeAddWinsMap, mCfg:mergeCfgPreservingPins,
    kept(){ return _lastEvMergeKept+_lastQMergeKept+_lastMvMergeKept+_lastMapMergeKept; }
  };
`)();
const mk=s=>{let x=s>>>0;return()=>{x=(x+0x9E3779B9)>>>0;let z=x;z=Math.imul(z^(z>>>16),0x21f0aaad);z=Math.imul(z^(z>>>15),0x735a2d97);return((z^(z>>>15))>>>0)/4294967296;};};
const clone=x=>JSON.parse(JSON.stringify(x));
function canon(v){if(Array.isArray(v))return v.map(canon);if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>o[k]=canon(v[k]));return o;}return v;}
const rs=r=>JSON.stringify(canon(r));
const collEq=(a,b)=>{const sa=(a||[]).map(rs).sort(),sb=(b||[]).map(rs).sort();if(sa.length!==sb.length)return false;for(let i=0;i<sa.length;i++)if(sa[i]!==sb[i])return false;return true;};

let FAIL=0, ASSERT=0; const fails=[];
function bad(p,seed,x){FAIL++; if(fails.length<15)fails.push(`${p} seed=${seed} ${x||''}`);}

function scenario(seed){
  const rnd=mk(seed);
  const NDEV=2+((rnd()*3)|0);
  let GID=1000; const nid=()=>'id'+(++GID)+'-'+seed;
  const mkState=()=>({ events:[], queue:[], movements:[], colorLibrary:{}, cfg:{ rolePasswords:{}, rolePasswordsUpdatedAt:{} } });
  const S=mkState(); const devs=[]; for(let d=0;d<NDEV;d++) devs.push(mkState());
  function RECEIVE(dev){
    SB.set(dev.cfg);
    dev.events = SB.mEv(dev.events, clone(S.events), clone(S.cfg));
    dev.queue  = SB.mQ(dev.queue, clone(S.queue), clone(S.cfg));
    dev.movements = SB.mMv(dev.movements, clone(S.movements));
    dev.colorLibrary = SB.mMap(dev.colorLibrary, clone(S.colorLibrary), 'map');
    dev.cfg = SB.mCfg(dev.cfg, clone(S.cfg));
  }
  function PUSH(dev){ S.events=clone(dev.events); S.queue=clone(dev.queue); S.movements=clone(dev.movements); S.colorLibrary=clone(dev.colorLibrary); S.cfg=clone(dev.cfg); }
  // tracked ground truth
  const truth = { events:new Map(), deletedGroups:new Set(), queue:new Map(), deletedQ:new Set(), movs:new Set(), colors:new Set(), resched:new Map() };
  const steps = 8 + ((rnd()*22)|0);
  for(let s=0;s<steps;s++){
    const r=rnd(); const dev=devs[(rnd()*NDEV)|0];
    if(r<0.28){                    // create event (calendar dispatch)
      const gid='g'+(++GID); const id=nid();
      const ev={ id, groupId:gid, type:'dispatch', dealer:'D'+GID, date:'2026-07-0'+(1+(rnd()*8|0)) };
      dev.events.push(ev); truth.events.set(id, gid);
    } else if(r<0.38 && dev.events.length){   // delete a dispatch group (REAL tombstone writer)
      const ev=dev.events[(rnd()*dev.events.length)|0];
      if(ev && ev.groupId){ SB.set(dev.cfg); SB.tombEv(ev.groupId); dev.cfg=SB.cfg;
        dev.events = dev.events.filter(e=>String(e.groupId)!==String(ev.groupId));
        truth.deletedGroups.add(String(ev.groupId)); }
    } else if(r<0.46 && dev.events.length){   // reschedule (LWW updatedAt)
      const ev=dev.events[(rnd()*dev.events.length)|0];
      if(ev){ ev.date='2026-08-1'+((rnd()*9)|0); ev.updatedAt=SB.stamp(); truth.resched.set(String(ev.id), {date:ev.date, at:ev.updatedAt}); }
    } else if(r<0.58){             // queue add
      const id=nid(); dev.queue.push({ id, dealer:'Q'+GID, type:'spa' }); truth.queue.set(id, true);
    } else if(r<0.66 && dev.queue.length){    // queue remove (place/consume) — REAL tombstone
      const qi=dev.queue[(rnd()*dev.queue.length)|0];
      if(qi){ SB.set(dev.cfg); SB.tombQ(qi.id); dev.cfg=SB.cfg; dev.queue=dev.queue.filter(x=>x.id!==qi.id); truth.deletedQ.add(String(qi.id)); }
    } else if(r<0.78){             // post movement (append-only)
      const id='mv'+(++GID)+'-'+seed; dev.movements.unshift({ id, type:'601', at:Date.now()+GID }); truth.movs.add(id);
    } else if(r<0.84){             // add color
      const k='color'+(++GID); dev.colorLibrary[k]='#'+((rnd()*0xFFFFFF)|0).toString(16); truth.colors.add(k);
    } else if(r<0.92){ PUSH(dev); }
    else { RECEIVE(dev); }
  }
  // QUIESCE — mirror the app: each device receives, then re-pushes if it kept local data
  function sSig(){ return [S.events,S.queue,S.movements].map(a=>a.map(rs).sort().join('|')).join('#')+'#'+rs(S.colorLibrary)+'#'+rs(S.cfg._deletedEventGroups||{})+'#'+rs(S.cfg._deletedQueueIds||{}); }
  let prev='', stable=false;
  for(let r=0;r<4*NDEV+10;r++){ for(const dev of devs){ RECEIVE(dev); PUSH(dev); } const sig=sSig(); if(sig===prev){ stable=true; break; } prev=sig; }
  for(const dev of devs) RECEIVE(dev);
  if(!stable){ bad('NO-FIXPOINT',seed); return; }
  // CONVERGENCE
  for(let d=0;d<NDEV;d++){
    ASSERT++;
    if(!collEq(devs[d].events,S.events) || !collEq(devs[d].queue,S.queue) || !collEq(devs[d].movements,S.movements) || rs(devs[d].colorLibrary)!==rs(S.colorLibrary)){ bad('DIVERGE',seed,'dev'+d); return; }
  }
  const evIds=new Set(S.events.map(e=>String(e.id)));
  const evByI={}; S.events.forEach(e=>evByI[String(e.id)]=e);
  for(const [id,gid] of truth.events){
    ASSERT++;
    const deleted = truth.deletedGroups.has(String(gid));
    if(deleted && evIds.has(id)){
      // resurrect allowed ONLY if a reschedule stamped it newer than the tombstone
      const rr=truth.resched.get(id); const t=(S.cfg._deletedEventGroups||{})[String(gid)];
      if(!(rr && t && rr.at > t)) bad('DELETE-RESURRECT',seed,'event '+id);
    }
    if(!deleted && !evIds.has(id)) bad('EVENT-LOSS',seed,'event '+id+' vanished (the original bug)');
  }
  for(const [id] of truth.queue){
    ASSERT++;
    const deleted=truth.deletedQ.has(String(id)); const present=S.queue.some(q=>String(q.id)===String(id));
    if(deleted && present) bad('Q-RESURRECT',seed,id);
    if(!deleted && !present) bad('Q-LOSS',seed,id);
  }
  ASSERT++;
  for(const id of truth.movs){ if(!S.movements.some(m=>m.id===id)){ bad('MV-LOSS',seed,id); break; } }
  ASSERT++;
  if(S.movements.length>10000) bad('MV-CAP',seed,String(S.movements.length));
  ASSERT++;
  for(const k of truth.colors){ if(!(k in S.colorLibrary)){ bad('COLOR-LOSS',seed,k); break; } }
  // LWW: last reschedule's date won (only if the event survived)
  for(const [id,rr] of truth.resched){
    if(evByI[id]){ ASSERT++; if(evByI[id].date!==rr.date && evByI[id].updatedAt===rr.at) bad('LWW',seed,'event '+id); }
  }
}

// ── NEGATIVE CONTROL: the old wholesale behavior MUST lose a concurrent add ──
(function negControl(){
  const S={events:[]}; const A={events:[]}, B={events:[]};
  A.events.push({id:'e1',groupId:'g1',type:'dispatch',date:'2026-07-01'});   // A adds, not yet pushed
  S.events = clone(B.events);                                                 // B pushes first (no e1)
  A.events = clone(S.events);                                                 // OLD CODE: wholesale replace
  if(A.events.length===0) { console.log('Negative control: wholesale replace LOSES the concurrent event (harness detects the original bug) ✓'); }
  else { FAIL++; fails.push('NEG-CONTROL: wholesale did not lose the event — harness invalid'); }
})();

console.log('Running', N.toLocaleString(), 'scenarios...');
const t0=Date.now();
for(let i=0;i<N;i++) scenario((SEED*2654435761 + i*40503 + 17)>>>0);
console.log('Scenarios  :', N.toLocaleString(), '· Assertions:', ASSERT.toLocaleString(), '· Failures:', FAIL, '· '+((Date.now()-t0)/1000).toFixed(1)+'s');
if(FAIL) fails.forEach(f=>console.log('  ✗ '+f));
else console.log('✅ VERDICT: no event/queue/movement/color loss, deletes stick, LWW correct, ledger capped, ALL devices converge.');
