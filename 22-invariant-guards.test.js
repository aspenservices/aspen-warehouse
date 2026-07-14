'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// 22 — ARCHITECTURAL INVARIANT GUARD
//
// WHY THIS EXISTS
// Every sync bug this app has shipped was an instance of a small number of CLASSES,
// not a one-off mistake. We kept fixing instances while the class stayed alive, so
// the same bug came back wearing a different collection's clothes:
//
//   CLASS A  a write with no updatedAt   → the edit can never win last-edit-wins
//                                          → the tub "bounces back" (scan reverts)
//   CLASS B  a delete with no tombstone  → a stale device re-pushes the row
//                                          → the tub "comes back from the dead"
//                                          (dispatched tubs on the floor; placed
//                                           arrivals reappearing in the panel)
//   CLASS C  a merge with no declared    → conflicts resolve by accident
//            conflict strategy             → work is silently discarded
//   CLASS D  a stamp comparison with no  → one tablet with a fast clock writes
//            plausibility cap              rows from the future that beat every
//                                          honest edit, forever
//   CLASS E  a tombstone map the cfg     → deletions are lost when two devices
//            merge does not union          sync → the row resurrects
//
// The invariants used to live in people's heads and in review discipline. Heads
// forget. This test makes them MACHINE-CHECKED: a change that reintroduces any
// class fails the build and never reaches the warehouse floor.
//
// If this test fails, do not weaken it — fix the code it points at. If a genuinely
// new pattern is safe, add it to the recognized strategies below with a comment
// explaining WHY it is safe, so the next person inherits the reasoning.
// ═══════════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = process.argv[2] || './index.html';
const src = fs.readFileSync(path, 'utf8');
const lines = src.split('\n');

let failures = 0;
const fail = (cls, msg) => { console.log(`  ✗ [CLASS ${cls}] ${msg}`); failures++; };
const pass = (msg) => console.log(`  ✓ ${msg}`);

