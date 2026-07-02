'use strict';
// ════════════════════════════════════════════════════════════════════════════
//  v5.14 — spa RETURN / DELIVERY-CONFIRMATION convergence.
//  The old _mergeDispatched let a STALE peer's 'out' copy revert a fresh
//  'returned' status; dispatchedOutSns then re-included the S/N and the next
//  _mergeFactory DROPPED the returned tub's factory row — the tub vanished.
//  Uses the REAL _mergeDispatched + _mergeFactory. Validates:
//   T1 negative control: an UNSTAMPED return still reverts (proves the stamp is
//      what protects, and the harness detects the failure chain end-to-end)
//   T2 the fix: stamped return survives a stale push; factory row survives
//   T3 stamped delivery confirmation survives a stale push
//   T4 legacy propagation intact: stamped remote update beats unstamped local
//   T5 fuzz: multi-device races → convergence, no returned tub ever vanishes
// ════════════════════════════════════════════════════════════════════════════
const fs=require('fs'); const FILE=process.argv[2]||'index.html'; const src=fs.readFileSync(FILE,'utf8');
function extractFn(name){const re=new RegExp('function\\s+'+name.replace(/[$]/g,'\\$')+'\\s*\\(','g');const m=re.exec(src);if(!m)throw new Error('not found '+name);let i=src.indexOf('{',m.index);let d=0,j=i;for(;j<src.length;j++){const c=src[j];if(c==='{')d++;else if(c==='}'){d--;if(d===0){j++;break;}}}return src.slice(m.index,j);}
const SB=new Function(`'use strict';
  let cfg={_deletedUnits:{}}, units=[], dispatched=[];
  let _lastDispMergeKept=0, _lastFacMergeKept=0;
  let _clk = Date.now() - 5*60*1000;
  function editStamp(){ _clk += 137; return new Date(_clk).toISOString(); }
  const console={warn(){},log(){}};
  ${extractFn('_mergeDispatched')}
  ${extractFn('_mergeFactory')}
  return {
    set(o){ if('cfg'in o)cfg=o.cfg; if('units'in o)units=o.units; if('dispatched'in o)dispatched=o.dispatched; },
    stamp:editStamp, mD:_mergeDispatched, mF:_mergeFactory,
    dispKept(){ return _lastDispMergeKept; }
  };
`)();
const clone=x=>JSON.parse(JSON.stringify(x));
const mk=s=>{let x=s>>>0;return()=>{x=(x+0x9E3779B9)>>>0;let z=x;z=Math.imul(z^(z>>>16),0x21f0aaad);z=Math.imul(z^(z>>>15),0x735a2d97);return((z^(z>>>15))>>>0)/4294967296;};};
const rs=r=>JSON.stringify(r,Object.keys(r).sort?undefined:undefined);
const canon=v=>Array.isArray(v)?v.map(canon):(v&&typeof v==='object'?Object.keys(v).sort().reduce((o,k)=>(o[k]=canon(v[k]),o),{}):v);
const collEq=(a,b)=>{const sa=(a||[]).map(x=>JSON.stringify(canon(x))).sort(),sb=(b||[]).map(x=>JSON.stringify(canon(x))).sort();return sa.length===sb.length&&sa.every((v,i)=>v===sb[i]);};
let PASS=0,FAIL=0; const fails=[];
const chk=(c,l)=>{ if(c)PASS++; else {FAIL++; if(fails.length<12)fails.push(l);} };

