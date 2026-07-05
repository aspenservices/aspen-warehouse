# Aspen Warehouse — Test Suite

Every test runs against the single-file app (`index.html`) by **extracting the real
functions** from it — no mocks of the logic itself, only of I/O (Firebase, DOM).
They were built alongside real bug fixes: each suite reproduces a bug that actually
happened (as a negative control) and proves the fix holds under fuzzing.

## Run locally
```bash
npm install acorn acorn-walk --no-save   # once, for the AST audit
node tests/run-all.js index.html
```

## What each test covers
| Test | Guards against |
|---|---|
| 01-syntax | Any syntax error in the inline scripts |
| 02-ast-audit | Calls to undefined functions, unexpected duplicate declarations |
| 03-sync-convergence | Merge divergence/data loss across devices (units, materials, covers, requests…) |
| 04-marriage-invariants | Marriage state-machine violations (34M assertions) |
| 05-provenance-trail | Marriage trail corruption |
| 06-factory-resurrection | Dispatched factory accessories/covers resurrecting from a stale peer |
| 07-id-collision | Two offline devices minting the same id |
| 08-cover-deduction | Warehouse-cover deduction at dispatch (idempotent, factory covers skipped) |
| 09-cover-reconcile | Historical cover back-fill (idempotent, floors at 0) |
| 10-storage-trim | localStorage quota-relief trim (valid JSON, operational data intact) |
| 11-wholesale-merges | Concurrent-add loss in events/queue/movements/maps; delete resurrection; LWW |
| 12-firebase-io | Per-push bandwidth regressions (full-node reads, extra writes, snapshot trail) |
| 13-escaping | XSS/robustness: escapeHTML behavior, unescaped user fields, Welcome apostrophe bug |
| 14-dispatch-status | Stale peers reverting 'returned'/'delivered' statuses; returned tubs vanishing |
| 15-ops-kpis | KPI math regressions (month bucketing, cycle time, return rates, top lists) |
| 16-scan-session | Batch-scan session: dedup/retry semantics, factory-request exemption, summary |
| 17-sync-status | Sync pill state machine: offline pending count, stuck-pending never green |
| 18-actor-identity | Per-person signatures on all action records (person first, role fallback) |
| 19-trash-bin | Universal trash: capture/restore/purge, tombstone clearing, LWW sync, 30d purge |
| 20-v2-sync | Per-collection sync v2: hash gating, atomic commits, convergence, bandwidth |
| 21-hardening | v5.23 deep corrections: undo-revive, hashed PINs, blob round-trip, mutex, archive |

## Conventions
- A test **passes** when it prints a `✅` line and no `Failures: N>0`.
- Heavy fuzz tests accept `N`/`SEED` env vars; CI uses `WHOLESALE_N=20000` (~8s).
- When you fix a bug: add a test that FAILS without the fix (negative control) and
  passes with it. Keep tests self-contained (extract functions from index.html).
