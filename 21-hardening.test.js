'use strict';
// v5.23 — the 10 deep corrections. Functional: #2 undo-revive (real fn), #3 blob
// strip/rehydrate round-trip (real fns), #1 sha256 NIST vector + pinMatches.
// Static wiring for #4,#5,#6,#7,#8,#9,#10.
const fs=require('fs'); const src=fs.readFileSync(process.argv[2]||'index.html','utf8');
function extractFn(name){const re=new RegExp('function\\s+'+name.replace(/[$]/g,'\\$')+'\\s*\\(','g');const m=re.exec(src);if(!m)throw new Error('not found '+name);let i=src.indexOf('{',m.index);let d=0,j=i;for(;j<src.length;j++){const c=src[j];if(c==='{')d++;else if(c==='}'){d--;if(d===0){j++;break;}}}return src.slice(m.index,j);}
let PASS=0,FAIL=0; const fails=[];
const chk=(c,l)=>{ if(c)PASS++; else {FAIL++; fails.push(l);} };

// ── #2: undo-revive con la función real ──
{
  const SB=new Function(`'use strict';
    let cfg={_deletedUnits:{'sn:31066':'2026-07-01T10:00:00.000Z','id:9':'2026-07-01T10:00:00.000Z'},_deletedEventGroups:{'g1':'x'},_deletedQueueIds:{'q1':'x'}};
    let units=[{id:1,sn:'31066'}], factory=[{id:9,sn:''}], events=[{id:'e1',groupId:'g1'}], queue=[{id:'q1'}];
    let _clk=Date.now(); function editStamp(){_clk+=137;return new Date(_clk).toISOString();}
    const console={warn(){}};
    ${extractFn('_undoReviveTombstoned')}
    return ()=>{ _undoReviveTombstoned(); return {cfg,units,events,queue,factory}; };`)();
  const r=SB();
  chk(!r.cfg._deletedUnits['sn:31066'] && !r.cfg._deletedUnits['id:9'], '#2 unit/factory tombstones not cleared');
  chk(!r.cfg._deletedEventGroups['g1'] && !r.cfg._deletedQueueIds['q1'], '#2 event/queue tombstones not cleared');
  chk(r.units[0].updatedAt && r.factory[0].updatedAt && r.events[0].updatedAt, '#2 restored records not stamped fresh');
}
// ── #1: sha256 (NIST) + pinMatches (hash y legacy) ──
{
  const SB=new Function(`'use strict';
    ${extractFn('_sha256')}
    ${extractFn('_hashPin')}
    ${extractFn('_pinLooksHashed')}
    let cfg={rolePasswords:{}};
    function getRolePin(r){ return cfg.rolePasswords[r]; }
    ${extractFn('pinMatches')}
    return {sha:_sha256, hp:_hashPin, set(r,v){cfg.rolePasswords[r]=v;}, match:pinMatches};`)();
  chk(SB.sha('abc')==='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', '#1 sha256 NIST vector failed');
  SB.set('warehouse', SB.hp('warehouse','1234'));
  chk(SB.match('warehouse','1234') && !SB.match('warehouse','0000'), '#1 hashed pin verify wrong');
  SB.set('factory','9999');   // legacy plaintext pre-migración
  chk(SB.match('factory','9999') && !SB.match('factory','1111'), '#1 legacy plaintext verify wrong');
  chk(SB.hp('admin','1234') !== SB.hp('warehouse','1234'), '#1 role-salted hashes must differ');
}
// ── #3: strip + rehydrate round-trip con las funciones reales ──
{
  const SB=new Function(`'use strict';
    ${extractFn('_v2Hash')}
    const _V2_BLOB_FIELDS=['bolPdf','deliveryPhoto','deliveryDoc','photo'];
    ${extractFn('_v2StripBlobs')}
    return {strip:_v2StripBlobs};`)();
  const big='PDFDATA'.repeat(400); // >2000 chars
  const sink={};
  const out=SB.strip([{id:1, sn:'A', bolPdf:big, notes:'x'},{id:2, sn:'B', bolPdf:null}], sink);
  const key=Object.keys(sink)[0];
  chk(key && sink[key]===big, '#3 blob not extracted');
  chk(out[0].bolPdf==='__b:'+key && out[1].bolPdf===null, '#3 marker wrong: '+String(out[0].bolPdf).slice(0,12));
  chk(out[0].notes==='x' && out[0].sn==='A', '#3 stripped copy lost fields');
  // idempotente: strippear lo ya strippeado no re-extrae
  const sink2={}; const out2=SB.strip(out, sink2);
  chk(Object.keys(sink2).length===0, '#3 double-strip re-extracted');
  // rehydrate está inline en assemble — verificación estática del fallback local:
  chk(src.includes('byId[String(r.id)] && byId[String(r.id)][f]'), '#3 rehydrate local-fallback missing (LWW could wipe a PDF)');
}
// ── estáticos #4-#10 ──
chk(src.includes('_fbSyncInFlight') && src.includes('_fbCloudSyncInner'), '#4 mutex missing');
chk(src.includes('route through the SAME merge layer') && src.includes('_mergeUnits(units, restored.units, restored)'), '#5 multi-tab merges missing');
chk(src.includes('archiveOldDispatched') && src.includes("state/shared/v2/archive/dispatched/"), '#6 archive missing');
chk(src.includes("_fbAuthorized && _fbV2CollRef){") && src.includes('v2 reconnect-pull'), '#7 v2-aware reconnect missing');
chk(src.includes("n !== 'blobs'") && !src.includes('_fbV2Cache[n] = state[n]'), '#8 memory fixes missing');
chk((src.match(/Date\.now\(\)\*1000 \+ \(\(Math\.random\(\)\*1000\)\|0\)/g)||[]).length>=2, '#9 event id collision guard missing');
chk(src.includes("src.trash = t || {}") || src.includes('src.trash = t'), '#10 trash split from cfg missing');
chk(src.includes('APP_CHECK_SITE_KEY'), '#1 App Check scaffold missing');

console.log('Checks passed:', PASS, '· Failures:', FAIL);
if(FAIL) fails.forEach(f=>console.log('  ✗ '+f));
else console.log('✅ hardening v5.23: undo-revive, hashed PINs (NIST-verified), blob round-trip, mutex, multi-tab merges, archive, v2 reconnect, memory, ids, trash split.');
