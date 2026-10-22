# Additional server performance work — October 22, 2026

Scope: global improvements **38–54**, measured against `/tmp/agfs-plus50-baseline-20261022`. The original eight server improvements and reviewed recovery/snapshot/run transactions are excluded. This candidate plan was written before implementation. No commits, deployments, external fixtures, dependencies, or full builds are authorized in this subtask.

## Candidate plan (17 behaviors)

| Global # | Concrete candidate and baseline cost | Planned evidence and guardrails |
| --- | --- | --- |
| 38 | Dispatch platform extensions by route before importing them; current requests await up to eleven unrelated imports/handlers. | Loader-count and route-matrix tests; retain the single live authentication step and existing handler guards. |
| 39 | Read a file and its note with one owner-scoped left join instead of two sequential queries. | Migrated SQLite: one call, absent/empty notes, missing/foreign entries; revision writes unchanged. |
| 40 | Read collection membership and items together, retaining empty versus missing collection semantics. | Migrated SQLite: one call instead of two, owner/actor isolation, ordering and 200-item cap. |
| 41 | Read the change-log high watermark and retained floor in one statement. | One checkpoint call instead of two; expired and invalid cursors, owner isolation. |
| 42 | Fetch the seven health-dashboard sections in one D1 read batch. | One round trip instead of seven, equivalent payload and default thresholds, owner isolation. |
| 43 | Evaluate health in bounded owner pages with set-based metrics and batched alert changes, replacing eight calls per owner. | Multi-owner fixture, equivalent alert thresholds/resolutions, fixed bindings, bounded page size. |
| 44 | Prefetch search-index object bodies in bounded three-item waves; retain serial per-file transactional writes. | Controlled R2 gates show three concurrent reads, bounded retained bodies, retry and changed-object correctness. |
| 45 | Reuse persisted indexed text when an immutable object key still matches during rename/tag reindexing. | Zero R2 reads for matching indexed keys; fetch replacements and never reuse stale keys or unindexed placeholders. |
| 46 | Index share lifecycle access paths (owner lists, entry revocation, view cascades) to avoid global scans. | Query plans plus SQLite instruction-count comparisons on many owners/shares/views; unchanged predicates/cascades. |
| 47 | Deliver independent webhooks with at most three workers instead of a sequential twenty-delivery queue. | Controlled fetch gates; live hook check after claim, retries, claim conflicts, no detached work. |
| 48 | Index resumable-upload lookup by owner/path/fingerprint with a partial active-upload index. | Production-query plan and synthetic instruction counts; metadata/condition/expiry checks retained. |
| 49 | Serve preview HEAD using R2 metadata-only `head`, avoiding an unused body stream. | Signed-ticket tests: zero GETs/bytes for HEAD, same security/content headers, expired ticket causes no R2 access. |
| 50 | Support single byte-range file downloads without reading/transferring the full object. | Range/suffix/open-ended/invalid range tests, bounded R2 requests, live route authorization and If-Match preserved. |
| 51 | Index recurring retention sweep predicates as one maintenance behavior, avoiding scans of mostly unexpired global tables. | Query plans and instruction-count comparisons across the selected expiry predicates; identical expiry boundaries. |
| 52 | Record and trim recent-file history in one atomic batch rather than two sequential calls. | One round trip, actor isolation, 100-item bound, rollback on trim failure; existing best-effort semantics. |
| 53 | Batch draft-application path/parent preflight into one bound-JSON query instead of up to sixty reads. | Thirty-file fixture, constant bindings, authorization before reads, conflict/parent failures; final transaction guards retained. |
| 54 | Index webhook fanout by owner and enabled state so each activity insertion considers only that owner's hooks. | Trigger/query-plan fixture with many foreign hooks; identical event/path matching and delivered rows. |

Candidates become counted improvements only after implementation and focused evidence. If a candidate fails validation it must be replaced explicitly or reported as a shortfall. Call-count and SQLite VM-work evidence are not production latency or billing claims.

## Implemented and counted: exactly 17 new behaviors

