# Maintenance and performance refresh — October 22, 2026

This refresh updates dependencies, implements twenty distinct performance improvements, and strengthens transfer and restore security. All changes are local; no production migration, deployment, publication, or commit has been performed.

## Dependencies

All 43 direct npm dependencies were checked against their current stable releases; 15 packages were updated. The refreshed lockfile has **zero known npm advisory findings**, down from two moderate findings. Production-only audit also reports zero. Updates include pnpm 10.34.7, the release workflow's npm 12.2.1, four immutable GitHub Action pins, the official Node 24.22.1 container digest, and setuptools 84.2.1 as the Python build-backend minimum.

The [dependency inventory](dependency-refresh-2026-10-22.md) records every before/after version, primary sources, compatibility checks, and exceptions. pnpm's major migration to 11/12 is intentionally deferred; this refresh uses the maintained 10.x security patch. The tsup 9 build upgrade requires Node `^22.18.0 || ^24.11.0 || >=26.0.0`; published SDK/CLI runtime floors are unchanged.

## Twenty performance improvements

Each row represents one new behavior. Existing directory pagination, existing file-tool lazy loading, dependency updates, and security fixes are not counted as additional features.

| # | Improvement | Evidence / effect |
| --- | --- | --- |
| 1 | Reusable directory search/sort index | Normalize, parse dates, sort, and build path/selection lookups once per snapshot. |
| 2 | Deferred directory filtering | Keep immediate input separate from deferred results; guard actions while results are stale. |
| 3 | Lazy directory workflow panels | Advanced/selection workflows load on first opening; 18 local modules leave the eager source graph. |
| 4 | Visibility-gated editor transformations | Closed cleanup/replacement panels perform no preview transformations; undo survives closing. |
| 5 | Indexed caret and line navigation | Binary-search Unicode positions and direct line lookup replace repeated prefix scans. |
| 6 | Paginated draft diffs | Render at most 100 rows; an 8,000-row fixture retains all 80 reachable pages. |
| 7 | On-demand CSV profiling | Stable source rows avoid recomputation during filtering/paging; closed profiles do no scans. |
| 8 | Cancellable file-tool reads | Abort obsolete requests and suppress stale parsing, data, errors, and loading updates. |
| 9 | Atomic folder-chain creation | Up to 200 D1 calls become one transactional batch. |
| 10 | Indexed literal subtree reads | Owner/path range seeks replace owner-wide prefix scans while preserving literal semantics. |
| 11 | Batched run artifact lifecycle | Bound-JSON queries remove per-input fetches and oversized SQL binding lists. |
| 12 | Batched duplicate-file pages | A full twenty-group page uses two database calls instead of 21. |
| 13 | Folder deletion without subtree materialization | Preserve recovery records without returning the entire subtree to the Worker. |
| 14 | Batched garbage collection | A hundred-object page uses one R2 call and two D1 calls instead of 100 and 201. |
| 15 | Batched durable outbox dispatch | Up to fifty messages use one queue call; mark dispatched only after successful send. |
| 16 | Covering owner index for storage usage | Restrict physical-storage accounting to the requested owner's usage records. |
| 17 | Bounded parallel SDK multipart uploads | `upload` defaults to three workers, configurable 1–8; custom `uploadSource` stays sequential by default. |
| 18 | Reuse upload fingerprint bytes/hash | N-part uploads perform N reads/hashes instead of N+1. |
| 19 | Indexed resume-part verification | Validate metadata once and use linear total map lookups; still hash every reused local part. |
| 20 | Bounded parallel CLI folder downloads | Default four simultaneous file streams, configurable 1–8 via `--concurrency`. |

The [browser report](browser-performance-2026-10-22.md), [server report](server-performance-2026-10-22.md), and [transfer report](transfer-performance-2026-10-22.md) provide implementation links, reproducible fixtures, security constraints, and limits. Call counts are not billing-unit or production-latency claims.

Reproducible local measurements:

- A 10,000-entry SQLite subtree fixture executes 164 VM instructions after the change versus 80,046 before, returning the same ten rows.
- The storage-usage fixture executes 759 VM instructions versus 30,728 before, returning the same total.
- Six 8 MiB SDK parts with a simulated 50 ms response delay take 374 ms sequentially and 121 ms with three workers; both transfer exactly 50,331,648 bytes using six source reads. This measures scheduling under simulated latency, not production bandwidth.

Run `python3 docs/server-performance-2026-10-22.bench.py` and `node scripts/transfer-benchmark.mjs` after building the SDK to reproduce. Timings vary by machine.

## Security and compatibility

