'use strict';
// Focused test: cross-device SAME-id collisions (two offline devices mint the same
// nid for DIFFERENT spas). Exercises _mergeFactory / _mergeRequests de-collision
// (id = ++nid) + the orchestrator's nid = max(nid, restored.nid) propagation.
// Asserts: convergence, NO record lost, and unique ids per device after quiesce.
const fs=require('fs'); const FILE=process.argv[2]||'/home/claude/index.html'; const src=fs.readFileSync(FILE,'utf8');
const SEED=process.env.SEED?parseInt(process.env.SEED):0x1D;
const N=process.env.N?parseInt(process.env.N):20000;
function extractFn(name){const re=new RegExp('function\\s+'+name.replace(/[$]/g,'\\$')+'\\s*\\(','g');const m=re.exec(src);let i=src.indexOf('{',m.index);let d=0,j=i;for(;j<src.length;j++){const c=src[j];if(c==='{')d++;else if(c==='}'){d--;if(d===0){j++;break;}}}return src.slice(m.index,j);}
const FN=['_mergeFactory','_mergeRequests','_mergeUnits','_mergeDispatched','_mergeIncoming','_mergeMarriages'].map(extractFn).join('\n');
const SB=new Function(`'use strict';
  let cfg={_deletedUnits:{}},nid=1000,units=[],dispatched=[];
  let _lastMergeKept=0,_lastReqMergeKept=0,_lastIncMergeKept=0,_lastFacMergeKept=0,_lastCoverMergeKept=0,_lastMarMergeKept=0;
  const console={warn(){},log(){}};
  ${FN}
  return { set(o){if('cfg'in o)cfg=o.cfg;if('nid'in o)nid=o.nid;if('units'in o)units=o.units;if('dispatched'in o)dispatched=o.dispatched;}, nid(){return nid;}, _mergeFactory,_mergeRequests };
`)();
const mk=s=>{let x=s>>>0;return()=>{x=(x+0x9E3779B9)>>>0;let z=x;z=Math.imul(z^(z>>>16),0x21f0aaad);z=Math.imul(z^(z>>>15),0x735a2d97);return((z^(z>>>15))>>>0)/4294967296;};};
const clone=x=>JSON.parse(JSON.stringify(x));
const isoOf=n=>new Date(1700000000000+n*1000).toISOString();
function canon(v){if(Array.isArray(v))return v.map(canon);if(v&&typeof v==='object'){const o={};Object.keys(v).sort().forEach(k=>o[k]=canon(v[k]));return o;}return v;}
const rs=r=>JSON.stringify(canon(r));
const collEq=(a,b)=>{const sa=(a||[]).map(rs).sort(),sb=(b||[]).map(rs).sort();if(sa.length!==sb.length)return false;for(let i=0;i<sa.length;i++)if(sa[i]!==sb[i])return false;return true;};
const facKey=f=>(f.sn!=null&&String(f.sn).trim()!=='')?'sn:'+String(f.sn).trim():'id:'+f.id;
const reqKey=r=>{if(!r.requestedAt)return'id:'+r.id;const k=(r.sn!=null&&String(r.sn).trim()!=='')?String(r.sn).trim():(r.description||'');return'sig:'+[r.requestedAt,r.type||'',k].join('|');};

let FAIL=0, ASSERT=0; const fails=[];
function fail(p,seed,x){FAIL++; if(fails.length<20)fails.push(`${p} seed=${seed} ${x||''}`);}