All 17 candidates passed focused checks. The numbering below is the parent's global numbering, **38–54 inclusive**. Indexes belonging to one workload are counted together, not once per index. No existing folder-chain, subtree, run-artifact, duplicate-page, folder-deletion, GC, outbox, or storage-covering-index optimization is counted again.

| # | Implemented behavior and affected production files | Observed evidence |
| --- | --- | --- |
| 38 | Route-selected platform extension loading: `platform-dispatch.ts`, `platform-api.ts`. | Cold notes request loads only its own extension. Core routes load none. Route-matrix tests cover all extension families and malformed/unknown routes. Baseline requests evaluated up to eleven extension loaders/handlers in sequence. This is loader/evaluation evidence, not measured bundle bytes. |
| 39 | Owner-scoped entry/note left join: `file-notes-api.ts`. | Two sequential reads become one. Tests preserve missing versus empty notes, author/revision fields, missing files, owner boundaries, scoped authorization, and stale-write rejection. Note writes retain their existing revision guards. |
| 40 | Collection ownership and ordered item read in one query: `collections-api.ts`. | Two reads become one; owned empty collections still return `[]`, absent/foreign collections still return 404. The inner join explicitly constrains collection ID, preventing SQLite from materializing an owner's entire membership set. Production-query plans seek `collection_entries(collection_id,entry_id)` and look up individual entries. Owner, actor, and 200-row boundaries are tested. |
| 41 | Single-statement change checkpoint/floor read: `changes.ts`. | Checkpoint-only calls use one read instead of two; change pages use two instead of three. Expired history, invalid checkpoints, literal path matching, and owner isolation are preserved. |
| 42 | One transactional seven-query health snapshot: `operations.ts`. | Seven sequential D1 calls become one batch. Payload sections/defaults and manager/owner boundaries are tested. This does not remove the seven underlying SQL queries. |
| 43 | Bounded health evaluation with independently paged sources and owner-indexed aggregates: `operations.ts`, migration `0017_index_job_owners.sql`. | A 102-owner fixture takes seven D1 calls instead of the baseline `1 + 8N = 817`; 5,000 metric owners take 152 instead of 40,001. Four independent source cursors retain at most 400 candidate IDs, and each evaluation selects at most 100 owners. Two alert mutations consume at most 400 JSON decisions; statements have at most three bindings. Owner-directed aggregates avoid repeated global metric/status scans. Multi-page alert equivalence, source exhaustion, Unicode ordering, and scaling are tested. The maintained queue-owner lookup also avoids file scans for sparse indexing queues. |
| 44 | Three-body waves for search indexing: `search.ts`. | Seven object reads start in waves of 3/3/1 instead of a seven-read waterfall. Tests observe peak R2 concurrency three, no D1 write until the current wave's reads settle, and serial four-statement transactions for individual files. The selection is capped at twenty; at most three eligible 1 MiB bodies are retained at once, excluding encoding/SQL overhead. Oversized streams are cancelled; failed/replaced entries remain safely retryable. |
| 45 | Reuse verified indexed text for an unchanged immutable key: `search.ts`, migration `0016_search_content_reuse.sql`. | Rename/tag reindexing performs zero R2 reads and never selects document bodies back into the Worker. Changed keys, legacy documents, tag-only placeholders, previously missing objects, and files that become ineligible for text indexing are tested. Reuse occurs inside the guarded transaction and requires `content_verified=1`. Legacy documents get one fresh successful read before reuse. |
| 46 | Indexed share lifecycle: migration `0015_server_workload_indexes.sql`. | Owner listing, entry-version revocation lookup, and view-cascade lookup now seek three indexes. In 10,000-row fixtures, SQLite VM work changes from 30,073→106, 30,027→60, and 30,009→15 instructions, respectively, with identical result sets. Production listing SQL and actual revocation/view cascade behavior are tested. Counted as one share lifecycle behavior. |
| 47 | At most three concurrent webhook deliveries: `webhooks.ts`, `server-concurrency.ts`. | Controlled HTTP gates observe three active deliveries and full completion joining. Each row still uses a conditional claim, fresh enabled-hook read, live secrets, timeout, redirect rejection, response-body cancellation, and attempt-guarded finalization. Tests cover a competing claimant, disabled hook, secret rotation, retry exhaustion, and stopping new work while joining active peers after a fatal error. |
| 48 | Indexed active multipart resume lookup: migration `0015_server_workload_indexes.sql`. | Production-generated SQL uses `uploads_resume_idx(owner_id,path,fingerprint)` with its active/multipart predicate. A resumed candidate late in a 10,000-active-upload fixture costs 50,068→48 VM instructions. The synthetic fixture distributes uploads across tenants within the per-owner active-upload cap. All content type, size, condition, expiry, and fingerprint predicates remain unchanged. |
| 49 | Metadata-only preview HEAD: `apps/preview/src/index.ts`. | A valid HEAD invokes R2 `head` exactly once, invokes `get` zero times, and returns zero body bytes with the same content/security headers as GET. Expired/forged tickets invoke neither R2 method; missing objects return 404. |
| 50 | Efficient single-range authenticated downloads: `r2.ts`, `bindings.ts`, `routes/api/v1/fs/download.ts`. | `bytes=2-4` requests exactly three R2 bytes from a ten-byte object and returns those three bytes with 206 and correct Content-Range/Content-Length. Tests cover suffix/open-ended ranges, huge positions, empty/missing objects, conditional version mismatch, consumer cancellation, and unsupported headers. The download route retains live authentication, owner/path authorization, and its original If-Match interpretation. |
| 51 | Indexed retention discovery for six high-volume tables: migration `0015_server_workload_indexes.sql`. | `object_pins`, `change_log`, `operation_metrics`, `queue_outbox`, `webhook_deliveries`, and `activity` seek expiry/time indexes. Ten expired rows among 10,000 records take 61 instructions per lookup instead of 30,038 (30,044 for change_log, which includes two initial entry events). Existing cleanup SQL, expiry boundaries, pin/recovery semantics, and deletion transactions are unchanged. Counted once for the maintenance workload. |
| 52 | Atomic recent-history insertion and trim: `recent-files.ts`. | Two sequential calls become one two-statement transaction. Tests preserve the 100-entry actor-specific bound, protect foreign files/actors, skip token history, and prove a trim failure rolls back the insert/update while the caller retains existing best-effort behavior. |
| 53 | Bounded draft-application validation: `draft-preflight.ts`, `drafts.ts`. | Thirty nested write paths use one three-binding preflight instead of sixty sequential reads. The baseline readiness/parent clauses alone reproduce 150 bindings and fail the D1-limit harness. JSON-based readiness/parent sets keep the production apply gate below forty bindings, and all thirty writes complete under the 100-binding ceiling. Final transaction-time expiry, parent, and live-file conflicts prevent every draft file from publishing. Existing quota, workspace, token, approval, and file-version guards remain in the final transaction. |
| 54 | Indexed owner-specific webhook fanout: migration `0015_server_workload_indexes.sql`. | An actual activity INSERT among 10,000 hooks produces the same ten deliveries with 40,958→964 VM instructions. Hooks are distributed across tenants within the ten-hook cap. Owner/enabled query plans and event/path-boundary behavior are tested. This removes database work at event creation, independently of #47's HTTP scheduling. |

