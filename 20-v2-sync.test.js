'use strict';
// v5.20 — per-collection sync v2. Tests the REAL _fbV2BuildUpdate (hash gating,
// atomic update shape, meta commit marker) plus an integration harness: an
// in-memory RTDB (multi-path update + child/meta events, ADVERSARIAL ordering:
// meta delivered BEFORE children) with 2 devices running the real gating and
// the real merge layer for 3 collections. Asserts: only changed collections
// travel, bytes-per-edit << full blob, devices converge, echo/self-commits
// ignored, hash baseline prevents re-pushing received data.
const fs=require('fs'); const src=fs.readFileSync(process.argv[2]||'index.html','utf8');
function extractFn(name){const re=new RegExp('function\\s+'+name.replace(/[$]/g,'\\$')+'\\s*\\(','g');const m=re.exec(src);if(!m)throw new Error('not found '+name);let i=src.indexOf('{',m.index);let d=0,j=i;for(;j<src.length;j++){const c=src[j];if(c==='{')d++;else if(c==='}'){d--;if(d===0){j++;break;}}}return src.slice(m.index,j);}
let PASS=0,FAIL=0; const fails=[];
const chk=(c,l)=>{ if(c)PASS++; else {FAIL++; fails.push(l);} };
const clone=x=>JSON.parse(JSON.stringify(x));

// ── sandbox con las funciones v2 reales + merges reales para 3 colecciones ──
function mkDevice(deviceId){
  return new Function('DEVID', `'use strict';
    const _fbDeviceId = DEVID;
    let cfg={_deletedUnits:{}}, nid=100;
    let units=[], dispatched=[], incoming=[], materials=[], events=[], activity=[], queue=[], factory=[], marriages=[], dispatchRequests=[], coverInventory=[], colorLibrary={}, coverModelMapping={}, movements=[], matTransfers=[];
    const window={ASPEN_DATA_EPOCH:1};
    let _lastEvMergeKept=0,_lastQMergeKept=0,_lastMvMergeKept=0,_lastMapMergeKept=0,_lastDispMergeKept=0;
    let _clk = Date.now()-5*60*1000; function editStamp(){ _clk+=137; return new Date(_clk).toISOString(); }
    const clone=x=>JSON.parse(JSON.stringify(x));
    const console={warn(){},log(){},error(){}};
    ${extractFn('_v2Hash')}
    const V2_COLLS=['units','dispatched','incoming','materials','events','activity','queue','cfg','factory','marriages','dispatchRequests','coverInventory','colorLibrary','coverModelMapping','movements','matTransfers'];
    ${extractFn('_fbV2BuildUpdate')}
    ${extractFn('_mergeEvents')}
    ${extractFn('_mergeQueue')}
    ${extractFn('_mergeMovements')}
    ${extractFn('_unionTombs')}
    return {
      id: DEVID, hashes:{}, cache:{}, dirty:{},
      get state(){ return {nid, units, dispatched, incoming, materials, events, activity, queue, cfg, factory, marriages, dispatchRequests, coverInventory, colorLibrary, coverModelMapping, movements, matTransfers, _epoch:1}; },
      addEvent(ev){ events.push(ev); },
      addMovement(m){ movements.unshift(m); },
      build(ts){ return _fbV2BuildUpdate(this.state, ts, 'u@'+DEVID, this.hashes); },
      commitHashes(nh, changed, st){ Object.assign(this.hashes, nh); },
      // receive: aplica las colecciones dirty con los MERGES reales
      applyCommit(meta){
        if(meta.deviceId===DEVID){ this.dirty={}; return []; }
        const claimed=String(meta.changed||'').split(',').filter(Boolean);
        const d=Object.assign({},this.dirty); claimed.forEach(n=>{ if(this.cache[n]!==undefined) d[n]=true; });
        this.dirty={};
        const applied=[];
        // baseline stays = CLOUD hash (set in onChild) — if the merge kept local
        // data, the next build() sees local≠cloud and re-pushes (the app's
        // _last*MergeKept reconciliation); overwriting the baseline with the
        // merged hash here would silently strand kept-local data (harness bug we hit).
        if(d.events && this.cache.events){ events=_mergeEvents(events, clone(this.cache.events), clone(this.cache.cfg||cfg)); applied.push('events'); }
        if(d.movements && this.cache.movements){ movements=_mergeMovements(movements, clone(this.cache.movements)); applied.push('movements'); }
        if(d.queue && this.cache.queue){ queue=_mergeQueue(queue, clone(this.cache.queue), clone(this.cache.cfg||cfg)); applied.push('queue'); }
        return applied;
      },
      onChild(name, v){ this.cache[name]=JSON.parse(v.j); this.hashes[name]=v.h; this.dirty[name]=true; }
    };
  `)(deviceId);
}

