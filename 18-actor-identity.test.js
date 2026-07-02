'use strict';
// v5.18 — per-person actor identity. Tests actorName() (person first, role
// fallback, never blank) and statically verifies the migration: NO action record
// still signs with the raw role label, addAct stores who, and the ticker shows it.
const fs=require('fs'); const src=fs.readFileSync(process.argv[2]||'index.html','utf8');
function extractFn(name){const re=new RegExp('function\\s+'+name+'\\s*\\(','g');const m=re.exec(src);if(!m)throw new Error('not found '+name);let i=src.indexOf('{',m.index);let d=0,j=i;for(;j<src.length;j++){const c=src[j];if(c==='{')d++;else if(c==='}'){d--;if(d===0){j++;break;}}}return src.slice(m.index,j);}
let PASS=0,FAIL=0; const fails=[];
const chk=(c,l)=>{ if(c)PASS++; else {FAIL++; fails.push(l);} };

function mk(user, role, roles){
  return new Function("'use strict'; let currentUser="+JSON.stringify(user)+", currentRole="+JSON.stringify(role)+"; const ROLES="+JSON.stringify(roles)+"; "+extractFn('actorName')+"; return actorName;")();
}
// person picked → person name
chk(mk({name:'Jeremy',role:'warehouse'},'warehouse',{warehouse:{label:'Warehouse'}})()==='Jeremy', 'person-first');
// no person → role label fallback
chk(mk(null,'factory',{factory:{label:'Factory'}})()==='Factory', 'role fallback');
// nothing at all → never blank
chk(mk(null,'ghost',{})()==='Unknown', 'unknown fallback');
chk(mk({name:''},'ghost',{})()==='Unknown', 'empty name falls through');

// ── static migration checks ──
const rawByRole = (src.match(/by:\s*ROLES\[currentRole\]\.label/g)||[]).length;
chk(rawByRole===0, rawByRole+' record(s) still sign with the raw role label');
const localByRole = (src.match(/const by = ROLES\[currentRole\]/g)||[]).length;
chk(localByRole===0, localByRole+' local by-var(s) still use the role');
chk((src.match(/by:\s*actorName\(\)/g)||[]).length>=30, 'expected ≥30 actorName() signatures, got '+(src.match(/by:\s*actorName\(\)/g)||[]).length);
chk(src.includes("w:(typeof actorName==='function'?actorName():'')"), 'addAct does not store who');
chk(src.includes('${escapeHTML(a.w)}'), 'activity ticker does not render who');
chk(src.includes('window.actorName = actorName'), 'actorName not exported');
// the manual confirmed-by input keeps priority over the auto identity
chk(src.includes("#dc-confirmed-by').value.trim() || actorName()"), 'manual confirmed-by override lost');

console.log('Checks passed:', PASS, '· Failures:', FAIL);
if(FAIL) fails.forEach(f=>console.log('  ✗ '+f));
else console.log('✅ every action record is signed by the person (role fallback intact, never blank); ticker shows who.');