// A "world": dispatched record for sn=X shared everywhere; A processes the return.
function mkRec(sn){ return { id: 700+Number(sn.slice(-2)||0), sn, dealer:'Dealer'+sn, type:'hot', dispatchedAt:'2026-06-01', deliveryStatus:'out' }; }
function doReturn(dev, sn, stamped){
  const rec = dev.dispatched.find(d=>d.sn===sn); if(!rec) return;
  rec.deliveryStatus='returned';
  if(stamped) rec.updatedAt = SB.stamp();
  rec.returnedAt='2026-06-20'; rec.returnedTo='factory';
  dev.factory.push({ id: 9000+Number(sn.slice(-2)||0), sn, dealer:rec.dealer, type:'hot', isReturn:true, trackingState:'received-back-at-factory', updatedAt: SB.stamp() });
}
function doDeliver(dev, sn){
  const rec = dev.dispatched.find(d=>d.sn===sn); if(!rec) return;
  rec.deliveryStatus='delivered-to-dealer'; rec.updatedAt = SB.stamp(); rec.deliveryConfirmedAt='2026-06-21T10:00:00';
}
// RECEIVE mirrors the app's orchestrator order: dispatched first, then factory
// (factory reads the just-merged global dispatched for its staleness rules).
function RECEIVE(dev, S){
  SB.set({cfg:dev.cfg, units:[], dispatched:dev.dispatched});
  dev.dispatched = SB.mD(dev.dispatched, clone(S.dispatched));
  SB.set({cfg:dev.cfg, units:[], dispatched:dev.dispatched});
  dev.factory = SB.mF(dev.factory, clone(S.factory), [], clone(S.cfg));
}
function PUSH(dev, S){ S.dispatched=clone(dev.dispatched); S.factory=clone(dev.factory); S.cfg=clone(dev.cfg); }

