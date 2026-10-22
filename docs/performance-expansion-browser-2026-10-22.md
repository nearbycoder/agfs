# Browser performance expansion — 2026-10-22

Scope: exactly 17 new browser/frontend improvements, global numbers 21–37. Baseline: `/tmp/agfs-plus50-baseline-20261022`. Original phase optimizations and security fixes remain intact. No dependencies, server libraries, manifests, commits, deployments, or live fixtures are in this scope. Parent owns full build/integration and independent review.

The following concrete candidate list was recorded **before implementation**. Each row will be marked implemented only after focused evidence. Guidance: `vercel-react-best-practices` (bounded asynchronous work, reusable indexes, conditional computation, fewer allocations).

| # | Candidate and concrete baseline cost | Implemented change | Focused evidence | Status |
| --- | --- | --- | --- | --- |
| 21 | Exact JSON parsing builds a native tree, whole token array, then exact tree | Validate and construct exact values with one bounded scanner | 9,999 numeric tokens cause zero native JSON.parse calls; 30,000 baseline syntax cases; exact/prototype/depth tests | Implemented |
| 22 | Text comparison allocates a full Uint16 LCS matrix | Rolling score rows and packed traceback decisions, with matching-prefix bypass | 1,000×1,000 lines allocate 129,004 matrix bytes versus 2,004,002; 40,000 baseline-equivalent comparisons | Implemented |
| 23 | JSON collapse evaluates every collapsed prefix for every node | Single preorder traversal skipping hidden subtrees | Escaped/root/nested collapse agrees with baseline; collapsed 6,001-node tree performs one Set lookup | Implemented |
| 24 | JSON inspector formats every loaded document even in tree/raw view | Demand formatting with component-owned lazy result | Zero formatting during inspect; first formatted read preserves large numbers/duplicate keys, second read performs no formatting | Implemented |
| 25 | CSV searches lowercase every cell and allocate all row wrappers on every query | Prepare reusable normalized cells and row references per source/header snapshot | 5,000×2 cells normalized once; four further queries perform four lowercase calls total, retaining row identities | Implemented |
| 26 | JSONL searches normalize raw lines repeatedly and explorer retains unused parsed trees | Prepared search records, optional value omission for explorer | 3,001 records retain no parsed values in explorer mode; two queries perform two lowercase calls; malformed raw lines retained | Implemented |
| 27 | CSV profile sorts every distinct value for only five winners | Bounded top-five selection with identical tie ordering | 5,000 distinct values: fewer than 6,000 comparisons, exact baseline top five; 3,000 baseline-equivalent profiles | Implemented |
| 28 | JSON-to-CSV builds a complete projected cell matrix before output | Iterable CSV writer and one-record-at-a-time conversion | Oversize fourth generated row stops iteration; escaping/formula/row limits tested; next JSON record untouched on output overflow | Implemented |
| 29 | Path scope retokenizes one glob per path and allocates DP rows per token | Compile pattern once and reuse two bounded rows per matching call | Compiled matcher allocates two Uint8Array buffers per path, versus one per token; existing glob semantics tests pass | Implemented |
| 30 | JSON record selection reparses the same pointer for every record | Compile pointer segments once and reuse safe own-property traversal | 2,000 records use one pointer split; inherited properties and noncanonical array indices remain unavailable | Implemented |
| 31 | JSONL-to-array serializes, reparses, then serializes the aggregate | Validate aggregate limits directly on parsed values and serialize once | Numeric JSONL conversion makes zero native parse calls; aggregate depth/value/output-byte limits remain enforced | Implemented |
| 32 | Text replacement scans matches and then reruns the regex for replacement | Build literal replacement chunks during one match traversal | 1,000 replacements never run String.replace on the document; 10,000 baseline-equivalent replacement cases | Implemented |
| 33 | Context packs wait for the slowest request in each batch of three | Sliding three-reader pool with abort, aggregate budget, and ordered results | Held first request does not block fourth/fifth requests after other slots complete; cap three; ordered results, abort/drain and byte-budget tests | Implemented |
| 34 | Folder upload completes all requests for one file before starting another | Three-file scheduler with stop-scheduling on pause/auth/rate/quota responses | Real upload helper with mocked requests covers create-only empty/nonempty files, done skipping, HTTP 401/403/429/507 pause, local-read abort; scheduler cap/drain tests | Implemented |
| 35 | Folder progress maps/re-renders the entire queue per progress callback | Frame-coalesced keyed updates with stable rows and lifecycle cleanup | 10,000 progress patches schedule one frame and retain two keyed patches; final status flush and disposal tests | Implemented |
| 36 | Text comparison mounts every LCS row, up to 3,000 | Accessible reachable 100-row pages for text comparison (distinct from existing draft LineDiff) | 2,000 text-diff rows render 100; all 20 pages reconstruct original rows, with original line numbers | Implemented |
| 37 | Run comparison rebuilds maps/sorts and mounts every manifest row on local UI updates | Prepared comparison model with bounded pages and demand metadata rendering | Comparison construction moved to successful load; 2,000 entries render 100 with all pages reachable; unopened metadata serializes zero times | Implemented |

## Validation and limits

All 17 candidates are implemented. The rows count whole behaviors, not individual edits, tests, security hardening, or helper extraction. #36 concerns the separate LCS-based TextCompare tool; the original draft LineDiff pagination is unchanged.

Focused validation (final result recorded below) covers the new algorithm, scheduler, transfer, and render suites plus existing directly affected behavior. The parent's baseline differential harness also compares exact results against the saved pre-expansion files. No full build or live fixture was run in this subtask.

### Changed files