// ── Code that legitimately does NOT stamp/tombstone ──────────────────────────
// Deterministic auto-healers must converge to the SAME result on every device, so
// they must not mint fresh stamps (that would make each device's copy "newest" and
// they would fight each other forever). Archivers and the test harness likewise.
const EXEMPT = new Set([
  'runIntegrityChecks', 'runSelfTests', 'showSelfTests', 'archiveOldDispatched',
  'fbApplyRemoteState', 'fbRestoreFromCloud', '_autoArchiveMovements',
  'normalizeFloorStacks', 'trashRestore',
]);
const fnAt = (n) => {
  for (let i = n; i >= 0; i--) {
    const m = /^(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/.exec(lines[i]);
    if (m) return m[1];
    if (/^(const|let|var)\s+_merge/.test(lines[i])) return '_merge';
  }
  return '?';
};
const exempt = (n) => EXEMPT.has(fnAt(n)) || /^_merge/.test(fnAt(n));

// ── The synced, row-bearing collections (read from the app — never hardcoded, or a
//    config change would silently escape the guard, which is exactly how the
//    movements/egress regression slipped past an older test). ──────────────────
const v2 = /const V2_COLLS = \[([^\]]*)\]/.exec(src);
if (!v2) { console.log('  ✗ V2_COLLS not found — cannot verify anything'); process.exit(1); }
const SHARED = v2[1].split(',').map(s => s.replace(/['\s]/g, '')).filter(Boolean);
const NON_ROW = new Set(['cfg', 'colorLibrary', 'coverModelMapping', 'activity']);
const ROWY = SHARED.filter(c => !NON_ROW.has(c));
console.log(`Row-bearing synced collections: ${ROWY.join(', ')}\n`);


// The strategy declaration must sit on the line IMMEDIATELY above the function.
// (A character-window search picks up the *previous* merge's declaration and lets an
//  undeclared merge slip through — exactly the kind of blind spot this file exists to
//  prevent, so the guard is strict about its own evidence.)
function stratOf(fnName) {
  const ln = lines.findIndex(l => new RegExp(`^\\s*function ${fnName}\\s*\\(`).test(l));
  if (ln < 0) return null;
  for (let k = ln - 1; k >= 0 && k >= ln - 3; k--) {
    const t = lines[k].trim();
    if (t === '') continue;
    const m = /^\/\/ MERGE-STRATEGY:\s*(\w+)$/.exec(t);
    return m ? m[1] : null;   // first non-blank line above must BE the declaration
  }
  return null;
}
function bodyOf(fnName) {
  const i = src.indexOf(`function ${fnName}(`);
  if (i < 0) return '';
  let end = src.indexOf('{', i), d = 0;
  for (; end < src.length; end++) { if (src[end] === '{') d++; else if (src[end] === '}') { d--; if (!d) break; } }
  return src.slice(i, end + 1);
}

// ═══ CLASS A — every row is born stamped, every state edit is stamped ═══
{
  let bad = 0;
  for (let i = 0; i < lines.length; i++) {
    if (exempt(i) || /^\s*(\/\/|\*)/.test(lines[i])) continue;
    const m = new RegExp(`\\b(${ROWY.join('|')})\\.(push|unshift)\\(`).exec(lines[i]);
    if (!m) continue;
    const blk = lines.slice(i, i + 18).join('\n');
    if (!/_born\(/.test(lines[i]) && !/updatedAt/.test(blk.slice(0, 600)) && !/touchUnit/.test(lines.slice(i - 2, i + 3).join('\n'))) {
      fail('A', `L${i + 1} ${fnAt(i)}(): ${m[1]} row created with no updatedAt — wrap it in _born({...}). A stampless row can never win a merge.`);
      bad++;
    }
  }
  if (!bad) pass('A1: every row in a synced collection is born stamped');
}
{
  let bad = 0;
  const FIELDS = /([A-Za-z_$][\w$]*)\.(pos|level|stack|trackingState|status|deliveryStatus)\s*=(?!=)/;
  const NOT_ROWS = /^(this|e|ev|el|opt|style|dataset|btn|card|node)$/;
  for (let i = 0; i < lines.length; i++) {
    if (exempt(i) || /^\s*(\/\/|\*)/.test(lines[i])) continue;
    const m = FIELDS.exec(lines[i]);
    if (!m || NOT_ROWS.test(m[1])) continue;
    const win = lines.slice(i, i + 4).join('\n');
    if (!/updatedAt|touchUnit|editStamp|_born/.test(win)) {
      fail('A', `L${i + 1} ${fnAt(i)}(): "${m[1]}.${m[2]} =" is not stamped — add ${m[1]}.updatedAt = editStamp(). Unstamped edits lose to a stale remote.`);
      bad++;
    }
  }
  if (!bad) pass('A2: every state mutation is stamped');
}

// ═══ CLASS B — every user-flow delete leaves a tombstone ═══
{
  const TOMB = {
    units: '_tombstoneUnitRow', factory: '_tombstoneFactoryRow',
    incoming: '_tombstoneIncomingRow', queue: '_tombstoneQueueItem',
    materials: '_tombstoneRowIn', marriages: '_tombstoneRowIn',
    events: '_tombstoneRowIn', coverInventory: '_tombstoneRowIn',
  };
  let bad = 0;
  for (let i = 0; i < lines.length; i++) {
    if (exempt(i) || /^\s*(\/\/|\*)/.test(lines[i])) continue;
    const m = new RegExp(`\\b(${Object.keys(TOMB).join('|')})(?:\\s*=\\s*\\1\\.filter\\(|\\.splice\\()`).exec(lines[i]);
    if (!m) continue;
    const ctx = lines.slice(Math.max(0, i - 8), i + 1).join('\n');
    if (!ctx.includes(TOMB[m[1]])) {
      fail('B', `L${i + 1} ${fnAt(i)}(): ${m[1]} row deleted with no ${TOMB[m[1]]}() — a stale device will resurrect it. Deletions cannot win last-edit-wins: they need a tombstone.`);
      bad++;
    }
  }
  if (!bad) pass('B: every user-flow deletion leaves a tombstone');
}

// ═══ CLASS C — every merge DECLARES its conflict-resolution strategy ═══
// A merge without a deliberate strategy resolves conflicts by accident. Each of
// these is safe for a different reason, and the reason must be stated:
//   lew          → last-edit-wins on updatedAt (rows the user edits in place)
//   rank         → monotonic workflow advance (a status can only move forward)
//   conservation → counters reconstructed from deltas (LEW would LOSE decrements)
//   union        → append-only ledger, union by id (nothing is ever overwritten)
{
  const STRATS = new Set(['lew', 'rank', 'conservation', 'union']);
  const merges = [...src.matchAll(/function (_merge[A-Za-z]+)\s*\(/g)].map(m => m[1]);
  let bad = 0;
  for (const fn of merges) {
    const strat = stratOf(fn);
    if (!strat) {
      fail('C', `${fn}() has no "// MERGE-STRATEGY:" line directly above it — every merge must state how it resolves conflicts (${[...STRATS].join(' | ')}).`);
      bad++; continue;
    }
    if (!STRATS.has(strat)) { fail('C', `${fn}(): unknown strategy "${strat}"`); bad++; continue; }
    const body = bodyOf(fn);
    if (strat === 'lew' && !/updatedAt|\bstamp\(/.test(body)) { fail('C', `${fn}() declares "lew" but never compares updatedAt`); bad++; }
    if (strat === 'rank' && !/rank/i.test(body)) { fail('C', `${fn}() declares "rank" but has no rank table`); bad++; }
  }
  if (!bad) pass(`C: all ${merges.length} merges declare a conflict-resolution strategy that matches their code`);
}

// ═══ CLASS D — every stamp comparison is plausibility-capped ═══
// One tablet with a fast clock can stamp rows in the future. Without a cap those
// rows beat every honest edit forever (this is what made tubs bounce back for days).
{
  const merges = [...src.matchAll(/function (_merge[A-Za-z]+)\s*\(/g)].map(m => m[1]);
  let bad = 0;
  for (const fn of merges) {
    const body = bodyOf(fn);
    const strat = stratOf(fn);
    const comparesStamps = /updatedAt/.test(body);
    if (comparesStamps && strat !== 'union' && !/_plausibleCap|_cap\b/.test(body)) {
      fail('D', `${fn}() compares updatedAt with no plausibility cap — a device with a fast clock can poison rows here permanently.`);
      bad++;
    }
  }
  if (!bad) pass('D: every stamp comparison is capped against a fast device clock');
}

// ═══ CLASS E — every tombstone map survives a cfg merge ═══
{
  // Detect BOTH forms the app uses: cfg._deletedX[...] and the generic _TOMB_MAP values.
  const written = new Set([...src.matchAll(/cfg\.(_deleted[A-Za-z]+)/g)].map(m => m[1]));
  for (const m of src.matchAll(/_deleted[A-Za-z]+/g)) if (/'_deleted[A-Za-z]+'/.test(src.slice(Math.max(0,m.index-1), m.index + m[0].length + 1))) written.add(m[0]);
  const u = /for\(const tk of \[([^\]]*)\]\)/.exec(src);
  const unioned = new Set(u ? u[1].split(',').map(s => s.replace(/['\s]/g, '')) : []);
  let bad = 0;
  for (const w of written) {
    if (!unioned.has(w)) {
      fail('E', `cfg.${w} is written but the cfg merge does not union it — one device's deletions are lost when it syncs with another, and the rows resurrect.`);
      bad++;
    }
  }
  if (!bad) pass(`E: all ${written.size} tombstone maps are unioned on cfg merge`);
}

// ═══ EGRESS — the ledger must never ride the per-change blob again ═══
// movements re-broadcast the whole array on every scan: 47 GB and $196 in one month.
{
  if (SHARED.includes('movements')) fail('X', 'movements is back in V2_COLLS — this re-broadcasts the whole ledger on every scan (the 47GB egress leak). It must ride its own per-child channel.');
  else pass('X: the movements ledger stays off the per-change blob (egress protection)');
}

console.log('');
if (failures) {
  console.log(`❌ ${failures} invariant violation(s). These are the bug classes that reverted scans, resurrected tubs, and cost $196 in egress. Fix the code — do not weaken the guard.`);
  process.exit(1);
}
console.log('✅ All architectural invariants hold: rows are born stamped, edits are stamped, deletions leave tombstones, every merge declares a strategy, stamp comparisons are clock-capped, tombstones survive cfg merges, and the ledger stays off the blob.');
