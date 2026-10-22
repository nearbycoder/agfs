# Server and database performance — October 22, 2026

This implementation contains exactly eight performance improvements, counted by server behavior. Dependency updates, frontend improvements, and the wider security review are separate work. No deployment or production database change was performed.

The audit read [the original security review](../SECURITY-AUDIT.md), [the September 6 audit](../SECURITY-AUDIT-2026-09-06.md), [the September review](security-review-2026-09.md), and [the September 19 review](security-review-2026-09-19.md). In particular, literal path matching, live authorization, transaction-time guards, physical-object retention, and durable retries remain requirements.

## Eight implemented behaviors

### 1. Create an ancestor folder chain in one transaction

Sources: [folder-chain.ts](../apps/web/src/lib/folder-chain.ts), `ensureFolderChain` in [fs.ts](../apps/web/src/lib/fs.ts).

Previously a depth-*d* chain required *d* sequential reads plus one separate insert for each missing folder: 200 D1 calls for 100 new ancestors. The new implementation uses one D1 batch containing a conflict query and one ordered, set-based insert. A JSON parameter keeps bind counts independent of depth. Existing folder identities and timestamps are preserved.

Evidence: the 100-level regression observes **one call and two statements**, with fewer than ten bindings per statement. Tests cover existing folders, repeated requests, foreign owners, literal names, a file inserted immediately before the batch, and rollback of the entire chain after an injected insertion error. File conflicts cannot leave partially created ancestors.

Limit: database work and generated JSON still grow with depth. A shallow, already-existing chain may do more SQL work than its former single lookup. The improvement targets network round trips and atomic creation.

### 2. Seek directly into literal subtrees

Sources: [path-range.ts](../apps/web/src/lib/path-range.ts), tree and descendant predicates in [fs.ts](../apps/web/src/lib/fs.ts), [search.ts](../apps/web/src/lib/search.ts), and [storage-insights-api.ts](../apps/web/src/lib/storage-insights-api.ts).

The former `substr(path, ...)` predicate scanned the owner's path index. Binary lower/upper bounds now let the existing `(owner_id,path)` index seek to a subtree. The exact-root variant retains an additional boundary predicate to exclude neighboring names such as `/folder-other`. No wildcard or case-insensitive matching is introduced.

Evidence: production-generated SQL has an `EXPLAIN QUERY PLAN` search on `owner_id`, lower path, and upper path. Tests compare the old and new result sets for root, exact roots, punctuation neighbors, `%`, `_`, case differences, Unicode, and other owners; tree hierarchy is also checked. The reproducible 10,000-entry fixture returns the same ten paths with **80,046 → 164 SQLite VM instructions**.

Limit: these bounds depend on normalized paths and the schema's BINARY collation. Broad/root queries still read their matching data. Search matching and aggregation retain their existing costs; unrelated subtree mutations were not rewritten.

### 3. Batch the run lifecycle with fixed-size SQL

Sources: `createRun` and `finishRun` in [runs.ts](../apps/web/src/lib/runs.ts).

Previously *n* inputs required *n* sequential reads and a transaction with `1 + 2n` statements. Input guards also used `10 + 3n` bindings in one statement. All paths are now normalized and authorized before a single ordered input query; run creation, artifact records, and object pins use three set-based statements in one transaction. Input order and duplicate inputs remain part of the saved manifest.

Completion now also uses bound JSON sets for snapshot and availability checks, followed by three atomic statements to complete the run, insert output artifacts, and retain the persisted artifact keys. Output count and field comparisons reject added, moved, deleted, replaced, or metadata-changed files. Availability checks require the owner's live file or this run's unexpired owner-scoped pin; the SQL execution clock prevents reviving a pin that expires while the batch waits. One timestamp taken after R2 verification supplies the manifest completion time and the exact pin/manifest retention deadline. Completed retries return the saved manifest without extending retention; competing attempts retain the winning snapshot's physical keys, even when their public manifests are identical.