## HTTP and rollout contracts

Only `/api/v1/fs/download` opts into byte-range handling. Valid single byte ranges, including suffix and open-ended ranges, return 206. Unsatisfiable ranges return 416 with `Content-Range: bytes */size` and no R2 body request. Unsupported units, malformed syntax, and multiple ranges are ignored and receive the full 200 response. Matching strong quoted `If-Range` ETags permit the range; weak, date, or unmatched validators receive the full representation. Existing If-Match handling is unchanged. Ordinary downloads retain a single R2 GET; supported range requests add a metadata HEAD, then fetch only the selected bytes with an R2 ETag condition. Responses remain private/no-store and retain download isolation headers. Consumer cancellation reaches the R2 stream.

Apply additive migrations **0015, 0016, and 0017 before running the new worker**. Migration 0015 adds eleven indexes; they consume storage and add write maintenance, balanced against the recorded lookup/sweep work. Migration 0016 adds one integer flag with default zero to existing search documents; no private content is duplicated or globally cached. Previously indexed text is eligible for reuse only after a successful bounded read by the new indexer. Migration 0017 adds a pending-job owner lookup, backfills it from live entries, and synchronizes it through insertion/ownership triggers and deletion cascades. It adds one projection row and one owner index per pending job, with synchronous write maintenance. Existing search, recovery, and manifest data are retained.