All paths below are relative to `apps/web/src/`:

- `components/platform/`: `ContextPackBuilder.tsx`, `CsvInspector.tsx`, `FolderUpload.tsx`, `JsonInspector.tsx`, `JsonlExplorer.tsx`, `ResultPage.tsx` (new), `RunCompare.tsx`, `TextCompare.tsx`, `browser-expansion.test.tsx` (new).
- `lib/`: `agent-data.ts`, `agent-json.ts`, `csv-download.ts`, `csv-inspector.ts`, `csv-profile.ts`, `json-inspector.ts`, `json-pointer.ts`, `json-to-csv.ts`, `jsonl-explorer.ts`, `lossless-json.ts`, `text-diff.ts`, `text-replace.ts`.
- New browser helpers: `lib/browser-context-pack.ts`, `lib/browser-folder-transfer.ts`, `lib/browser-frame-batch.ts`, `lib/browser-task-pool.ts`.
- New helper/algorithm tests: `lib/browser-expansion.test.ts`, `lib/browser-folder-transfer.test.ts`, `lib/browser-task-pool.test.ts`.
- Report: `docs/performance-expansion-browser-2026-10-22.md`.

The file list for parent review is also saved at `/tmp/agfs-browser-expansion-files.txt`. Compare these paths with `/tmp/agfs-plus50-baseline-20261022`, not Git HEAD, to exclude the original phase.

### Security, compatibility, and practical limits

- No global private-data cache, altered owner filtering, permission bypass, server edit, dependency/manifest change, commit, or publication. Existing server authorization runs on every request. All folder paths still pass the original validated selection planner.
- Folder upload concurrency is three **files**, separate from the earlier SDK part concurrency. Each file retains the shared browser uploader's sequential part verification, create-only `ifMatch: null`, and resumable protocol. Pause stops new files; at most three active files finish. Completed files are skipped on retry. There is no cross-file atomicity guarantee.
- At most three 8 MiB file parts can be buffered concurrently, instead of one. The existing shared upload helper may finish its bounded retry delays after cancellation; the adapter refuses further requests/reads, disposed progress updates are ignored, and the scheduler drains active work.
- Context reads are scoped to one run; cancellation aborts all active requests and the existing latest-read guard suppresses stale parsing/output. Aggregate input limit is 256 KiB. A budget regression test caught and fixed a completion/rejection microtask race: the budget flag now stops scheduling immediately, before the rejected task's catch runs.
- Text LCS retains the original one-million-pair/1,500-line input cap and exact tie decisions. The new packed traceback saves allocation; this is not a claim that all workloads execute faster. Exact JSON scanning preserves number literals, duplicate-key rejection, own-property safety, and all source/depth/value bounds.
- Normalized search strings add at most another bounded source representation to the current loaded CSV/JSONL model; JSONL explorer drops its unused parsed value graphs. Formatting is synchronous when first requested. Paged lists keep all results reachable and reset on source/filter identity changes.
- CSV generation retains formula escaping, BOM, delimiter handling, and the 1 MiB output limit. It now holds only one projected row at a time rather than up to 5,000×200 projected cells.
- Counts and buffer sizes are deterministic local evidence, not production latency/billing claims. Parent owns live UX/accessibility checks, full build/integration, and independent review.


### Final focused results

- **104 tests passed across 21 focused suites** after final source formatting. Four new suites contain 29 new regressions/performance-evidence tests. Existing directly affected suites, including the original browser/editor panel tests, pass.
- The final rerun of `/tmp/agfs-plus50-differential.mjs` passed **40,000 text comparisons, 30,000 JSON syntax cases, 10,000 text replacements, and 3,000 CSV profiles**, comparing exact outputs/rejection behavior against the saved baseline (seed `0x1085249`).
- `git diff --check` passed. A review-only baseline diff is saved at `/tmp/agfs-browser-expansion.diff` (28 source/test files; this report is the 29th affected file).
- `npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/web typecheck` was run. **No diagnostics remain in this frontend scope.** The whole-web command is currently blocked by concurrent out-of-scope edits: `lib/r2.ts:79` (optional string), `lib/server-expansion.test.ts:89` (actor missing name), and `lib/server-expansion.test.ts:109` (result path access). Parent/server agent owns those fixes and the consolidated typecheck.

Reproduce the focused tests:

```sh
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/web test \
  src/lib/browser-expansion.test.ts src/lib/browser-task-pool.test.ts \
  src/lib/browser-folder-transfer.test.ts src/components/platform/browser-expansion.test.tsx \
  src/lib/lossless-json.test.ts src/lib/text-diff.test.ts src/lib/json-inspector.test.ts \
  src/lib/json-pointer.test.ts src/lib/json-to-csv.test.ts src/lib/jsonl-explorer.test.ts \
  src/lib/csv-profile.test.ts src/lib/csv-download.test.ts src/lib/csv-inspector.test.ts \
  src/lib/agent-data.test.ts src/lib/agent-json.test.ts src/lib/text-replace.test.ts \
  src/lib/agent-context.test.ts src/lib/folder-upload.test.ts src/lib/run-comparison.test.ts \
  src/components/platform/browser-performance.test.tsx src/components/platform/editor-panels.test.tsx
```

## Parent completion

The final combined build and workspace typechecks passed, resolving the concurrent server diagnostics recorded during this subtask. All 618 workspace tests, 27 Python tests, full integration, and independent reviews passed. The parent also verified pagination, exact JSON, search/profiling, context cancellation, and folder upload pause/resume/retry in the built browser interface. See the [complete verification report](performance-expansion-2026-10-22.md) for evidence and limits.