Evidence: creating 50 inputs takes **51 → 2 D1 calls**, **151 → 4 total statements**, and **160 → 12 maximum bindings**. Finishing 50 inputs with 200 outputs uses **451 → 3 transaction statements**, **1,603 → 19 maximum bindings**, and three D1 calls including its two reads. Both 50-input completion regressions—with zero and 200 outputs—were first run against the previous completion implementation and failed at the modeled D1 100-binding limit; they now pass. The limit is documented by [Cloudflare D1](https://developers.cloudflare.com/d1/platform/limits/).

The focused server-performance suite passes **64 tests**, including **34 completion regressions** covering both maxima, duplicate inputs/shared keys, added/changed/moved/deleted output races, expired/missing/foreign pins, retention across input moves and overwrites, SQL-time expiry, missing R2 objects and ETag mismatches, checksum encoding, the 201-output rejection, authorization/owner isolation, completed retries, competing completions, and rollback after artifact or pin insertion failures. Failed completion leaves the run running, without partial output artifacts or renewed/new pins. The existing creation tests continue to cover authorization before querying, missing/folder/foreign inputs, duplicate order, and rollback of input snapshot races.

Limit: metadata and database row work still scale with the existing caps of 50 inputs and 200 outputs. Completion still performs one sequential R2 HEAD per output, verifies its ETag, and records the supplied SHA-256 checksum (or `null`); it does not hash file contents itself. D1 and R2 do not share a transaction, so the existing immutable-object/reference lifecycle remains necessary. The improvement bounds SQL parameters and statement count, without claiming constant-cost row processing or production latency measurements.

### 4. Fetch a duplicate-file page in two database calls

Source: [duplicates-api.ts](../apps/web/src/lib/duplicates-api.ts).

A page formerly queried its groups and then issued one query for each of up to twenty groups. It now sends the selected fingerprints as one JSON parameter and fetches each group's first fifty files using bounded indexed subqueries in one statement. The limit occurs before JSON aggregation, so the file lookup does not rank every duplicate. Counts, extra-byte totals, order, cursor scope, and response fields are unchanged.

Evidence: **21 → 2 reads** for a full page, reproduced against the original endpoint and verified by sixteen SQLite tests. The second query uses five bindings and returns at most twenty aggregate rows containing at most 1,000 files. Query-plan assertions verify `(owner_id,etag,size)` seeks through `entries_duplicate_lookup`. Tests cover 21 groups, groups over fifty files, same hashes across owners, literal/scoped paths, cursors, ordering, exclusions, and empty pages (still one read).

Limit: full group counts still require processing matching entries. There remain up to twenty indexed seeks inside SQLite, and a scoped seek can examine additional same-hash files outside the subtree before finding fifty matching files. The saved cost is separate database calls, without moving the group size cap to Worker-side filtering.

### 5. Delete folders without materializing the deleted subtree in the Worker

Sources: `deleteEntry` in [fs.ts](../apps/web/src/lib/fs.ts), `trashEntry` in [recovery.ts](../apps/web/src/lib/recovery.ts).

Recursive deletion formerly loaded every descendant for a preflight result that was unused, then returned every inserted recovery ID merely to check whether any row changed. It now reads only the root before the existing retention/delete transaction and checks D1's affected-row metadata. Nonrecursive deletion uses a one-row descendant probe.

Evidence: deleting a folder with 1,000 children uses **three → two D1 calls**, returns one root row instead of the subtree plus 1,001 recovery IDs, and still retains all **1,001 recovery rows**. Tests preserve foreign-owner and neighboring paths, reject nonempty nonrecursive folders, and verify that a child inserted after the empty-folder probe still blocks the transaction. D1 batches provide affected-row metadata in their [return objects](https://developers.cloudflare.com/d1/worker-api/return-object/).

Limit: the database still performs all retention, change-log, cascade, and delete writes atomically. This reduces Worker memory, response serialization, and preflight reads; it does not make a large delete constant-cost inside D1.

### 6. Collect unreferenced objects in bounded R2 and metadata batches

Sources: [garbage.ts](../apps/web/src/lib/garbage.ts), R2 binding method typing in [bindings.ts](../apps/web/src/lib/bindings.ts).

The existing reference-exclusion query and 100-object cap are preserved. Instead of one R2 deletion and two separate metadata deletes for each object, collection performs one awaited R2 batch deletion followed by one transactional pair of set-based metadata deletes.

Evidence: a full batch drops from **100 → 1 R2 binding calls** and **201 → 2 D1 calls** (selection plus transaction); SQL statement count drops from 201 to three. Tests check the 100-object bound, live/recovery/pin/pending/completing exclusions, expired pins, empty queues, failed R2 deletion, and rollback/retry after a metadata-delete failure. R2 supports deleting an array of up to 1,000 keys per call; this implementation retains its smaller bound. [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).

Limit: a failed batch retains all its retry records, including keys R2 may already have deleted. Repeated deletion is safe. The existing immutable-object/reference lifecycle assumption is unchanged. Binding call counts are not a claim about R2 billing units or production latency.

### 7. Dispatch the durable outbox with one bounded queue send

Sources: [background.ts](../apps/web/src/lib/background.ts), queue binding method typing in [bindings.ts](../apps/web/src/lib/bindings.ts).

The dispatcher still selects at most fifty pending items. It now awaits one `sendBatch` before marking exactly those IDs dispatched with one bound-JSON update. Outbox population, retry eligibility, consumer acknowledgment, and dead-letter handling retain their existing behavior.

Evidence: a fifty-message page drops from **50 → 1 queue binding calls** and **53 → 4 D1 calls**. Tests verify that all rows remain undispatched while the send is executing, only fifty of sixty queued items are marked, failed sends leave work retryable, subsequent retries succeed, and empty queues send nothing. Cloudflare confirms durability when the batch promise resolves. [Queues JavaScript API](https://developers.cloudflare.com/queues/configuration/javascript-apis/).

Limit: a crash after sending but before the database update can redeliver messages, as before. This retains at-least-once delivery; it does not introduce exactly-once semantics or remove outbox-population scans.

### 8. Index physical storage usage by owner

Source: additive migration [0014_storage_usage_owner.sql](../packages/db/src/migrations/0014_storage_usage_owner.sql), serving the existing [storage-usage.ts](../apps/web/src/lib/storage-usage.ts) quota/account query.

The pinned-object arm of the storage query previously scanned `object_usage` across every namespace. A covering `(owner_id,object_key,size)` index restricts it to the requested owner's records. The quota formula, grouping by physical key, expiry tests, and transaction-time quota enforcement are unchanged.

Evidence: the production SQL's query plan changes from `SCAN u` to `SEARCH u USING COVERING INDEX object_usage_owner_key_size_idx (owner_id=?)`. Tests obtain identical totals before and after dropping the index, with overlapping live/recovery/pinned references, expired pins, and foreign owners. In a separate quota fixture with ten live objects and ten relevant usage records among 10,000 global usage rows, the whole query drops from **30,728 → 759 SQLite VM instructions** and returns the same 100-byte total.

Limit: the index consumes storage and adds maintenance work to usage inserts/deletes. The query still scans the owner's live/recovery references and deduplicates keys. The migration must be applied to obtain this improvement; existing code remains compatible with the additive index.

## Verification and reproduction

- The initial eight-feature verification passed **73 tests across eleven focused suites**, including 30 new server performance/race tests and sixteen duplicate-page tests. Run-completion follow-up added 34 regression cases; all 64 tests in `server-performance.test.ts` passed. The server tests execute production-generated SQL against all repository migrations with foreign keys enabled and model D1's 100-binding limit.
- **Web TypeScript check passed.** The parent also verified a full workspace build and disposable Worker integration, including 100-level folders and completion of 50 retained inputs with 200 output paths. Final combined totals, later security fixes, and rollout requirements are in [the maintenance report](maintenance-2026-10-22.md).
- An independent read-only review found no introduced blockers in the eight scoped changes and independently reran all 46 new tests successfully.
- `git diff --check` passed for the implementation. No commit, publish, deployment, or remote migration was performed.
- Test runtime: Node **26.11.1**, embedded SQLite **3.53.4**, Vitest **5.0.5**. The instruction-count benchmark used Python SQLite **3.54.0**. VM instruction counts are local, synthetic, version-dependent evidence; they are not D1 billed-row counts, p95 timings, or measured production speedups.

Run from the repository root (using the installed executables directly):

```sh
cd apps/web
../../node_modules/.bin/vitest run --config vitest.config.ts src/lib/server-performance.test.ts src/lib/duplicates-api.test.ts src/lib/fs.test.ts src/lib/background.test.ts src/lib/move-statement.test.ts src/lib/upload-commit.test.ts src/lib/retention.test.ts src/lib/platform-schema.test.ts src/lib/reliability.test.ts src/lib/ownership-security.test.ts src/lib/workspaces-security.test.ts
../../node_modules/.bin/tsc --noEmit
```

Run the reproducible instruction-count fixtures from the repository root:

```sh
python3 docs/server-performance-2026-10-22.bench.py
```

The [benchmark source](server-performance-2026-10-22.bench.py) documents its synthetic data and SQL. It uses an in-memory database, checks identical results, reports query plans, and changes no application data. No global authorization/data cache or deferred mutation-audit write was added.
