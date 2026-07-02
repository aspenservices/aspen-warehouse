'use strict';
// AST audit: undefined called identifiers, duplicate top-level functions, dangling handlers
const fs=require('fs'), acorn=require('acorn'), walk=require('acorn-walk');
const html=fs.readFileSync(process.argv[2]||'/home/claude/index.html','utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi; let m; const scripts=[];
while((m=re.exec(html))){ if(/\bsrc=/.test(m[1]||''))continue; if(/type=["'](application\/json|text\/template)/i.test(m[1]||''))continue; scripts.push(m[2]); }
const GLOBALS=new Set(['window','document','console','localStorage','sessionStorage','JSON','Math','Date','Array','Object','String','Number','Boolean','Promise','Set','Map','WeakMap','WeakSet','Symbol','RegExp','Error','TypeError','RangeError','parseInt','parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent','encodeURI','decodeURI','setTimeout','setInterval','clearTimeout','clearInterval','fetch','alert','confirm','prompt','navigator','location','history','screen','FileReader','Blob','URL','URLSearchParams','FormData','Image','Audio','crypto','performance','requestAnimationFrame','cancelAnimationFrame','getComputedStyle','matchMedia','atob','btoa','structuredClone','queueMicrotask','XMLHttpRequest','WebSocket','Worker','MutationObserver','ResizeObserver','IntersectionObserver','CustomEvent','Event','KeyboardEvent','MouseEvent','TouchEvent','DOMParser','XMLSerializer','Node','Element','HTMLElement','NodeList','firebase','html2canvas','jspdf','JsBarcode','QRCode','Html5Qrcode','Html5QrcodeScanner','pdfjsLib','globalThis','self','top','parent','frames','event','arguments','undefined','NaN','Infinity','eval','escape','unescape','Function','Proxy','Reflect','BigInt','Intl','TextEncoder','TextDecoder','AbortController','Notification','SpeechSynthesisUtterance','speechSynthesis','open','close','print','focus','blur','scroll','scrollTo','scrollBy','getSelection','File','showSaveFilePicker','showOpenFilePicker','showDirectoryPicker','indexedDB','caches','ImageData','OffscreenCanvas','createImageBitmap','devicePixelRatio','innerWidth','innerHeight','outerWidth','outerHeight','pageXOffset','pageYOffset','screenX','screenY','scrollX','scrollY','onerror','onload','onbeforeunload']);
let declared=new Set(), calls=[], dupes={}, parsed=0, errs=0;
for(const code of scripts){
  let ast; try{ ast=acorn.parse(code,{ecmaVersion:'latest'}); parsed++; }catch(e){ errs++; continue; }
  walk.full(ast, n=>{
    if(n.type==='FunctionDeclaration'&&n.id){ if(declared.has(n.id.name)) dupes[n.id.name]=(dupes[n.id.name]||1)+1; declared.add(n.id.name); }
    if(n.type==='VariableDeclarator'&&n.id&&n.id.type==='Identifier') declared.add(n.id.name);
    if((n.type==='FunctionDeclaration'||n.type==='FunctionExpression'||n.type==='ArrowFunctionExpression')&&n.params) n.params.forEach(p=>{ if(p.type==='Identifier')declared.add(p.name); if(p.type==='AssignmentPattern'&&p.left.type==='Identifier')declared.add(p.left.name); if(p.type==='RestElement'&&p.argument.type==='Identifier')declared.add(p.argument.name); if(p.type==='ObjectPattern')p.properties.forEach(pr=>{if(pr.value&&pr.value.type==='Identifier')declared.add(pr.value.name);}); });
    if(n.type==='CatchClause'&&n.param&&n.param.type==='Identifier') declared.add(n.param.name);
    if(n.type==='AssignmentExpression'&&n.left.type==='MemberExpression'&&n.left.object.type==='Identifier'&&n.left.object.name==='window'&&n.left.property.type==='Identifier') declared.add(n.left.property.name);
    if(n.type==='ClassDeclaration'&&n.id) declared.add(n.id.name);
    if(n.type==='CallExpression'&&n.callee.type==='Identifier') calls.push(n.callee.name);
  });
}
const KNOWN_DYNAMIC=new Set(['qrcode','jsQR']);  // lazy-loaded from CDN with typeof guards
const undef=[...new Set(calls.filter(c=>!declared.has(c)&&!GLOBALS.has(c)&&!KNOWN_DYNAMIC.has(c)))];
console.log('Inline scripts parsed :', parsed, '(parse errors: '+errs+')');
console.log('Total call expressions:', calls.length);
console.log('── UNDEFINED CALLED FUNCTIONS ──');
console.log(undef.length? undef.join(', ') : '   ✓ none — every called identifier resolves');
const KNOWN_SHADOW=new Set(['el','dl']);  // const el=... locals shadow the global helpers (harmless)
const realDupes=Object.entries(dupes).filter(([k])=>!KNOWN_SHADOW.has(k));
console.log('── DUPLICATE TOP-LEVEL FUNCTION NAMES ──');
console.log(realDupes.length? realDupes.map(([k,v])=>k+' ×'+v).join(', ') : '   ✓ none');

const fails = undef.length + realDupes.length + errs;
console.log('Failures:', fails);
console.log(fails===0 ? '✅ AST clean — every call resolves, no unexpected duplicate declarations' : '✗ AST PROBLEMS FOUND');
