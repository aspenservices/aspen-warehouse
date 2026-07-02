'use strict';
// v5.19 — universal trash. Extracts the REAL _trashAdd/_trashHousekeep/trashRestore
// + mergeCfgPreservingPins and validates: capture shape, per-entry LWW sync (a
// restore on one device beats a stale 'trashed' copy), restore clears the matching
// tombstone + stamps fresh updatedAt, duplicate guards block bad restores, purge
// nulls the payload, and the 30-day/80-entry housekeeping is deterministic.
const fs=require('fs'); const src=fs.readFileSync(process.argv[2]||'index.html','utf8');
function extractFn(name){const re=new RegExp('function\\s+'+name.replace(/[$]/g,'\\$')+'\\s*\\(','g');const m=re.exec(src);if(!m)throw new Error('not found '+name);let i=src.indexOf('{',m.index);let d=0,j=i;for(;j<src.length;j++){const c=src[j];if(c==='{')d++;else if(c==='}'){d--;if(d===0){j++;break;}}}return src.slice(m.index,j);}
const SB=new Function(`'use strict';
  let cfg={}, units=[], factory=[], events=[], coverInventory=[];
  const DEFAULT_ROLE_PINS={admin:'0'};
  let _clk = Date.now() - 5*60*1000;
  function editStamp(){ _clk += 137; return new Date(_clk).toISOString(); }
  function actorName(){ return 'Jeremy'; }
  function canEdit(){ return true; }
  function toast(m,t){ SBLOG.toasts.push({m:String(m),t:t||'ok'}); }
  function addAct(){} function flushSave(){} function fbAutoPush(){} function updBadges(){}
  function renderCal(){} function renderCoverInventory(){}
  function fbRerenderActiveView(){} function openTrashModal(){}
  function escapeHTML(x){ return String(x==null?'':x); }
  const document={ getElementById:()=>null, createElement:()=>({style:{},addEventListener(){},remove(){}}), body:{appendChild(){}} };
  const confirm=()=>true;
  const console={warn(){},log(){}};
  const SBLOG={toasts:[]};
  ${extractFn('_trashAdd')}
  ${extractFn('_trashHousekeep')}
  ${extractFn('_trashCount')}
  ${extractFn('trashRestore')}
  ${extractFn('trashPurgeForever')}
  ${extractFn('mergeCfgPreservingPins')}
  return {
    set(o){ if('cfg'in o)cfg=o.cfg; if('units'in o)units=o.units; if('factory'in o)factory=o.factory; if('events'in o)events=o.events; if('coverInventory'in o)coverInventory=o.coverInventory; },
    get cfg(){return cfg;}, get units(){return units;}, get factory(){return factory;}, get events(){return events;}, get covers(){return coverInventory;},
    add:_trashAdd, hk:_trashHousekeep, count:_trashCount, restore:trashRestore, purge:trashPurgeForever, mCfg:mergeCfgPreservingPins,
    log:SBLOG, stamp:editStamp
  };
`)();
const clone=x=>JSON.parse(JSON.stringify(x));
let PASS=0,FAIL=0; const fails=[];
const chk=(c,l)=>{ if(c)PASS++; else {FAIL++; fails.push(l);} };

// ── T1: captura ──
SB.set({cfg:{}, units:[], factory:[], events:[], coverInventory:[]});
SB.add('unit', '31066 · Quattro · Fisher Pools', {id:5, sn:'31066', dealer:'Fisher Pools', model:'Quattro'});
let ids=Object.keys(SB.cfg._trashBin||{});
chk(ids.length===1, 'T1 capture missing');
let e=SB.cfg._trashBin[ids[0]];
chk(e.status==='trashed' && e.by==='Jeremy' && e.payload.sn==='31066' && e.kind==='unit', 'T1 entry shape: '+JSON.stringify({s:e.status,b:e.by}));

// ── T2: restore de unit limpia tombstone + stamp fresco + bloquea duplicado ──
SB.cfg._deletedUnits = { 'sn:31066': SB.stamp() };
SB.restore(e.id);
chk(SB.units.length===1 && SB.units[0].sn==='31066', 'T2 unit not restored');
chk(!SB.cfg._deletedUnits['sn:31066'], 'T2 tombstone not cleared');
chk(typeof SB.units[0].updatedAt==='string' && SB.units[0].updatedAt.length>10, 'T2 fresh updatedAt missing');
chk(SB.cfg._trashBin[e.id].status==='restored', 'T2 status not restored');
// restore otra vez (ya restaurado) → bloqueado
SB.log.toasts.length=0; SB.restore(e.id);
chk(SB.units.length===1 && SB.log.toasts.some(t=>t.t==='err'), 'T2 double-restore not blocked');
// nueva entrada del mismo SN con la tina YA en piso → guard
SB.add('unit','31066 dup',{id:6, sn:'31066', dealer:'X'});
const dupId=Object.keys(SB.cfg._trashBin).find(k=>SB.cfg._trashBin[k].status==='trashed');
SB.log.toasts.length=0; SB.restore(dupId);
chk(SB.units.length===1 && SB.log.toasts.some(t=>t.m.includes('already on the floor')), 'T2 duplicate-SN guard failed');

