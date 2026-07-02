'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  ASPEN WAREHOUSE — TEST SUITE RUNNER
//  Usage:  node tests/run-all.js [path/to/index.html]
//  Runs every *.test.js in this folder against the app file. A test PASSES when
//  its output contains a ✅ line and no non-zero "Failures: N". Exit code 1 if
//  anything fails — GitHub Actions marks the commit red.
//  Env: WHOLESALE_N (default 20000) scales the heaviest fuzz test for CI speed.
// ═══════════════════════════════════════════════════════════════════════════════
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const APP = process.argv[2] || 'index.html';
if(!fs.existsSync(APP)){ console.error('App file not found: ' + APP); process.exit(2); }
const dir = __dirname;
const tests = fs.readdirSync(dir).filter(f => /\.test\.js$/.test(f)).sort();
let failed = [];
console.log('═'.repeat(72));
console.log(' ASPEN WAREHOUSE TEST SUITE · ' + tests.length + ' tests · app: ' + APP);
console.log('═'.repeat(72));
for(const t of tests){
  const t0 = Date.now();
  let out = '', crashed = false;
  try {
    out = execFileSync('node', [path.join(dir, t), APP], {
      encoding: 'utf8', timeout: 10 * 60 * 1000,
      env: { ...process.env, N: process.env.WHOLESALE_N || '20000' }
    });
  } catch(e){ crashed = true; out = (e.stdout || '') + '\n' + (e.stderr || e.message); }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const hasFailures = /Failures?\s*:\s*[1-9]/.test(out);
  const hasPass = /✅/.test(out);
  const ok = !crashed && !hasFailures && hasPass;
  console.log((ok ? ' ✅ PASS ' : ' ❌ FAIL ') + t.padEnd(36) + secs.padStart(7) + 's');
  if(!ok){
    failed.push(t);
    console.log('─'.repeat(72));
    console.log(out.trim().split('\n').slice(-25).join('\n'));
    console.log('─'.repeat(72));
  }
}
console.log('═'.repeat(72));
if(failed.length){
  console.log(' ❌ ' + failed.length + ' TEST(S) FAILED: ' + failed.join(', '));
  process.exit(1);
}
console.log(' ✅ ALL ' + tests.length + ' TESTS PASSED — safe to ship.');