// ── T1 NEGATIVE CONTROL: UNSTAMPED return → stale 'out' reverts it, and the
//    returned tub's factory row is DROPPED by the next factory merge (the chain).
{
  const S={dispatched:[],factory:[],cfg:{_deletedUnits:{}}};
  const A={dispatched:[mkRec('31066')],factory:[],cfg:{_deletedUnits:{}}};
  const B={dispatched:[mkRec('31066')],factory:[],cfg:{_deletedUnits:{}}};
  doReturn(A,'31066', /*stamped*/false);
  PUSH(B,S);            // stale B pushes 'out'
  RECEIVE(A,S);         // A merges the stale copy
  const rec=A.dispatched.find(d=>d.sn==='31066');
  chk(rec && rec.deliveryStatus==='out', 'T1: unstamped return did NOT revert (control invalid — stamp not the differentiator)');
  chk(!A.factory.some(f=>f.sn==='31066'), 'T1: factory row survived the revert (chain not reproduced)');
}
// ── T2 THE FIX: stamped return survives; factory row survives; re-push converges B
{
  const S={dispatched:[],factory:[],cfg:{_deletedUnits:{}}};
  const A={dispatched:[mkRec('31066')],factory:[],cfg:{_deletedUnits:{}}};
  const B={dispatched:[mkRec('31066')],factory:[],cfg:{_deletedUnits:{}}};
  doReturn(A,'31066', true);
  PUSH(B,S);
  RECEIVE(A,S);
  let rec=A.dispatched.find(d=>d.sn==='31066');
  chk(rec && rec.deliveryStatus==='returned', 'T2: stamped return was reverted by stale push');
  chk(A.factory.some(f=>f.sn==='31066'), 'T2: returned tub factory row dropped');
  chk(SB.dispKept()>0, 'T2: kept-counter did not fire (no re-push would happen)');
  PUSH(A,S); RECEIVE(B,S);
  rec=B.dispatched.find(d=>d.sn==='31066');
  chk(rec && rec.deliveryStatus==='returned', 'T2: B did not converge to returned');
  chk(B.factory.some(f=>f.sn==='31066'), 'T2: B missing the returned factory row');
}
// ── T3: stamped delivery confirmation survives a stale push
{
  const S={dispatched:[],factory:[],cfg:{_deletedUnits:{}}};
  const A={dispatched:[mkRec('31070')],factory:[],cfg:{_deletedUnits:{}}};
  const B={dispatched:[mkRec('31070')],factory:[],cfg:{_deletedUnits:{}}};
  doDeliver(A,'31070');
  PUSH(B,S); RECEIVE(A,S);
  const rec=A.dispatched.find(d=>d.sn==='31070');
  chk(rec && rec.deliveryStatus==='delivered-to-dealer', 'T3: delivery confirmation reverted');
}
// ── T4: propagation intact — a STAMPED remote update beats an unstamped local
{
  const S={dispatched:[],factory:[],cfg:{_deletedUnits:{}}};
  const A={dispatched:[mkRec('31080')],factory:[],cfg:{_deletedUnits:{}}};
  const B={dispatched:[mkRec('31080')],factory:[],cfg:{_deletedUnits:{}}};
  doDeliver(B,'31080');
  PUSH(B,S); RECEIVE(A,S);
  const rec=A.dispatched.find(d=>d.sn==='31080');
  chk(rec && rec.deliveryStatus==='delivered-to-dealer', 'T4: stamped remote update did not propagate');
}
// ── T5 FUZZ: multi-device races → convergence, returned tubs never vanish
const N = parseInt(process.env.N||'20000',10);
const rnd0 = mk(0xD15A);
for(let it=0; it<N; it++){
  const rnd = mk((0xD15A*2654435761 + it*40503 + 17)>>>0);
  const NDEV=2+((rnd()*2)|0), NTUB=1+((rnd()*4)|0);
  const S={dispatched:[],factory:[],cfg:{_deletedUnits:{}}};
  const devs=[]; const base=[];
  for(let t=0;t<NTUB;t++) base.push(mkRec('31'+String(100+it%800)+String(t)));
  for(let d=0;d<NDEV;d++) devs.push({dispatched:clone(base),factory:[],cfg:{_deletedUnits:{}}});
  S.dispatched=clone(base);
  const truth={};  // sn -> 'returned' | 'delivered' | 'out'
  base.forEach(r=>truth[r.sn]='out');
  const steps=4+((rnd()*10)|0);
  for(let s=0;s<steps;s++){
    const r=rnd(); const dev=devs[(rnd()*NDEV)|0];
    const sn=base[(rnd()*NTUB)|0].sn;
    if(r<0.30 && truth[sn]==='out'){ doReturn(dev,sn,true); truth[sn]='returned'; }
    else if(r<0.5 && truth[sn]==='out'){ doDeliver(dev,sn); truth[sn]='delivered'; }
    else if(r<0.75){ PUSH(dev,S); }
    else { RECEIVE(dev,S); }
  }
  // quiesce
  let prev='';
  for(let q=0;q<4*NDEV+8;q++){ for(const dev of devs){ RECEIVE(dev,S); PUSH(dev,S); } const sig=JSON.stringify(canon(S.dispatched))+JSON.stringify(canon(S.factory)); if(sig===prev) break; prev=sig; }
  for(const dev of devs) RECEIVE(dev,S);
  // assertions
  for(let d=0;d<NDEV;d++){
    if(!collEq(devs[d].dispatched,S.dispatched) || !collEq(devs[d].factory,S.factory)){ FAIL++; if(fails.length<12)fails.push('T5 DIVERGE it='+it+' dev'+d); break; }
  }
  PASS++;
  for(const sn in truth){
    const rec=S.dispatched.find(x=>x.sn===sn);
    if(truth[sn]==='returned'){
      if(!rec || rec.deliveryStatus!=='returned'){ FAIL++; if(fails.length<12)fails.push('T5 RETURN-REVERT '+sn+' it='+it); }
      else PASS++;
      if(!S.factory.some(f=>f.sn===sn)){ FAIL++; if(fails.length<12)fails.push('T5 RETURNED-TUB-VANISHED '+sn+' it='+it); }
      else PASS++;
    } else if(truth[sn]==='delivered'){
      if(!rec || rec.deliveryStatus!=='delivered-to-dealer'){ FAIL++; if(fails.length<12)fails.push('T5 DELIVER-REVERT '+sn+' it='+it); }
      else PASS++;
    }
  }
}
console.log('Checks passed:', PASS.toLocaleString(), '· Failures:', FAIL);
if(FAIL) fails.forEach(f=>console.log('  ✗ '+f));
else console.log('✅ returns & delivery confirmations survive stale peers; returned tubs never vanish; all devices converge; legacy propagation intact.');
