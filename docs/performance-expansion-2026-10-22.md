# Fifty additional performance improvements — October 22, 2026

All fifty additional behaviors are implemented, bringing this maintenance effort to **70 performance improvements** with the [first twenty](maintenance-2026-10-22.md). The final build, tests, typechecks, full integration, and independent reviews passed. This report records verification completed before commit and production rollout.

## Exact inventory

The comparison baseline is the fully verified first-phase working tree, saved before this pass at `/tmp/agfs-plus50-baseline-20261022`. Existing optimizations, dependency updates, security fixes, tests, and documentation do not count again. Each numbered item has its own bottleneck and observable behavior; related indexes and Python resume optimizations are grouped rather than counted individually.

| Numbers | Area | Count | Detailed source inventory and evidence |
| --- | --- | ---: | --- |
| 21–37 | Browser and data tools | 17 | [Browser report](performance-expansion-browser-2026-10-22.md) |
| 38–54 | Server and database | 17 | [Server report](performance-expansion-server-2026-10-22.md) |
| 55–70 | SDKs, transfers, and CLI | 16 | [Client report](performance-expansion-clients-2026-10-22.md) |

| # | Additional behavior |
| --- | --- |
| 21 | Parse exact JSON in one pass. |
| 22 | Use rolling LCS score rows and packed traceback bits. |
| 23 | Filter collapsed JSON subtrees in linear traversal. |
| 24 | Format JSON only when requested. |
| 25 | Prepare reusable CSV search text and row references. |
| 26 | Prepare JSONL search without retaining unused parsed trees. |
| 27 | Select the five most common CSV values without sorting every distinct value. |
| 28 | Generate JSON-to-CSV rows without building a projected matrix. |
| 29 | Compile globs and reuse their matching buffers. |
| 30 | Compile JSON pointers once for record filtering. |
| 31 | Validate JSONL aggregates without serializing and reparsing them. |
| 32 | Replace text in one match traversal. |
| 33 | Load context files through a sliding, cancellable three-reader pool. |
| 34 | Upload three folder files concurrently. |
| 35 | Coalesce upload progress updates into animation frames. |
| 36 | Render text comparisons in pages of 100 rows. |
| 37 | Prepare run comparisons once, paginate artifacts, and format metadata on demand. |
| 38 | Load only the platform extension selected by the route. |
| 39 | Read file ownership and notes in one joined query. |
| 40 | Read collection ownership and items in one joined query. |
| 41 | Read change checkpoints and retained-history floors together. |
| 42 | Fetch the seven health sections in one database batch. |
| 43 | Evaluate health in bounded owner pages with batched alert updates. |
| 44 | Prefetch three search-index object bodies at a time. |
| 45 | Reuse verified indexed content for unchanged immutable object keys. |
| 46 | Index share listing, revocation, and view cleanup. |
| 47 | Deliver three independent webhooks concurrently. |
| 48 | Index active multipart resume lookup. |
| 49 | Serve preview HEAD requests from R2 metadata only. |
| 50 | Stream supported single byte ranges instead of whole downloads. |
| 51 | Index six recurring retention discovery workloads. |
| 52 | Record and trim recent history in one atomic batch. |
| 53 | Batch draft preflight and bound the final transaction's SQL parameters. |
| 54 | Index webhook fanout by owner and enabled state. |
| 55 | Compile CLI sync ignore patterns once per cycle. |
| 56 | Hash local sync files with bounded concurrency. |
| 57 | Overlap local and remote sync discovery. |
| 58 | List remote sync folders concurrently. |
| 59 | Skip initial content reads for files with unequal sizes. |
| 60 | Compare initial equal-size files concurrently. |
| 61 | Avoid rereading unchanged files for a second hash. |
| 62 | Coalesce atomic sync checkpoints. |
| 63 | Hash downloaded files during their atomic write. |
| 64 | Avoid progress-formatting work when output is not visible. |
| 65 | Avoid redundant CLI upload-buffer copies. |
| 66 | Map sync or async iterables lazily with bounded concurrency. |
| 67 | Upload nonseekable streams through the TypeScript SDK. |
| 68 | Download atomically with a reusable buffer in Python. |
| 69 | Prepare Python upload parts ahead of sequential network requests. |
| 70 | Reuse Python resume fingerprints, part hashes, and indexed metadata. |