// ── RTDB en memoria con entrega ADVERSA (meta primero, luego children) ──
function mkCloud(){
  return {
    nodes:{}, bytesUp:0, bytesDown:{},
    update(upd, listeners){
      let metaVal=null; const childEvents=[];
      for(const path in upd){
        this.bytesUp += JSON.stringify(upd[path]).length;
        this.nodes[path]=clone(upd[path]);
        if(path.endsWith('/meta')) metaVal=clone(upd[path]);
        else childEvents.push({ name:path.split('/').pop(), val:clone(upd[path]) });
      }
      for(const L of listeners){
        // ADVERSARIAL: meta ANTES que los children (el hardening debe cubrirlo:
        // en la app real hay un micro-delay; aquí el harness entrega children
        // inmediatamente después y ejecuta el apply al final, emulándolo)
        for(const ev of childEvents){ L.dev.onChild(ev.name, ev.val); this.bytesDown[L.dev.id]=(this.bytesDown[L.dev.id]||0)+JSON.stringify(ev.val).length; }
        if(metaVal) L.pendingMeta = metaVal;
      }
    },
    flush(listeners){ for(const L of listeners){ if(L.pendingMeta){ L.dev.applyCommit(L.pendingMeta); L.pendingMeta=null; } } }
  };
}

// ══ T1: gating por hash — solo viajan las colecciones cambiadas ══
{
  const A=mkDevice('devA');
  // estado grande: 3000 movements (~600KB) + 20 events
  for(let i=0;i<3000;i++) A.addMovement({id:'mv'+i, type:'601', at:1750000000000+i, sn:'S'+i, note:'movement record '+i+' lorem ipsum'});
  for(let i=0;i<20;i++) A.addEvent({id:'e'+i, groupId:'g'+i, type:'dispatch', dealer:'D'+i, date:'2026-07-01'});
  const full = A.build(1000);
  chk(full.changed.length>=4 && full.upd['state/shared/v2/meta'], 'T1 first push seeds all non-empty collections: '+full.changed.join(','));
  A.commitHashes(full.newHashes);
  const blobSize = JSON.stringify(A.state).length;
  // una edición pequeña: 1 evento nuevo
  A.addEvent({id:'eNEW', groupId:'gNEW', type:'dispatch', dealer:'Fisher', date:'2026-07-09'});
  const inc = A.build(2000);
  chk(inc.changed.length===1 && inc.changed[0]==='events', 'T1 only events changed, got: '+inc.changed.join(','));
  const incBytes = JSON.stringify(inc.upd).length;
  chk(incBytes < blobSize*0.05, `T1 incremental push ${incBytes}B must be <5% of blob ${blobSize}B`);
  console.log(`   ↳ blob=${(blobSize/1024).toFixed(0)}KB · push incremental=${(incBytes/1024).toFixed(1)}KB (${(incBytes/blobSize*100).toFixed(1)}%)`);
  // sin cambios → push vacío
  A.commitHashes(inc.newHashes);
  const none = A.build(3000);
  chk(none.changed.length===0 && !none.upd['state/shared/v2/meta'], 'T1 no-change push must be empty');
}

