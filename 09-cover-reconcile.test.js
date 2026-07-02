'use strict';
// Validates reconcileDispatchedCovers (v5.09): back-fills missed warehouse-cover pulls
// from past dispatches, idempotently, only reducing (never negative), skipping factory
// covers and already-deducted S/Ns. Extracts the REAL function.
const fs=require('fs'); const src=fs.readFileSync(process.argv[2]||'/home/claude/index.html','utf8');
function extractFn(name){const re=new RegExp('function\\s+'+name+'\\s*\\(','g');const m=re.exec(src);let i=src.indexOf('{',m.index);let d=0,j=i;for(;j<src.length;j++){const c=src[j];if(c==='{')d++;else if(c==='}'){d--;if(d===0){j++;break;}}}return src.slice(m.index,j);}
const SB=new Function(`'use strict';
  let coverInventory=[], dispatched=[], nid=2000, cfg={}; let _bypassNextSafePush=false; let _fbDb=null,_fbAuthorized=false;
  function toISO(){return '2026-06-25';} function editStamp(){return new Date().toISOString();}
  function toast(){} function addAct(){} function flushSave(){} function fbCloudSync(){} function renderCoverInventory(){} function updBadges(){}
  ${extractFn('reconcileDispatchedCovers')}
  return {
    set(inv,disp){coverInventory=inv;dispatched=disp;}, run(o){return reconcileDispatchedCovers(o);},
    get inv(){return coverInventory;}, get cfg(){return cfg;}
  };
`)();
const qty=(color,model,source)=>{ source=source||'warehouse'; const r=SB.inv.find(c=>(c.source||'warehouse')===source&&c.color.toLowerCase()===color.toLowerCase()&&(!model||(c.model||'').toLowerCase()===model.toLowerCase())); return r?r.qty:null; };
let PASS=0,FAIL=0; const fails=[];
const chk=(c,l)=>{ if(c)PASS++; else {FAIL++; fails.push(l);} };

// Inventory: Black/Quattro(W)=10 (over-counted), Black/Eldorado(W)=2, Bluwater/Quattro(factory)=5
// One Eldorado already deducted for sn 30958 (in history) — must NOT double-pull.
SB.set([
  {id:1,color:'Black',model:'Quattro (W)',qty:10,lowThreshold:1,source:'warehouse',history:[],pending:[]},
  {id:2,color:'Black',model:'Eldorado (W)',qty:2,lowThreshold:1,source:'warehouse',history:[{at:'x',action:'decrement',spaSn:'30958'}],pending:[]},
  {id:3,color:'Bluwater',model:'Quattro',qty:5,lowThreshold:1,source:'factory',history:[],pending:[]},
],[
  // 3 dealer-pickups with warehouse Quattro covers (never deducted) → should pull 3 (10→7)
  {sn:'31066', via:'dealer-pickup-at-factory', cover:{color:'Black',model:'Quattro (W)',source:'warehouse'}},
  {sn:'31067', via:'dealer-pickup-at-factory', cover:{color:'Black',model:'Quattro (W)',source:'warehouse'}},
  {sn:'31068', via:'dealer-pickup-at-factory', cover:{color:'Black',model:'Quattro (W)',source:'warehouse'}},
  // schedule dispatch storing coverPaired (Eldorado) for 30958 — ALREADY deducted → skip
  {sn:'30958', via:'schedule-quick', coverPaired:{color:'Black',model:'Eldorado (W)',source:'warehouse'}},
  // a NEW Eldorado dealer-pickup (31080) never deducted → pull 1 (2→1)
  {sn:'31080', via:'dealer-pickup-at-factory', cover:{color:'Black',model:'Eldorado (W)',source:'warehouse'}},
  // a FACTORY cover (Bluwater) — must be skipped (deducted at creation)
  {sn:'31090', via:'dealer-pickup-at-factory', cover:{color:'Bluwater',model:'Quattro',source:'factory'}},
  // an accessory dispatch with no cover — skipped, no crash
  {sn:'', via:'dealer-pickup-at-factory', type:'accessory'},
]);

// First run
const r1 = SB.run({auto:true});
chk(qty('Black','Quattro (W)')===7, 'Quattro not back-filled to 7 (got '+qty('Black','Quattro (W)')+')');
chk(qty('Black','Eldorado (W)')===1, 'Eldorado not back-filled to 1 (got '+qty('Black','Eldorado (W)')+')');
chk(qty('Bluwater','Quattro','factory')===5, 'factory cover wrongly pulled (got '+qty('Bluwater','Quattro','factory')+')');
chk(r1.pulled===4, 'expected 4 pulls, got '+r1.pulled);
chk(r1.skipped>=1, 'expected the already-deducted 30958 to be skipped, skipped='+r1.skipped);

// SECOND run — must be a NO-OP (idempotent / self-healing): qty unchanged, pulled 0
const r2 = SB.run({auto:true});
chk(qty('Black','Quattro (W)')===7 && qty('Black','Eldorado (W)')===1, 'second run changed qty (not idempotent)');
chk(r2.pulled===0, 'second run pulled '+r2.pulled+' (expected 0 — self-healing no-op)');

// Floor at 0: build an over-deducted scenario (qty 1, two un-deducted dispatches) → 0 not -1
SB.set([{id:9,color:'Black',model:'Roll 16',qty:1,lowThreshold:1,source:'warehouse',history:[],pending:[]}],[
  {sn:'A1', via:'dealer-pickup-at-factory', cover:{color:'Black',model:'Roll 16',source:'warehouse'}},
  {sn:'A2', via:'dealer-pickup-at-factory', cover:{color:'Black',model:'Roll 16',source:'warehouse'}},
]);
SB.run({auto:true});
chk(qty('Black','Roll 16')===0, 'floor failed — expected 0, got '+qty('Black','Roll 16'));

console.log('Checks passed:', PASS, '· Failures:', FAIL);
if(FAIL) fails.forEach(f=>console.log('  ✗ '+f));
else console.log('✅ back-fills missed pulls; skips already-deducted & factory covers; idempotent on re-run; floors at 0.');
