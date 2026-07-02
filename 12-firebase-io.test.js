'use strict';
// Mock-based validation of the v5.11 Firebase I/O fixes:
//  A. cleanupOldSnapshots — lists keys via REST shallow (no payload download), falls
//     back to SDK on REST failure, prunes the right keys, keeps the right count.
//  B. verifyCloudWrite — reads ONLY .../timestamp; accepts newer, rejects older.
//  C. static: fbCloudSync writes exactly 2 state locations (latest + shared), has the
//     guarded one-time purge, and NO per-push snapshot write remains.
const fs=require('fs'); const src=fs.readFileSync(process.argv[2]||'/home/claude/index.html','utf8');
function extractFn(name){const re=new RegExp('(async\\s+)?function\\s+'+name+'\\s*\\(','g');const m=re.exec(src);let i=src.indexOf('{',m.index);let d=0,j=i;for(;j<src.length;j++){const c=src[j];if(c==='{')d++;else if(c==='}'){d--;if(d===0){j++;break;}}}return src.slice(m.index,j);}
let PASS=0,FAIL=0; const fails=[];
const chk=(c,l)=>{ if(c)PASS++; else {FAIL++; fails.push(l);} };

(async()=>{
  // ── A. cleanupOldSnapshots with mocks ──
  const removed=[]; let restCalls=0, sdkReads=0;
  const keys={'auto_daily_2026-05-01':1,'auto_daily_2026-05-02':1,'auto_daily_2026-05-03':1,'auto_daily_2026-06-01':1,'auto_boot_x':1};
  function mkSandbox(restOk){
    removed.length=0; restCalls=0; sdkReads=0;
    const ref={ child:k=>({ remove:async()=>{removed.push(k); delete keys[k];} }), once:async()=>{ sdkReads++; const o={}; for(const k in keys) o[k]={huge:'payload'}; return {val:()=>o}; } };
    const sandbox=new Function('fetchImpl','refImpl',`'use strict';
      const _fbDb={ ref:()=>refImpl, app:{options:{databaseURL:'https://x.firebaseio.com'}} };
      const _fbDeviceId='dev1';
      const _fbUser={ getIdToken: async()=>'tok' };
      const fetch=fetchImpl; const console={log(){},warn(){}};
      ${extractFn('cleanupOldSnapshots')}
      return cleanupOldSnapshots;
    `)(async(url)=>{ restCalls++; if(!restOk) throw new Error('rest down');
        chk(url.includes('shallow=true'),'A: REST url lacks shallow=true');
        chk(url.includes('auth=tok'),'A: REST url lacks auth token');
        const o={}; for(const k in keys) o[k]=true; return { ok:true, json:async()=>o }; }, ref);
    return sandbox;
  }
  // A1: REST path — prune daily to keep 2 (4 daily → delete 2 oldest), no SDK read
  Object.assign(keys,{'auto_daily_2026-05-01':1,'auto_daily_2026-05-02':1,'auto_daily_2026-05-03':1,'auto_daily_2026-06-01':1});
  await mkSandbox(true)('auto_daily_', 2);
  chk(restCalls===1 && sdkReads===0, 'A1: expected REST-only listing (rest='+restCalls+' sdk='+sdkReads+')');
  chk(removed.join(',')==='auto_daily_2026-05-01,auto_daily_2026-05-02', 'A1: wrong keys pruned: '+removed.join(','));
  chk(!removed.includes('auto_boot_x'), 'A1: touched non-matching prefix');
  // A2: REST down → falls back to SDK read, same result
  keys['auto_daily_2026-05-01']=1; keys['auto_daily_2026-05-02']=1;  // restore
  await mkSandbox(false)('auto_daily_', 2);
  chk(sdkReads===1, 'A2: fallback SDK read not used');
  chk(removed.length===2, 'A2: fallback pruned '+removed.length+' (expected 2)');

  // ── B. verifyCloudWrite with mocks ──
  function mkVerify(cloudTs){
    let readPath='';
    const sb=new Function('cap',`'use strict';
      let _fbConsecutiveFailures=0;
      const _fbDb={ ref:p=>{ cap.path=p; return { once:async()=>({ val:()=>${JSON.stringify(cloudTs)} }) }; } };
      const _fbUser={}, _fbAuthorized=true; const console={warn(){},log(){}};
      ${extractFn('verifyCloudWrite')}
      return { verifyCloudWrite, fails:()=>_fbConsecutiveFailures };
    `);
    const cap={}; const o=sb(cap); o.cap=cap; return o;
  }
  let v=mkVerify(1000); let ok=await v.verifyCloudWrite(1000);
  chk(v.cap.path==='state/shared/latest/timestamp', 'B: reads wrong path: '+v.cap.path);
  chk(ok===true, 'B: equal ts should pass');
  v=mkVerify(2000); ok=await v.verifyCloudWrite(1000);
  chk(ok===true, 'B: newer cloud ts should pass (another device pushed)');
  v=mkVerify(500); ok=await v.verifyCloudWrite(1000);
  chk(ok===false && v.fails()===1, 'B: older cloud ts must fail');
  v=mkVerify(null); ok=await v.verifyCloudWrite(1000);
  chk(ok===false, 'B: empty cloud must fail');

  // ── C. static assertions on fbCloudSync ──
  const fcs = extractFn('fbCloudSync');
  const setsOnState = (fcs.match(/\.ref\(`state\/[^`]*`\)\.set\(|\.ref\('state\/shared\/latest'\)\.set\(/g)||[]).length;
  chk(setsOnState===2, 'C: fbCloudSync state writes = '+setsOnState+' (expected 2: device latest + shared)');
  chk(!/snapshots\/\$\{ts\}/.test(fcs), 'C: per-push snapshot write still present!');
  chk(/aspen_snapshots_purged_v511/.test(fcs) && /\.remove\(\)/.test(fcs), 'C: one-time purge missing');
  chk((fcs.match(/once\('value'\)/g)||[]).length===0, 'C: fbCloudSync still has a full-node read: '+(fcs.match(/once\('value'\)/g)||[]).length);

  console.log('Checks passed:', PASS, '· Failures:', FAIL);
  if(FAIL) fails.forEach(f=>console.log('  ✗ '+f));
  else console.log('✅ shallow key-listing + fallback OK; verify reads only /timestamp; push writes exactly 2 locations, purge guarded, zero full-node reads in the push path.');
})();