- CLI/SDK API requests reject redirects, unsafe credential origins, and paths that normalize outside `/api/v1/`.
- Empty-file upload capabilities validate IDs and endpoint paths and always stay on the configured client origin. Canonical hostname aliases work without disclosing capabilities to an advertised foreign origin.
- SDK retry budgets must be finite bounded integers. Consumed streaming bodies are never retried. Concurrent transfers stop scheduling on failure, wait for active work, and preserve the first error.
- Resume metadata rejects duplicate/out-of-range part numbers and malformed hashes. Duplicate download destinations are rejected before writes; existing atomic replacement, size checks, and symlink checks remain active.
- Browser data stays within mounted components; no persistent private-data cache was introduced. Database changes preserve owner filters, live authorization, transaction-time guards, retention, and retry records.
- CLI tests resolve SDK source, so tests do not require previously generated SDK outputs. All 49 SDK/CLI tests passed with `packages/sdk/dist` absent.

Independent review found and verified fixes for the CLI clean-checkout test issue and empty-upload hostname compatibility. A second transfer review passed all 49 focused tests and found no remaining actionable regression. Server and browser implementation reviews also found no introduced blockers.

The broader security review and follow-up reproduced four pre-existing restore issues. All four are fixed:

- **Recovery destination authorization:** always authorize writes to the destination, even if a concurrently purged group leaves the selection empty. Empty authorized selections return 404 before any ancestor creation; unauthorized destinations return 403.
- **Snapshot expiry:** compare expiry with database execution time and capture one eligibility decision for the entire transaction. A temporary snapshot header is removed before commit or rolled back on failure. Expiry during the batch cannot leave only part of the subtree restored.
- **Recovery expiry:** each insertion validates against the later of request time and database execution time. An expired row aborts and rolls back the entire restore batch, preserving existing entries and recovery records.
- **Recovery atomicity:** ancestor creation, restored entries, recovery deletion, and change-log writes now share one transaction. Parent-first insertion and transaction-time parent/ancestor checks prevent orphan entries. Failure leaves no newly created ancestor folders behind.

The new suites contain 34 recovery and 21 snapshot tests. Regressions reproduced the original failures before the fixes; tests exercise actual migrated SQLite and production query/GC logic, with R2 mocked for deterministic expiry races.

The final independent review reran all 55 restore-security tests, confirmed unchanged source hashes, and cleared the recovery atomicity finding. It found no actionable correctness or security regression in the reviewed fixes. The earlier permission and expiry fixes remained intact.

## Combined verification

The complete workspace build, typechecks, and **432 workspace tests** passed after the restore-race fixes, including 367 web, 20 SDK, 29 CLI, 5 database, 2 contracts, 2 preview, and 7 CIMD tests. All **seven Python tests** also passed. Frozen installation, current dependency audit, an empty outdated report, Python wheel construction, and whitespace checks passed as recorded in the component reports.

The final disposable Cloudflare Workers integration run after the security fixes exited successfully with no logged runtime errors. It passed auth/owner isolation, token and share boundaries, OAuth/PKCE/CIMD, sync, backup checksums, recovery, workspaces, expansion features, and real queue-to-search indexing. The new `performance-smoke.mjs` additionally passed:

- Repeated 100-level folder creation with correct parent links.
- Completion and idempotent replay of a run with 50 retained inputs and 200 distinct output paths backed by actual R2 objects.
- Three-part parallel upload with monotonic progress and exact SHA-256 equality after download.
- SDK and built-CLI empty uploads through `127.0.0.1` while `APP_URL` uses `localhost`.
- Built-CLI folder downloads with concurrency two, nested and empty directories, empty files, text, and binary contents.

Browser verification of the built app covered directory filtering/selection, first-open lazy chunks, text editing/saving, cleanup and replacement undo after closing/reopening, Unicode caret navigation, CSV profiles across filtering, and draft diff pagination. A 250-line proposal showed 100 rows initially and all remaining rows on later pages. At a 390px mobile viewport, the files toolbar, tools, and draft review fit without horizontal page overflow after correcting the selected-download button's flex sizing.

One browser request overlapped the integration suite's direct SQLite fixture writes and received `SQLITE_BUSY_SNAPSHOT`; the same endpoint returned 200 after those writes finished. Browser checks were then performed separately. This is recorded as local fixture contention, not a production load test.

A high-confidence secret-pattern scan of 444 nonignored text files found only two deliberate fake private-key markers in existing reliability tests; no actual secret matched those patterns. This limited pattern scan is not a full secret-history audit.

## Rollout requirements and limits

Apply additive migration `0014_storage_usage_owner.sql` before expecting the storage-quota index benefit. It changes no stored data and old code remains compatible. Existing deployment commands are documented in the root README.

Local validation uses Node 26.11.1 and Python 3.14.8. Hosted GitHub/OIDC publishing, production services, and the actual CIMD Docker image have not been executed in this environment; Docker has no available daemon. npm audit is advisory-based and does not establish that all application or container vulnerabilities are absent. Security validation covers reviewed source and tested boundaries, not an absolute guarantee.