function run(seed){
  const rnd=mk(seed);
  const NDEV=2+((rnd()*2)|0);            // 2..3 devices
  const useReq=rnd()<0.5;                  // factory or requests
  const SNS=[];for(let i=0;i<40;i++)SNS.push('S'+i);
  // each device gets its OWN nid counter starting at the SAME base → collisions
  const BASE=1001;
  const devs=[]; for(let d=0;d<NDEV;d++) devs.push({coll:[], cfg:{_deletedUnits:{}}, nid:BASE});
  const S={coll:[], cfg:{_deletedUnits:{}}, nid:BASE};
  // each device creates 1-3 records with locally-minted ids (collide across devices) and distinct S/Ns
  const usedSns=new Set();
  devs.forEach((dev,di)=>{
    const n=1+((rnd()*3)|0);
    for(let i=0;i<n;i++){
      if(usedSns.size>=SNS.length) break;
      let sn, guard=0; do{ sn=SNS[(rnd()*SNS.length)|0]+''; }while(usedSns.has(sn) && ++guard<200); if(usedSns.has(sn)) break; usedSns.add(sn);
      const id=dev.nid++;                  // collides with other devices' ids
      if(useReq) dev.coll.push({id, requestedAt:isoOf(1+((rnd()*3)|0)), type:'tub', sn, status:'pending', notes:'', notesUpdatedAt:''});
      else dev.coll.push({id, sn, type:'spa', trackingState:'created-at-factory', color:'gray', updatedAt:isoOf(i+1)});
    }
  });
  const totalDistinctSns=usedSns.size;

  function RECEIVE(dev){
    dev.nid=Math.max(dev.nid, S.nid);                          // orchestrator: nid = max(nid, restored.nid)
    SB.set({cfg:dev.cfg, nid:dev.nid, units:[], dispatched:[]});
    if(useReq) dev.coll=SB._mergeRequests(dev.coll, clone(S.coll));
    else dev.coll=SB._mergeFactory(dev.coll, clone(S.coll), [], clone(S.cfg));
    dev.nid=SB.nid();
  }
  function PUSH(dev){ S.coll=clone(dev.coll); S.cfg=clone(dev.cfg); S.nid=Math.max(S.nid, dev.nid); }

  // random interleave
  const steps=4+((rnd()*8)|0);
  for(let s=0;s<steps;s++){ const dev=devs[(rnd()*NDEV)|0]; if(rnd()<0.5)PUSH(dev); else RECEIVE(devs[(rnd()*NDEV)|0]); }
  // quiesce
  let prev='',stable=false;
  for(let r=0;r<4*NDEV+6;r++){ for(const dev of devs){RECEIVE(dev);PUSH(dev);} const sig=S.coll.map(rs).sort().join('|'); if(sig===prev){stable=true;break;} prev=sig; }
  for(const dev of devs) RECEIVE(dev);

  const K=useReq?reqKey:facKey;
  if(!stable){ fail('NO-FIXPOINT',seed,(useReq?'req':'fac')); return; }
  // convergence
  for(let d=0;d<NDEV;d++){ ASSERT++; if(!collEq(devs[d].coll,S.coll)){ fail('DIVERGE',seed,`dev${d} ${useReq?'req':'fac'}`); return; } }
  // no record lost: all distinct S/Ns survive
  const sns=new Set(S.coll.map(r=>String(r.sn))); ASSERT++;
  if(sns.size!==totalDistinctSns){ fail('LOST-RECORD',seed,`have ${sns.size}/${totalDistinctSns} ${useReq?'req':'fac'}`); return; }
  // unique ids within S (de-collision worked)
  const ids=S.coll.map(r=>r.id); ASSERT++;
  if(new Set(ids).size!==ids.length){ fail('DUP-ID',seed,`${useReq?'req':'fac'} ids=${ids.join(',')}`); }
}

console.log('═══ ID-COLLISION CONVERGENCE TEST (factory/requests de-collision) ═══');
const t0=Date.now();
for(let i=0;i<N;i++) run((SEED*2654435761 + i*40503 + 7)>>>0);
console.log('Scenarios :', N);
console.log('Assertions:', ASSERT.toLocaleString());
console.log('Failures  :', FAIL);
console.log('Runtime   :', ((Date.now()-t0)/1000).toFixed(1)+'s');
if(FAIL) fails.forEach(f=>console.log('  ✗ '+f)); else console.log('✅ id-collisions de-collide & converge; no record lost.');
