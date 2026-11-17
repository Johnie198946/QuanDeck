# Project storage measurement — 2026-11-17

Status: TESTED locally; native end-to-end profiling belongs to the root task.

The user database was opened with SQLite `mode=ro` and `PRAGMA query_only=ON` and copied as a logical library into a private temporary fixture. Both implementations used the same fixed snapshot: 8 projects, 11,672,311 UTF-8 bytes total; active project 1,204,999 bytes. No live database writes, Agent calls or network requests were performed. Business payloads and identifiers are excluded from this record.

Baseline: commit `40dc863`, monolithic JSON document. Candidate: schema 3 project rows with a small catalog and delta writes. Each case created its own temporary database, then ran 15 updates to the active project's revision, preserving all existing history. Commit time includes JSON serialization, immutable-fact validation, SQLite transaction, and durable projection enqueue. Single-project read measures the corresponding public storage method. This is a storage benchmark, not an App responsiveness or user-facing latency measurement.

| Measurement | Baseline | Project partitions |
|---|---:|---:|
| Commit median | 112.314 ms | 15.052 ms |
| Commit maximum | 165.082 ms | 19.527 ms |
| Read one project median | 48.956 ms | 4.393 ms |
| Read one project maximum | 57.071 ms | 5.615 ms |
| Bytes serialized per mutation | 11,672,311 | 1,205,968 |
| Catalog stored bytes | 11,672,311 | 1,394 |

All seven other project rows remained byte-identical with unchanged row revisions across the 15 updates. A delta write still scans the changed project's own immutable history and its source bindings; it does not scan other projects' histories. Global provider-session ownership is verified through the execution-link collection index.

Automated verification includes unchanged-project serialization rejection, CAS conflict rejection, history tamper rollback, post-failure cache safety, global source ownership, real schema 2 monolithic upgrade, rollback copy equality, repeated migration idempotency, corrupt-index migration rejection, schema 3 erasure, and backup restore. The regular test runner includes these regressions.

The anonymized fact inventory is in `project-memory-partitions-20261117.json`. Immutable fact totals include operational events and receipts and must not be described as a count of project memories. No historic records were deleted for this optimization.

Reproduction used a private local harness at `/private/tmp/quandeck-project-partition-bench-20261117/bench.mjs`; its inputs contain local user data and are deliberately not committed. Machine load can affect the absolute timing. Cold startup still hydrates project snapshots; this work does not claim fully lazy history loading.
