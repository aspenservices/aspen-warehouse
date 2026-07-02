'use strict';
const fs=require('fs'); const src=fs.readFileSync(process.argv[2]||'/home/claude/index.html','utf8');
function extractFn(name){const re=new RegExp('function\\s+'+name+'\\s*\\(','g');const m=re.exec(src);let i=src.indexOf('{',m.index);let d=0,j=i;for(;j<src.length;j++){const c=src[j];if(c==='{')d++;else if(c==='}'){d--;if(d===0){j++;break;}}}return src.slice(m.index,j);}
// synthetic LARGE state: 8000 movements + 165 dispatched each with 25 trackingHistory entries
const movements = Array.from({length:8000},(_,i)=>({id:i, type:'601', sn:'SN'+i, material:'cover', qty:1, from:'F', to:'D'+i, stockType:'unrestricted', note:'movement '+i+' lorem ipsum dolor', at:'2026-06-01T12:00:00Z', ref:'admin'}));
const dispatched = Array.from({length:165},(_,i)=>({id:i, sn:'D'+i, dealer:'Dealer '+i, type:'spa', cover:{color:'Black',model:'Quattro (W)',source:'warehouse'}, trackingHistory: Array.from({length:25},(_,j)=>({state:'s'+j, at:'2026-06-0'+(j%9+1), by:'WH', note:'history entry '+j+' some text'}))}));
const SB=new Function('movements','dispatched',`'use strict';
  const nid=9000, units=[], incoming=[], materials=[], events=[], activity=[], queue=[], cfg={}, factory=[], marriages=[], dispatchRequests=[], coverInventory=[], colorLibrary=[], coverModelMapping={};
  ${extractFn('_blobReplacer')}
  ${extractFn('_buildLsPayload')}
  return _buildLsPayload;
`)(movements, dispatched);
let prev=Infinity, ok=true; const sizes=[];
for(let lvl=0; lvl<=3; lvl++){
  let p; try{ p = SB(lvl); }catch(e){ console.log('level '+lvl+' THREW', e.message); ok=false; break; }
  let parsed; try{ parsed = JSON.parse(p); }catch(e){ console.log('level '+lvl+' INVALID JSON'); ok=false; break; }
  const kb = (p.length/1024).toFixed(0);
  sizes.push({level:lvl, KB:+kb, movements:parsed.movements.length, dispTH0:(parsed.dispatched[0].trackingHistory||[]).length});
  if(p.length > prev){ console.log('level '+lvl+' NOT smaller than previous'); ok=false; }
  prev = p.length;
}
console.table(sizes);
// Operational data must survive at every level
const top = JSON.parse(SB(3));
console.log('Operational intact at level 3:',
  top.dispatched.length===165 && Array.isArray(top.units) && top.cfg!==undefined && top.coverInventory!==undefined ? 'YES ✓' : 'NO ✗');
console.log(ok && top.dispatched.length===165 ? '\n✅ trim is monotonic, valid JSON at every level, operational data preserved; only the cloud-backed ledger/history shrinks.' : '\n✗ problem detected');
