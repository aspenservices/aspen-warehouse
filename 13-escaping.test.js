'use strict';
// Guards the v5.13 escaping work: (1) escapeHTML neutralizes quotes/apostrophes/<>&,
// (2) no user-entered field is interpolated unescaped in a TEXT-NODE position,
// (3) the Welcome cards use index-based onclick (no inline name string).
const fs=require('fs');
const src=fs.readFileSync(process.argv[2]||'index.html','utf8');
let fails=0;
// 1. unit-test the real escapeHTML
const m=/function escapeHTML\(s\)\{[^\n]*\}/.exec(src);
if(!m){ console.log('  ✗ escapeHTML definition not found'); fails++; }
else {
  const f=new Function('return '+m[0].replace('function escapeHTML','function')+';')();
  const cases=[["O'Brien & Sons <Pools>","O&#39;Brien &amp; Sons &lt;Pools&gt;"],['Say "hi"','Say &quot;hi&quot;'],[null,''],[undefined,''],[123,'123']];
  for(const [inp,exp] of cases){ const got=f(inp); if(got!==exp){ console.log('  ✗ escapeHTML('+JSON.stringify(inp)+') = '+JSON.stringify(got)+' expected '+JSON.stringify(exp)); fails++; } }
}
// 2. no unescaped user fields in text-node position
const pat=/>\s*\$\{(?:u|f|d|r|m|e|it|item|ev|q|qi|rec|x|acc|lm|t)\.(?:dealer|notes|accessoryName|customer|name)(?:\|\|[^}]*)?\}/g;
const hits=src.match(pat)||[];
if(hits.length){ console.log('  ✗ '+hits.length+' unescaped user-field text interpolation(s):', hits.slice(0,3).join(' | ')); fails+=hits.length; }
// 3. welcome onclick is index-based
if(!src.includes("pickUser(TEAM_MEMBERS[${i}].name)")){ console.log('  ✗ Welcome onclick regressed to inline name string'); fails++; }
console.log('Failures:', fails);
console.log(fails===0 ? '✅ escaping guards hold — quotes safe, text nodes escaped, Welcome apostrophe-proof' : '✗ ESCAPING REGRESSION');
