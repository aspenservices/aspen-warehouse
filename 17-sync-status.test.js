'use strict';
// v5.17 — offline queue visibility. Unit-tests computeSyncStatus (the pure state
// machine behind the header pill) across every state, with special focus on the
// two gaps it fixes: offline shows the PENDING COUNT, and stuck pending edits
// (>5s) no longer show a green "Synced" pill. Plus static wiring checks for the
// reconnect flush + live badge refresh.
const fs=require('fs'); const src=fs.readFileSync(process.argv[2]||'index.html','utf8');
function extractFn(name){const re=new RegExp('function\\s+'+name+'\\s*\\(','g');const m=re.exec(src);if(!m)throw new Error('not found '+name);let i=src.indexOf('{',m.index);let d=0,j=i;for(;j<src.length;j++){const c=src[j];if(c==='{')d++;else if(c==='}'){d--;if(d===0){j++;break;}}}return src.slice(m.index,j);}
const f=new Function("'use strict';"+extractFn('computeSyncStatus')+";return computeSyncStatus;")();
let PASS=0,FAIL=0; const fails=[];
const chk=(c,l)=>{ if(c)PASS++; else {FAIL++; fails.push(l);} };
const base={fbEnabled:true,hasUser:true,authorized:true,wsConnected:true,browserOnline:true,pending:0,lastSyncAgoSec:12,consecutiveFailures:0};

// pre-connection states
chk(f({...base,fbEnabled:false}).state==='local', 'local');
chk(f({...base,hasUser:false}).state==='connecting', 'connecting');
chk(f({...base,authorized:false}).state==='setup', 'setup');
// offline: WS down
let r=f({...base,wsConnected:false,pending:3});
chk(r.state==='offline-pending' && r.label.includes('3 pending'), 'offline-pending via WS: '+r.label);
chk(f({...base,wsConnected:false,pending:0}).state==='offline', 'offline clean via WS');
// offline: browser reports no network (WS monitor may lag)
r=f({...base,browserOnline:false,pending:2});
chk(r.state==='offline-pending' && r.label.includes('2 pending'), 'offline-pending via navigator.onLine: '+r.label);
// error after 3 consecutive failures (shows pending too)
r=f({...base,consecutiveFailures:3,pending:4});
chk(r.state==='error' && r.label.includes('4 pending'), 'error state: '+r.label);
chk(f({...base,consecutiveFailures:2,pending:0}).state==='synced', '2 failures not yet error');
// syncing window (<5s since last sync activity)
chk(f({...base,pending:2,lastSyncAgoSec:3}).state==='syncing', 'syncing <5s');
// ★ THE FIX: pending >5s must NOT be green
r=f({...base,pending:2,lastSyncAgoSec:60});
chk(r.state==='pending' && r.label.includes('2 pending'), 'stuck pending must not show Synced: '+r.state);
chk(f({...base,pending:1,lastSyncAgoSec:null}).state==='pending', 'pending with no sync history');
// clean
chk(f({...base}).state==='synced', 'synced');
// edge: garbage input
let crashed=false; try{ f(null); f({}); f({pending:-5}); }catch(e){ crashed=true; }
chk(!crashed, 'garbage inputs crashed');
chk(f({...base,pending:-5}).state==='synced', 'negative pending clamped');
// offline beats error (no point showing "failing" when there is no network)
chk(f({...base,wsConnected:false,consecutiveFailures:9,pending:1}).state==='offline-pending', 'offline takes precedence over error');

// ── static wiring ──
chk(src.includes('Back online — syncing'), 'reconnect flush toast missing');
chk((src.match(/addEventListener\('offline'/g)||[]).length>=1, 'browser offline listener missing');
chk((src.match(/pending count is live while offline/g)||[]).length===2, 'live badge refresh not wired in saveState+flushSave');
chk(src.includes('computeSyncStatus({'), 'badge not using the state machine');

console.log('Checks passed:', PASS, '· Failures:', FAIL);
if(FAIL) fails.forEach(f=>console.log('  ✗ '+f));
else console.log('✅ sync pill state machine correct: offline shows pending count, stuck edits never show green, reconnect flush wired.');
