'use strict';
// v5.15 — unit-tests computeOpsKPIs (the pure analytics function behind the
// Dashboard KPI card) with synthetic data + edge cases: month bucketing,
// cycle-time averaging, return rates (all-time vs 90d), top dealers/reasons,
// cover-decrement counting, malformed/missing dates, empty datasets.
const fs=require('fs'); const src=fs.readFileSync(process.argv[2]||'index.html','utf8');
function extractFn(name){const re=new RegExp('function\\s+'+name+'\\s*\\(','g');const m=re.exec(src);if(!m)throw new Error('not found '+name);let i=src.indexOf('{',m.index);let d=0,j=i;for(;j<src.length;j++){const c=src[j];if(c==='{')d++;else if(c==='}'){d--;if(d===0){j++;break;}}}return src.slice(m.index,j);}
const compute=new Function("'use strict'; "+extractFn('computeOpsKPIs')+"; return computeOpsKPIs;")();
let PASS=0,FAIL=0; const fails=[];
const chk=(c,l)=>{ if(c)PASS++; else {FAIL++; fails.push(l);} };

// Fixed "now": 2026-06-25 12:00 local
const NOW = new Date(2026,5,25,12,0,0).getTime();
const day = 864e5;

// ── dataset ──
const dispatched = [
  // this month (Jun): 2 dispatches, one entry 10d before dispatch
  {sn:'A1', dealer:'Fisher Pools', dispatchDate:'2026-06-10', entryDate:'2026-05-31', deliveryStatus:'out'},
  {sn:'A2', dealer:'Fisher Pools', dispatchedAt:'2026-06-20', entryDate:'2026-06-10', deliveryStatus:'delivered-to-dealer'},  // dispatchedAt variant, 10d cycle
  // May: 1 dispatch, returned with reason
  {sn:'A3', dealer:'Central Jersey Pools', dispatchDate:'2026-05-05', entryDate:'2026-04-25', deliveryStatus:'returned', returnReason:'Damaged in transit — cracked shell'},
  // Jan (5 months ago → oldest visible bucket): 1
  {sn:'A4', dealer:'Aqua Palace', dispatchDate:'2026-01-15', deliveryStatus:'out'},
  // Outside the 6-month window (should not bucket, but counts all-time)
  {sn:'A5', dealer:'Old Dealer', dispatchDate:'2025-06-01', deliveryStatus:'returned', returnReason:'Wrong model'},
  // Malformed dates — must not crash nor bucket
  {sn:'A6', dealer:'X', dispatchDate:'not-a-date', entryDate:'??', deliveryStatus:'out'},
  {sn:'A7', dealer:'', deliveryStatus:'out'},                        // no dates at all
  // entry AFTER dispatch (bad data) → excluded from cycle average
  {sn:'A8', dealer:'Y', dispatchDate:'2026-06-01', entryDate:'2026-06-15', deliveryStatus:'out'},
];
const units = [
  {sn:'U1', entry:'2026-06-15'},   // 10 days old
  {sn:'U2', entry:'2026-05-26'},   // 30 days old
  {sn:'U3', entry:'bad-date'},     // ignored
];
const coverInventory = [
  {color:'Black', history:[
    {at:'2026-06-05', action:'decrement', spaSn:'A1'},
    {at:'2026-06-18', action:'decrement', spaSn:'A2'},
    {at:'2026-05-02', action:'decrement', spaSn:'A3'},
    {at:'2026-06-07', action:'queued-pending', spaSn:'Z'},   // NOT a decrement
    {at:'bad', action:'decrement'},                          // malformed → ignored
  ]},
  {color:'Bluwater', history:null},                          // no history → ignored
];

const k = compute(dispatched, units, coverInventory, NOW);

// months: Jan..Jun labels, oldest→newest
chk(k.months.length===6, 'months length '+k.months.length);
chk(k.months[0].label==='Jan' && k.months[5].label==='Jun', 'month labels '+k.months.map(m=>m.label).join(','));
chk(k.months[5].dispatches===3, 'Jun dispatches '+k.months[5].dispatches+' (expected 3: A1, A2 via dispatchedAt, A8)');
chk(k.months[4].dispatches===1, 'May dispatches '+k.months[4].dispatches);
chk(k.months[0].dispatches===1, 'Jan dispatches '+k.months[0].dispatches);
// covers: Jun 2 decrements, May 1; pending + malformed ignored
chk(k.months[5].covers===2 && k.months[4].covers===1, 'covers Jun/May '+k.months[5].covers+'/'+k.months[4].covers);
// cycle: A1 10d, A2 10d, A3 10d → avg 10.0; A8 (entry>dispatch) and malformed excluded
chk(k.avgDaysToDispatch===10.0 && k.cycleSampleN===3, 'cycle avg '+k.avgDaysToDispatch+' n='+k.cycleSampleN);
// returns: all-time 2/8=25%; last-90d: dispatches in window = A1,A2,A3(May 5 within 90d of Jun 25),A8 → 4, returned in window = 1 → 25%
chk(k.returnRate===25.0, 'all-time return rate '+k.returnRate);
chk(k.returnRate90===25.0, '90d return rate '+k.returnRate90);
chk(k.returnedCount===2 && k.totalDispatched===8, 'counts '+k.returnedCount+'/'+k.totalDispatched);
// top reasons: reason text truncated at " — "
chk(k.topReasons.length===2 && k.topReasons[0].count===1, 'reasons '+JSON.stringify(k.topReasons));
chk(k.topReasons.some(r=>r.reason==='Damaged in transit'), 'reason split at em-dash: '+JSON.stringify(k.topReasons.map(r=>r.reason)));
// top dealers (90d): Fisher 2, Central Jersey 1, Y 1 (A8 within 90d); empty-name A7 excluded
chk(k.topDealers[0].name==='Fisher Pools' && k.topDealers[0].count===2, 'top dealer '+JSON.stringify(k.topDealers[0]));
chk(!k.topDealers.some(d=>d.name===''), 'empty dealer excluded');
// warehouse age: (10+30)/2 = 20
chk(k.avgWarehouseAgeDays===20, 'avg WH age '+k.avgWarehouseAgeDays);

// ── edge: completely empty ──
const e = compute([], [], [], NOW);
chk(e.months.length===6 && e.avgDaysToDispatch===null && e.returnRate===0 && e.topDealers.length===0 && e.avgWarehouseAgeDays===null, 'empty dataset safe');
// ── edge: garbage inputs don't crash ──
let crashed=false; try{ compute(null, undefined, 'nope', NOW); }catch(x){ crashed=true; }
chk(!crashed, 'garbage inputs crashed');

console.log('Checks passed:', PASS, '· Failures:', FAIL);
if(FAIL) fails.forEach(f=>console.log('  ✗ '+f));
else console.log('✅ KPI math correct: bucketing, cycle avg, return rates, top lists, cover counting, edge cases.');