The request authentication step remains ahead of platform dispatch. Authorization is neither cached nor moved into a background operation. Webhook concurrency is per invocation; simultaneous invocations retain their existing row-claim protection, and independent deliveries are not guaranteed to finish in original order. Health evaluation pages bound Worker memory, but source discovery still scales with source rows and owner aggregates with the selected owners' rows. Indexing uses up to three bodies instead of one, and waves wait for their slowest read. R2 object immutability remains the basis for indexed-content reuse.

## Review follow-up: health scaling and uncounted hardening

The first implementation of #43 reduced network calls but rebuilt a global candidate union and global metric aggregates for every 100-owner page. Independent review reproduced roughly **9.98 million read VM instructions versus 0.50 million baseline** for 5,000 metric owners. That implementation was replaced before final verification; its four-call/102-owner claim is superseded by the seven-call result above.

The final implementation gives metrics, indexing, active alerts, and failed webhook deliveries separate ordered cursors, buffers, and exhaustion flags. The bounded merge deduplicates owners using SQLite-compatible Unicode ordering. Once a source is exhausted it is not restarted while another source supplies later pages. A single availability query skips empty sources. Migration 0017 supplies an owner-indexed projection of pending jobs, so both job discovery and owner job aggregates read only the queue. There is no entries traversal and no queue-size cutoff. Each aggregate query starts from a JSON page of at most 100 selected owners and seeks their metrics, pending jobs, and hooks/deliveries through owner-leading indexes. All queries are awaited sequentially or use bounded D1 batches; there is no Promise.all D1 fanout or global private-data cache. Existing threshold rules, the ten-request minimum, alert identity/timestamps, and stale-alert resolution remain intact.

The new [health scaling benchmark](../apps/web/src/lib/server-health-scaling.bench.py) extracts the tagged SQL directly from production source, runs it against all migrations in an in-memory database, and compares every owner's aggregate/threshold tuple with the baseline queries. It measures read statements only, excluding alert writes on both sides. The actual JavaScript merge and alert mutations are covered separately by migrated SQLite tests, including 5,000 owners with varied thresholds and a skewed 501-owner fixture with 10,000 old-only metric owners. Benchmark assertions require near-linear scaling with five times the owners, a single metric-source query for the skewed fixture, no indexing-source query for empty jobs, no entries access in either job query plan, and at most 400 buffered source candidates. Sparse fixtures include 1, 101, and 1,000 jobs; the latter two run against 50,000 and 100,000 files with both concentrated and dispersed ownership, and assert that unrelated file growth adds no material read work. Tests also cover duplicate candidates across sources and non-BMP owner IDs.

Representative **SQLite 3.54.0, after ANALYZE** results (exact read VM instructions):

