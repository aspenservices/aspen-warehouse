'use strict';
// Validates the v5.08 fix: dealer-pickup-at-factory now pulls the WAREHOUSE cover,
// once, idempotently, skipping factory covers and accessory rows. Extracts the REAL
// decrementCoverStock and replays the exact guard added to dispatchPickupFromFactory.
const fs=require('fs'); const src=fs.readFileSync(process.argv[2]||'/home/claude/index.html','utf8');
function extractFn(name){const re=new RegExp('function\\s+'+name+'\\s*\\(','g');const m=re.exec(src);let i=src.indexOf('{',m.index);let d=0,j=i;for(;j<src.length;j++){const c=src[j];if(c==='{')d++;else if(c==='}'){d--;if(d===0){j++;break;}}}return src.slice(m.index,j);}
const SB=new Function(`'use strict';
  let coverInventory=[], nid=1000, dispatchRequests=[];
  const currentRole='admin'; const ROLES={admin:{label:'Admin'}}; function actorName(){return 'Admin';}   // v5.18: records are signed by person
  function toISO(){return '2026-06-25';} function editStamp(){return new Date().toISOString();}
  function toast(){} function renderRequests(){}
  ${extractFn('decrementCoverStock')}
  // the EXACT guard the fix adds to dispatchPickupFromFactory:
  function pickupDeduct(f){
    if(f.cover && (f.cover.source || 'warehouse') === 'warehouse' && f.cover.color){
      try { decrementCoverStock(f.cover.color, f.cover.model, 'warehouse', f.sn); }catch(e){ throw e; }
    }
  }
  return { get coverInventory(){return coverInventory;}, set(inv){coverInventory=inv;}, pickupDeduct, decrementCoverStock };
`)();

let PASS=0,FAIL=0; const fails=[];
const chk=(c,l)=>{ if(c)PASS++; else {FAIL++; fails.push(l);} };
const qtyOf=(color,model,source)=>{ const r=SB.coverInventory.find(c=>(c.source||'warehouse')===source && c.color.toLowerCase()===color.toLowerCase() && (!model||(c.model||'').toLowerCase()===model.toLowerCase())); return r?r.qty:null; };

// Seed: warehouse Black/Quattro(W)=10, factory Bluwater/Quattro=5
SB.set([
  {id:1, color:'Black', model:'Quattro (W)', qty:10, lowThreshold:1, source:'warehouse', history:[], pending:[]},
  {id:2, color:'Bluwater', model:'Quattro', qty:5, lowThreshold:1, source:'factory', history:[], pending:[]},
]);

// T1 — dealer-pickup of a spa with a WAREHOUSE cover → qty 10→9
SB.pickupDeduct({ sn:'31066', cover:{color:'Black', model:'Quattro (W)', source:'warehouse'} });
chk(qtyOf('Black','Quattro (W)','warehouse')===9, 'T1 warehouse cover not deducted (expected 9, got '+qtyOf('Black','Quattro (W)','warehouse')+')');

// T2 — IDEMPOTENT: same S/N again (e.g. re-render / re-sync) → stays 9
SB.pickupDeduct({ sn:'31066', cover:{color:'Black', model:'Quattro (W)', source:'warehouse'} });
chk(qtyOf('Black','Quattro (W)','warehouse')===9, 'T2 double-deducted same S/N (expected 9, got '+qtyOf('Black','Quattro (W)','warehouse')+')');

// T3 — a DIFFERENT spa with same cover model → qty 9→8
SB.pickupDeduct({ sn:'31067', cover:{color:'Black', model:'Quattro (W)', source:'warehouse'} });
chk(qtyOf('Black','Quattro (W)','warehouse')===8, 'T3 second spa not deducted (expected 8, got '+qtyOf('Black','Quattro (W)','warehouse')+')');

// T4 — FACTORY cover at pickup → guard SKIPS it (already pulled at creation); factory qty stays 5
SB.pickupDeduct({ sn:'31070', cover:{color:'Bluwater', model:'Quattro', source:'factory'} });
chk(qtyOf('Bluwater','Quattro','factory')===5, 'T4 factory cover wrongly deducted at pickup (expected 5, got '+qtyOf('Bluwater','Quattro','factory')+')');

// T5 — ACCESSORY row (no .cover field) → no deduction, no throw
let threw=false; try{ SB.pickupDeduct({ sn:'', dealer:'Fisher Pools', type:'accessory' }); }catch(e){ threw=true; }
chk(!threw, 'T5 accessory row threw an error');
chk(qtyOf('Black','Quattro (W)','warehouse')===8, 'T5 accessory row changed cover qty');

// T6 — out-of-stock warehouse cover → goes to pending (qty stays 0, not negative)
SB.set([{id:1, color:'Black', model:'Eldorado (W)', qty:0, lowThreshold:1, source:'warehouse', history:[], pending:[]}]);
SB.pickupDeduct({ sn:'31080', cover:{color:'Black', model:'Eldorado (W)', source:'warehouse'} });
const r=SB.coverInventory[0];
chk(r.qty===0 && r.pending.length===1, 'T6 out-of-stock cover did not queue pending (qty '+r.qty+', pending '+r.pending.length+')');

console.log('Checks passed:', PASS, '· Failures:', FAIL);
if(FAIL) fails.forEach(f=>console.log('  ✗ '+f));
else console.log('✅ warehouse cover pulled once at dealer-pickup; idempotent; factory covers & accessories skipped; out-of-stock queues pending.');