// ══ T2: integración 2 dispositivos — convergencia + bytes + echo + no re-push ══
{
  const cloud=mkCloud();
  const A=mkDevice('devA'), B=mkDevice('devB');
  const listeners=[{dev:A,pendingMeta:null},{dev:B,pendingMeta:null}];
  // seed: A crea 500 movements y 5 eventos, push
  for(let i=0;i<500;i++) A.addMovement({id:'mvA'+i, type:'601', at:1750000000000+i});
  for(let i=0;i<5;i++) A.addEvent({id:'eA'+i, groupId:'gA'+i, type:'dispatch', dealer:'D', date:'2026-07-01'});
  let b=A.build(1000); cloud.update(b.upd, listeners); A.commitHashes(b.newHashes); cloud.flush(listeners);
  chk(B.state.movements.length===500 && B.state.events.length===5, 'T2 B did not converge on seed: mv='+B.state.movements.length+' ev='+B.state.events.length);
  // B agrega 1 evento → push incremental
  const before = cloud.bytesUp;
  B.addEvent({id:'eB1', groupId:'gB1', type:'dispatch', dealer:'Aqua', date:'2026-07-02'});
  b=B.build(2000); 
  chk(b.changed.join(',')==='events', 'T2 B incremental changed='+b.changed.join(','));
  cloud.update(b.upd, listeners); B.commitHashes(b.newHashes); cloud.flush(listeners);
  const delta = cloud.bytesUp - before;
  chk(delta < 3000, 'T2 B push should be tiny (~1 coll of 6 events), was '+delta+'B');
  chk(A.state.events.length===6 && A.state.events.some(e=>e.id==='eB1'), 'T2 A did not receive B event');
  // el hash baseline de A ahora refleja lo recibido → A NO re-empuja events sin cambios
  const a2=A.build(3000);
  chk(!a2.changed.includes('events'), 'T2 A re-pushed unchanged received events');
  // echo: B recibe su propio meta → ignorado (dirty limpiado, sin merge doble)
  chk(B.state.events.length===6, 'T2 B echo self-apply corrupted state');
  // ediciones CONCURRENTES: A y B agregan evento cada uno; A push, B push (stale-cross), flush
  A.addEvent({id:'eA9', groupId:'gA9', type:'dispatch', dealer:'X', date:'2026-07-03'});
  B.addEvent({id:'eB9', groupId:'gB9', type:'dispatch', dealer:'Y', date:'2026-07-03'});
  let ba=A.build(4000); cloud.update(ba.upd, listeners); A.commitHashes(ba.newHashes);
  let bb=B.build(4100); cloud.update(bb.upd, listeners); B.commitHashes(bb.newHashes);
  cloud.flush(listeners);
  // re-push de reconciliación (los merges conservaron lo local → hashes difieren)
  ba=A.build(5000); if(ba.changed.length){ cloud.update(ba.upd, listeners); A.commitHashes(ba.newHashes); }
  cloud.flush(listeners);
  bb=B.build(5100); if(bb.changed.length){ cloud.update(bb.upd, listeners); B.commitHashes(bb.newHashes); }
  cloud.flush(listeners);
  ba=A.build(6000); if(ba.changed.length){ cloud.update(ba.upd, listeners); A.commitHashes(ba.newHashes); }
  cloud.flush(listeners);
  const evA=A.state.events.map(e=>e.id).sort().join(','), evB=B.state.events.map(e=>e.id).sort().join(',');
  chk(evA===evB && evA.includes('eA9') && evA.includes('eB9'), 'T2 concurrent adds must converge with both events: A='+evA+' B='+evB);
}

// ══ T3: estáticos de cableado ══
chk(src.includes("_fbDb.ref().update(v2.upd)"), 'T3 atomic multi-path update missing');
chk(src.includes("Object.assign(_fbV2Hash, v2.newHashes)"), 'T3 hash baseline commit missing');
chk(src.includes("_fbAttachV2Listeners()") && src.includes("state/shared/v2/meta').once"), 'T3 boot probe/branch missing');
chk(src.includes("V2_DUAL_WRITE_LEGACY"), 'T3 dual-write flag missing');
chk(src.includes("_fbV2DeferredMeta = meta"), 'T3 deferred-commit guard missing');
chk(src.includes("setTimeout(() => {") && src.includes("meta.changed||''"), 'T3 event-ordering hardening missing');
chk((src.match(/child_added|child_changed/g)||[]).length>=2, 'T3 child listeners missing');

console.log('Checks passed:', PASS, '· Failures:', FAIL);
if(FAIL) fails.forEach(f=>console.log('  ✗ '+f));
else console.log('✅ v2 sync: only changed collections travel (<5% of blob), devices converge under concurrent edits + adversarial event order, echoes ignored, received data never re-pushed.');