| Fixture | Baseline | Final | Interpretation |
| --- | ---: | ---: | --- |
| 1,000 recent-metric owners | 110,047 | 104,544 | Linear owner-bounded reads. |
| 5,000 recent-metric owners | 550,047 | 522,384 | Five times the owners takes 5.00× the final work, rather than approximately 25×. |
| 500 active job/alert owners before 10,000 old-only metric owners, with one recent metric owner | 65,567 | 92,580 | The metrics source scans its suffix once and stays exhausted. |
| 2,500 active job/alert owners before 50,000 old-only metric owners, with one recent metric owner | 327,567 | 462,200 | Five times the data takes 4.99× the final work; 1.41× baseline read VM instructions in this shape while network calls remain batched. |
| 301 alert owners, no jobs, 10,000 unrelated files | 67,437 | 29,127 | Empty-job availability check skips the indexing source. |
| 301 alert owners, no jobs, 50,000 unrelated files | 227,437 | 29,127 | Unrelated files add no read work. |
| 301 alert owners plus one pending job among 10,000 files | 32,088 | 29,265 | Queue-owner index avoids file scans. |
| Same one-job fixture with 50,000 files | 32,088 | 29,265 | Unrelated files add no read work. |
| 101 jobs in one owner, 50,000 files | 32,275 | 30,668 | No 100/101-job cutoff. |
| 101 jobs in one owner, 100,000 files | 32,274 | 30,668 | Doubling files adds no read work. |
| 101 jobs across 101 owners, 50,000 files | 607,982 | 39,613 | Source and per-owner reads stay queue-bounded. |
| 101 jobs across 101 owners, 100,000 files | 405,075 | 39,613 | Doubling files adds no read work. |
| 1,000 jobs in one owner, 50,000 files | 69,133 | 43,254 | The owner aggregate reads only its pending jobs. |
| 1,000 jobs in one owner, 100,000 files | 69,133 | 43,254 | Doubling files adds no read work. |
| 1,000 jobs across 1,000 owners, 50,000 files | 401,037 | 132,636 | Eleven bounded candidate reads and fourteen evaluation pages. |
| 1,000 jobs across 1,000 owners, 100,000 files | 651,037 | 132,636 | Doubling files adds no read work. |

The intermediate cursor fix still drove job discovery and counts from entries. Review rejected its sparse-queue regression (one job among 50,000 files took 1,129,877 read instructions versus 32,088 baseline), so that approach was replaced with migration 0017. The migration preserves the existing single-column `index_jobs` insertion contract; a separate `index_job_owners` table stores only pending entry IDs and their owners. Existing jobs are backfilled without changing retry state or resurrecting completed jobs. New jobs populate the lookup in the same statement, deleting a job cascades to its lookup, and an entry ownership change updates the lookup atomically. Tests verify backfill, completion/requeue, entry deletion, transfers of both pending and completed files, tenant-specific health alerts, and rollback if lookup maintenance fails. There is no arbitrary sparse/dense cutoff.

Metrics and failed-webhook source discovery still scan their own ordered source ranges; an unmatched interval at a page boundary can be read ahead and then revisited by the next range query, giving a constant-factor scan rather than page-count multiplication. Counts above use the benchmark's frozen baseline reads with current migrations and exact instruction counting; they are not the reviewer's approximate counts. The script passes all cases both with and without ANALYZE. These are read VM instructions, not SQL CPU time or production latency.

Three correctness fixes requested during review are **uncounted** and leave the total at exactly 17:

- Health discovery now includes owners whose only signal is failed webhook deliveries, including disabled hooks. The query remains tied to the delivery's owning webhook and produces owner-specific alerts. A durable regression verifies no alert leaks to a different tenant and that recovery resolves the alert.
- Search indexing caps decoded content at **1 MiB of UTF-8 before binding SQL**. Invalid source bytes can expand when decoded, so checking R2 size alone was insufficient. A bounded `TextEncoder.encodeInto` buffer retains a complete-code-point prefix; 700,000 `0xff` bytes become **1,048,575 stored UTF-8 bytes**, rather than 2,100,000. The indexing job completes, valid 1 MiB ASCII and emoji content remains unchanged, and existing fetch/write retry behavior is preserved. The capped representation is eligible for unchanged-object reuse.
- A fetched webhook response body is cancelled in `finally`, including when the hook-use database update fails. Regressions cover that update failing on seven deliveries and final delivery persistence failing while three workers are active; all fetched bodies close and active workers are joined before rejection.

## Focused verification and reproduction

**148 web tests in eleven files and five preview tests in two files passed** (153 total). This includes **127 new web tests and three new preview tests**. The final eleven-file web command passed after the queue-owner migration, including ownership/workspace security tests; the preview tests were unchanged and had already passed. Tests execute actual migrated SQLite and production-generated queries with deterministic R2/HTTP mocks. The fixture rejects statements exceeding 100 bindings, 100 KB SQL, or 2 MB per bound string. It does not emulate every Cloudflare runtime limit.