// ── T3: event-group restore limpia tombstone de grupo ──
SB.set({cfg:SB.cfg, units:SB.units, factory:[], events:[], coverInventory:[]});
SB.add('event-group','Dispatch · Fisher · 2 S/N',[{id:'e1',groupId:'g9',type:'dispatch',dealer:'Fisher',date:'2026-07-01'},{id:'e2',groupId:'g9',type:'dispatch',dealer:'Fisher',date:'2026-07-01'}]);
SB.cfg._deletedEventGroups={'g9':SB.stamp()};
const gid=Object.keys(SB.cfg._trashBin).find(k=>SB.cfg._trashBin[k].kind==='event-group'&&SB.cfg._trashBin[k].status==='trashed');
SB.restore(gid);
chk(SB.events.length===2, 'T3 events not restored ('+SB.events.length+')');
chk(!SB.cfg._deletedEventGroups['g9'], 'T3 group tombstone not cleared');
chk(SB.events.every(ev=>typeof ev.updatedAt==='string'), 'T3 fresh stamps missing');

// ── T4: sync LWW — un restore vence a la copia stale 'trashed' ──
{
  const A={_trashBin:{ tX:{id:'tX',kind:'cover',label:'c',payload:{id:1},deletedAt:'2026-06-20T10:00:00.000Z',by:'J',status:'restored',updatedAt:'2026-06-25T10:00:00.000Z'} }, rolePasswords:{}, rolePasswordsUpdatedAt:{}};
  const B={_trashBin:{ tX:{id:'tX',kind:'cover',label:'c',payload:{id:1},deletedAt:'2026-06-20T10:00:00.000Z',by:'J',status:'trashed', updatedAt:'2026-06-20T10:00:00.000Z'} }, rolePasswords:{}, rolePasswordsUpdatedAt:{}};
  const M=SB.mCfg(clone(A), clone(B));
  chk(M._trashBin.tX.status==='restored', 'T4 stale trashed copy beat the newer restore');
  const M2=SB.mCfg(clone(B), clone(A));
  chk(M2._trashBin.tX.status==='restored', 'T4 direction-symmetric LWW failed');
  // entrada solo-local sobrevive
  const C={_trashBin:{ tY:{id:'tY',kind:'unit',label:'u',payload:{},deletedAt:'2026-06-24T10:00:00.000Z',status:'trashed',updatedAt:'2026-06-24T10:00:00.000Z'} }, rolePasswords:{}, rolePasswordsUpdatedAt:{}};
  const M3=SB.mCfg(clone(C), clone(A));
  chk(M3._trashBin.tY && M3._trashBin.tX, 'T4 union lost an entry');
}

// ── T5: purge forever anula payload; housekeeping 30d + cap 80 ──
SB.set({cfg:{_trashBin:{}}, units:[], factory:[], events:[], coverInventory:[]});
SB.add('cover','Cover · Black',{id:9,color:'Black',qty:3});
const pid=Object.keys(SB.cfg._trashBin)[0];
SB.purge(pid);
chk(SB.cfg._trashBin[pid].status==='purged' && SB.cfg._trashBin[pid].payload===null, 'T5 purge did not null payload');
// 30 días: entrada vieja se elimina físicamente
SB.cfg._trashBin['old1']={id:'old1',kind:'unit',label:'x',payload:{},deletedAt:new Date(Date.now()-31*864e5).toISOString(),status:'trashed',updatedAt:'x'};
SB.hk();
chk(!SB.cfg._trashBin['old1'], 'T5 31-day-old entry not purged');
// cap 80
for(let i=0;i<95;i++) SB.cfg._trashBin['c'+i]={id:'c'+i,kind:'unit',label:'x',payload:{},deletedAt:new Date(Date.now()-i*3600e3).toISOString(),status:'trashed',updatedAt:'x'};
SB.hk();
chk(Object.keys(SB.cfg._trashBin).length<=80, 'T5 cap 80 failed: '+Object.keys(SB.cfg._trashBin).length);

// ── static wiring ──
chk((src.match(/_trashAdd\('(unit|factory|event-group|cover)'/g)||[]).length===4, 'expected 4 capture sites');
chk(src.includes('openTrashModal()">Open trash'), 'Settings card missing');
chk(src.includes("_trashHousekeep(); }catch(e){} }, 8500"), 'boot housekeeping missing');
chk(src.includes('merged._trashBin = out'), 'cfg merge for trash missing');

console.log('Checks passed:', PASS, '· Failures:', FAIL);
if(FAIL) fails.forEach(f=>console.log('  ✗ '+f));
else console.log('✅ trash bin: capture/restore/purge cycle correct, tombstones cleared on restore, LWW sync beats stale copies, duplicates blocked, 30d/80-cap housekeeping deterministic.');