## Dependency follow-up

The refreshed registry check found Wrangler 4.152.0 after the initial dependency pass. The three existing exact devDependency pins and lockfile were updated. Frozen installation passed, the recursive outdated report was empty, and full and production npm advisory audits reported zero known vulnerabilities. No new application dependency was added. The [dependency report addendum](dependency-refresh-2026-10-22.md#follow-up-during-the-fifty-feature-expansion) records the metadata and retained major-version deferrals.

## Review and security

Independent reviews compare this phase with the saved first-phase baseline. Browser review found no actionable findings, independently reran 104 focused tests and 83,000 differential cases, and added 43,000 comparisons plus 23 boundary probes. The source hashes were unchanged throughout that review.

Client and server reviews found eight actionable issues. All have been fixed and cleared by independent follow-up reviews:

- Python destination normalization could erase a symlink-containing `..` component.
- Python download staging could be replaced before publication.
- Lazy iterable mapping could wait for an input whose producer needed consumer acknowledgment.
- Completing stream resumes retained an extra first-part buffer.
- Health pages repeated global candidate and metric work.
- Owners with only failed webhook deliveries were omitted from health evaluation.
- Invalid UTF-8 decoding could expand a small object past D1's bound-string limit.
- A database failure after webhook fetch could skip response-body cancellation.

The client follow-up also identified an overly broad staging-cleanup claim in the report and Python README. Both now distinguish preservation of preexisting O_EXCL content and substituted parent-directory entries from removal of a replacement at the staging content name after successful creation. The independent client review verified all eleven production source hashes remained unchanged.

Further scaling evidence exposed excessive file-tree reads when few indexing jobs were queued. The final health refinement uses an indexed queue-owner lookup maintained by migration 0017. One queued job among 50,000 files now uses 29,265 read VM instructions versus 32,088 at baseline; 101- and 1,000-job cases also improve for concentrated and dispersed owners, and doubling unrelated files adds no work. All 32 repository scaling cases and final integration pass. The server report distinguishes SQLite VM instruction counts from CPU time and records the remaining skewed-metrics tradeoff.

Independent final server review found no actionable findings. It passed 126 focused repository tests, 43 independent regression checks, 1,200 randomized migration/queue operations, and 40 additional scaling cases. Queues of 1–10,000 jobs used the owner index without reading entries, preserved baseline aggregates, and added no read instructions when unrelated files doubled from 50,000 to 100,000. All four prior server fixes remained intact, and all 263 captured source hashes were unchanged throughout that review.

The checkpoint retirement race, primitive-string iterable handling, and POSIX sync filename compatibility were corrected during implementation. Tests preserve owner/path authorization, version conditions, create-only uploads, cancellation, retry byte integrity, transaction rollback, and filesystem boundaries. The reviewed first-phase recovery, snapshot, and run transactions remain unchanged.

A limited common-secret-pattern scan of 481 current-tree text files matched only two intentional fake private-key fixtures. It did not scan Git history. All 438 captured source, configuration, and test hashes remained unchanged through final combined verification.

## Combined verification

The final combined run passed **618 workspace tests and 27 Python tests**, all workspace builds, and all workspace typechecks. The workspace total includes 523 web, 35 SDK, 41 CLI, 5 database, 2 contracts, 5 preview, and 7 CIMD tests. An isolated Python wheel build includes the current transfer module; all 27 Python tests also pass against the installed wheel, whose metadata retains Python `>=3.10` and no runtime dependencies. The wheel was rebuilt with the corrected cleanup documentation, and its Python modules match the tested source exactly. The complete final Worker integration suite, including migration 0017, passed and exited zero.

[Performance integration coverage](../scripts/performance-expansion-smoke.mjs) adds 121 checks for ranged downloads and conditional/owner guards, preview HEAD, notes/collections, change checkpoints, health responses, thirty-file draft application, exact multipart stream bytes, truncated/oversized stream rejection, early iterator stopping and consumer acknowledgment, Python uploads/downloads and ambiguous-path rejection, and nested concurrent CLI sync. The integration harness also exercises security boundaries, both MCP protocol generations, OAuth/CIMD, recovery, snapshots, backups, retained runs, and real local Cloudflare Queue indexing. New Queue/scheduler regressions verify decoded-text byte bounds, health alerts for owners whose only signal is a failed webhook, and queue-owner lookup insertion, deletion, ownership transfer, and scheduled health isolation.

The parent exercised the built interface through the collaborative browser:

- A 260-row text comparison renders 100/100/60 rows; changed-only filtering reaches all 20 changed rows.
- A JSON document with 454 tree values collapses to four visible rows. Formatted output preserves `9007199254740993` and both duplicate keys.
- CSV search selects the correct source row; profiling 220 distinct numbers returns the expected minimum, maximum, mean, and stable top five values.
- JSONL shows 50 rows per page, retains a malformed record, and correctly filters the final valid record.
- Run comparison renders 202 output differences in pages of 100/100/2. Metadata has no rendered `pre` until opened.
- Context cancellation stops three controlled pending reads without publishing stale output; a subsequent four-file load succeeds in the selected order.
- Five real browser uploads start three files, pause after those three, and resume only the remaining two. Exact downloaded bytes match. Create-only conflict/retry preserves the existing file and skips completed files.
- At 390 CSS pixels, the tested JSONL, run comparison, context, folder-upload, and CSV views have no document-level horizontal overflow.

Browser inputs were generated local fixtures, including File/DataTransfer objects for folder selection. Request gates only controlled timing; successful reads and writes used local Workers and R2. The temporary browser files were removed and owned tabs/servers stopped. This is functional browser coverage, not a formal accessibility audit or production latency benchmark.

Reproduce from the repository root:

```sh
npm exec --yes --package=pnpm@10.34.7 -- pnpm install --frozen-lockfile
npm exec --yes --package=pnpm@10.34.7 -- pnpm test
npm exec --yes --package=pnpm@10.34.7 -- pnpm build
npm exec --yes --package=pnpm@10.34.7 -- pnpm check
PYTHONPATH=packages/python-sdk python3 -m unittest discover -s packages/python-sdk/tests -v
node scripts/integration.mjs
npm exec --yes --package=pnpm@10.34.7 -- pnpm audit --audit-level low
npm exec --yes --package=pnpm@10.34.7 -- pnpm audit --prod --audit-level low
npm exec --yes --package=pnpm@10.34.7 -- pnpm -r outdated --format json
```

## Rollout and limits

Apply migrations **0014–0017 before deploying this complete maintenance tree**. Migration 0014 adds the original quota index; 0015 adds workload indexes; **0016 adds `search_documents.content_verified`, and 0017 adds the maintained queue-owner lookup, both required by the new code**. No production migration, commit, deployment, or publication was performed during this verification phase.

The subsequent authorized production rollout, live checks, and initial rollout interruption are recorded in the [deployment report](deployment-2026-10-22.md).

Index and queue-owner lookup maintenance add storage and write cost. The skewed-metrics health fixture uses 1.41× baseline read VM instructions while reducing database round trips. Supported range downloads add an R2 metadata HEAD before fetching selected bytes. Three-file browser uploads may buffer three 8 MiB parts; index prefetch can hold three bounded bodies. Stream-upload memory also includes a producer-supplied chunk. Python atomic downloads require POSIX no-follow directory-descriptor support. Sync still retains metadata proportional to the tree. Performance evidence measures calls, bytes, scheduling, rendered rows, allocations, and SQLite work; it does not claim measured production latency or billing savings.

Docker execution was unavailable during local verification. Container lifecycle/source tests and a local fake-CIMD integration passed; the subsequent deployment also verified transport through the real deployed CIMD container. The build retains a nonfatal CSS sourcemap warning. Advisory audits and reviews cover known/tested risks; they are not a guarantee that no vulnerability exists.