Web, preview, and database typechecks passed; web and database typechecking were repeated after the queue-owner migration and passed. Scoped whitespace checks passed. The collection predicate fix was complete at **15:29:51 UTC**, before the original combined build at **15:30:59 UTC**. The first review fixes were declared settled at **15:56:43 UTC**; the parent then reported combined build/typecheck and full integration success, including all 121 new integration checks plus real Queue malformed-UTF-8 indexing and scheduled webhook-only health. A subsequent review confirmed the sparse-job regression and explicitly reopened production work. The final owner-indexed production source and migration 0017 were declared settled at **16:13:31 UTC**, with no production changes after that signal. The parent confirmed that the final-source build, workspace typechecks, and **618 workspace tests** passed after that settle signal (web 523, SDK 35, CLI 41, database 5, contracts 2, preview 5, CIMD 7). Python remains **27** passing tests, including the installed-wheel check. Fresh full integration and independent review of migration 0017 were running at handoff; the parent owns those final results. No live fixtures, full builds, commits, deployments, or publications were performed by this implementation task.

From the repository root:

```sh
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/web exec vitest run --config vitest.config.ts \
  src/lib/server-expansion.test.ts src/lib/server-background-expansion.test.ts \
  src/lib/platform-dispatch.test.ts src/lib/download-range.test.ts \
  src/lib/r2.test.ts src/lib/operations.test.ts src/lib/platform-schema.test.ts \
  src/lib/retention.test.ts src/lib/reliability.test.ts \
  src/lib/ownership-security.test.ts src/lib/workspaces-security.test.ts
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/preview exec vitest run src/index.test.ts src/ticket.test.ts
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/web typecheck
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/preview typecheck
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/db typecheck
python3 apps/web/src/lib/server-expansion.bench.py
python3 apps/web/src/lib/server-health-scaling.bench.py
```

The [benchmark](../apps/web/src/lib/server-expansion.bench.py) uses only an in-memory database, runs the identical SQL with and without each new workload's indexes, checks equal results, and reports query plans/instruction counts. Recorded benchmark runtime: Python SQLite **3.54.0**. Test runtime: Node **26.11.1**, embedded SQLite **3.53.4**, Vitest **5.0.5**. These are synthetic call-count, scheduling, bytes, and VM-work measurements—not production latency, throughput, p95, or billing claims.

## Exact file inventory

Production files changed from the saved plus-50 baseline:

- `apps/web/src/lib/{bindings,changes,collections-api,drafts,file-notes-api,operations,platform-api,r2,recent-files,search,webhooks}.ts`
- `apps/web/src/routes/api/v1/fs/download.ts`
- `apps/preview/src/index.ts`

New production files:

- `apps/web/src/lib/{draft-preflight,platform-dispatch,server-concurrency}.ts`
- `packages/db/src/migrations/0015_server_workload_indexes.sql`
- `packages/db/src/migrations/0016_search_content_reuse.sql`
- `packages/db/src/migrations/0017_index_job_owners.sql`

New evidence files:

- `apps/web/src/lib/{server-expansion,server-background-expansion,platform-dispatch,download-range}.test.ts`
- `apps/web/src/lib/server-expansion-fixture.test-utils.ts`
- `apps/web/src/lib/server-expansion.bench.py`
- `apps/web/src/lib/server-health-scaling.bench.py`
- `apps/preview/src/index.test.ts`
- This report.

Baseline byte comparison confirmed `recovery.ts`, `snapshots.ts`, `runs.ts`, `fs.ts`, `garbage.ts`, and `background.ts` remain unchanged from `/tmp/agfs-plus50-baseline-20261022`. No frontend/browser module, SDK, CLI, Python SDK, manifest, root report, or integration script was edited by this implementation task.

## Parent completion

The final independent review cleared migration 0017 and the health refinement with no actionable findings. It verified 1,200 randomized queue operations, 40 additional scaling cases, and all prior fixes. The parent completed the final build, workspace typechecks, 618 workspace tests, and full Worker integration, including all 121 expansion checks and real local D1/Queue checks for lookup insertion, deletion, ownership transfer, and scheduled health isolation. All source hashes remained stable. See the [complete verification report](performance-expansion-2026-10-22.md); migrations 0014–0017 are required before deploying the complete maintenance tree.
