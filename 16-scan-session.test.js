'use strict';
// v5.16 — batch scan session. Tests the PURE core (new/shouldDedup/record/summary)
// extracted from index.html, plus the dedup semantics: double-scan of the same
// item is recorded as 'dup' and skipped, failed scans stay retryable, and
// 'factory-request' mode is exempt (repeat scans advance the request workflow).
const fs=require('fs'); const src=fs.readFileSync(process.argv[2]||'index.html','utf8');
function extractFn(name){const re=new RegExp('function\\s+'+name+'\\s*\\(','g');const m=re.exec(src);if(!m)throw new Error('not found '+name);let i=src.indexOf('{',m.index);let d=0,j=i;for(;j<src.length;j++){const c=src[j];if(c==='{')d++;else if(c==='}'){d--;if(d===0){j++;break;}}}return src.slice(m.index,j);}
const S=new Function("'use strict';"
  +extractFn('_scanSessionNew')+";"+extractFn('_scanSessionShouldDedup')+";"
  +extractFn('_scanSessionRecord')+";"+extractFn('_scanSessionSummary')+";"
  +"return {n:_scanSessionNew, d:_scanSessionShouldDedup, r:_scanSessionRecord, s:_scanSessionSummary};")();
let PASS=0,FAIL=0; const fails=[];
const chk=(c,l)=>{ if(c)PASS++; else {FAIL++; fails.push(l);} };

// ── truck-loading sequence: 3 tubs, one double-scanned, one fails then retries OK ──
const sess=S.n('load');
// tub 31066 OK
chk(!S.d(sess,'31066'), 'fresh key should not dedup');
S.r(sess,'31066','ok','31066','on truck');
// tub 31066 AGAIN → must dedup
chk(S.d(sess,'31066'), 'second scan of OK key must dedup');
S.r(sess,'31066','dup','31066','Already scanned this session');
// tub 31067 fails (wrong state) → retryable
S.r(sess,'31067','err','31067','not at factory');
chk(!S.d(sess,'31067'), 'failed scan must stay retryable (no dedup)');
// retry 31067 OK
S.r(sess,'31067','ok','31067','on truck');
chk(S.d(sess,'31067'), 'after successful retry the key dedups');
// tub 31068 OK
S.r(sess,'31068','ok','31068','on truck');
const sum=S.s(sess);
chk(sum.total===5 && sum.ok===3 && sum.dup===1 && sum.err===1 && sum.warn===0,
    'summary '+JSON.stringify(sum)+' (expected total5 ok3 dup1 err1)');

// ── factory-request exemption: repeat scans NEVER dedup ──
const fr=S.n('factory-request');
S.r(fr,'ITEM1','ok','ITEM1','approved');
chk(!S.d(fr,'ITEM1'), 'factory-request repeat scan must NOT dedup (workflow)');
S.r(fr,'ITEM1','ok','ITEM1','shipped');
S.r(fr,'ITEM1','ok','ITEM1','received');
chk(S.s(fr).ok===3, 'factory-request: all 3 stage-scans recorded');

// ── edge cases ──
chk(!S.d(null,'x') && !S.d(sess,'') , 'null session / empty key safe');
S.r(null,'x','ok','x','');   // no crash
const empty=S.n('receive');
chk(JSON.stringify(S.s(empty))===JSON.stringify({total:0,ok:0,dup:0,err:0,warn:0}), 'empty session summary');
S.r(empty,'','warn','—','no key');   // keyless record must not poison okKeys
chk(!S.d(empty,''), 'keyless record does not dedup');

// ── static wiring checks ──
chk(src.includes("_scanCallWithSession(code.data, mode)"), 'camera loop not routed through the session wrapper');
chk((src.match(/_scanCallWithSession\(/g)||[]).length>=4, 'manual-entry not routed through the wrapper');
chk(src.includes("_scanSession = _scanSessionNew(mode)"), 'session not created on scanner open');
chk(src.includes("_scanSession = null;") && src.includes('Scan session'), 'close summary/cleanup missing');
chk(src.includes("_scanSession._skipHook = true"), 'dup double-record guard missing');

console.log('Checks passed:', PASS, '· Failures:', FAIL);
if(FAIL) fails.forEach(f=>console.log('  ✗ '+f));
else console.log('✅ batch session: dedup/retry semantics correct, factory-request exempt, summary math right, wiring present.');
