'use strict';
// Parses every inline <script> block with new Function — catches any syntax error
// introduced by an edit before it ever reaches a browser.
const fs=require('fs');
const h=fs.readFileSync(process.argv[2]||'index.html','utf8');
const re=/<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m,i=0,errs=0;
while((m=re.exec(h))){
  if(/\bsrc=/.test(m[1]||''))continue;
  if(/type=["'](application\/json|text\/template)/i.test(m[1]||''))continue;
  i++;
  try{ new Function(m[2]); }catch(x){ errs++; console.log('  ✗ script #'+i+':', x.message); }
}
console.log('Inline scripts:', i, '· Failures:', errs);
console.log(errs===0 ? '✅ all inline scripts parse cleanly' : '✗ SYNTAX ERRORS FOUND');
