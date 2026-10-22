# Browser feature expansion — 2026-10-22

Baseline: `9663bb0b0f778a933dc02028bf0ca3ddd27322a0` (PR 81). This phase adds **exactly 17 browser features, #71–87**. Existing product capabilities, the preceding 70 performance improvements, tests, documentation, integration polish, and hardening are not counted as new features.

The parent approved the feature list and explicit ownership before source edits. Implementation uses the existing frontend design system and the frontend-design / React best-practices skills. No dependency, service, server, contract, SDK, CLI, Python, manifest, lockfile, or OperationsPage changes belong to this subtask. R1 explicitly extended ownership to the shared AgentOutput component for optional save lifecycle and MIME props; existing callers retain their defaults. No commits, pushes, deployment, remote mutation, secrets access, shared full build, or application dev server was performed. The R1 checks used an authorized isolated fixture with mocked APIs.

## Discovery and workflow

Open **File tools → Prepare**. Three grouped workbenches provide task selection and contextual instructions: **Prepare JSON records**, **Prepare & reconcile tables**, and **Review documents for handoff**. Every task is also discoverable in the existing command palette and through `/app/tools#<task-id>`.

Choose a task, paste or explicitly load inputs, optionally replace them with a working example, and click **Generate preview**. Switching tasks preserves the main source, resets task-specific configuration and removes old results. Task selection also synchronizes the router hash, so command navigation to an earlier task and browser back/forward work consistently. Preview output can be copied, downloaded, or saved through the existing create-only workspace uploader. Suitable JSON/CSV outputs can become the next source. Existing destinations are refused by the unchanged uploader. No source is overwritten by a transformation. While Create file is pending, source/task/example/options changes are locked; a task hash change is deferred until the save settles, and its success/error feedback remains visible. CSV, JSON, text and Markdown exports carry their format MIME type.

The workbench module loads on discovery intent/open; each processing module loads only for its group's first preview. No processing runs while typing. Existing controls, native disclosure behavior, labelled fields, error/status regions and wrapping layouts are retained. Findings render in 100-row pages with at most 300 visible characters per cell; full values remain in the exported report. The existing generated-output preview renders at most 16,000 characters.

## Delivered additions and acceptance evidence

| #   | Task ID           | Distinct user value and checked acceptance                                                                                                                                                                                                                                          |
| --- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 71  | `record-project`  | Map output names to nested JSON Pointers across a record array. Tests cover escaped keys, exact large integers, safe own `__proto__`/`constructor`, error/null/omit missing policies and early wide-output refusal.                                                                 |
| 72  | `record-dedupe`   | Retain first/last records by an exact structural key or entire record. Tests cover key-order differences, equivalent exponents/decimals, negative zero, missing versus null and stable survivor order. Original survivor number literals remain intact.                             |
| 73  | `record-group`    | Produce first-seen scalar-key buckets containing original records. Tests cover numeric equivalence, distinct string/numeric keys, negative zero, null and missing/nonscalar refusal.                                                                                                |
| 74  | `record-sort`     | Stable scalar-pointer sorting with exact decimal comparison. Tests cover huge exponents without expansion, integers beyond binary64 precision, negative zero, equal ties, mixed scalar ordering and missing-field refusal.                                                          |
| 75  | `record-index`    | Build a lookup object from a unique string field. Tests cover safe hostile property names and duplicate, missing or non-string key refusal.                                                                                                                                         |
| 76  | `record-patch`    | Preview sequential add/remove/replace/test/copy/move operations. Tests cover escaped pointers, array insertion/movement, copy isolation, structural and exact-number tests, atomic failed-preview refusal, descendant moves, invalid indices, root removal and bounded growth/work. |
| 77  | `record-audit`    | Check an explicit small record contract of required pointers and allowed JSON types. Tests distinguish optional/missing/null/type mismatch and verify complete counts with an explicit 1,000-finding report cap. This is not JSON Schema.                                           |
| 78  | `table-sort`      | Sort CSV rows by text or exact decimal values. Tests cover stable numeric ties, huge integers, multiline/quoted cells, delimiters and invalid numbers.                                                                                                                              |
| 79  | `table-dedupe`    | Remove duplicates by selected composite columns with first/last survivors. Tests cover ambiguous concatenations, empty key cells and preserved source order.                                                                                                                        |
| 80  | `table-group`     | Produce grouped row counts and optional exact decimal sums. Tests include 0.1 + 0.2, large integers, fractional exponents, cancellation to zero, invalid numbers, exponent limits, header conflicts and header-only input.                                                          |
| 81  | `table-unpivot`   | Reshape selected wide measures into field/value rows while retaining selected identity columns. Tests cover ordering, disjoint selection, reserved output headers and preflight row-growth refusal.                                                                                 |
| 82  | `table-append`    | Append datasets by exact header name using strict or union schema. Tests cover reordered columns, missing-column fill, strict mismatch and aggregate row/byte limits.                                                                                                               |
| 83  | `table-rename`    | Map header names with simultaneous preflight collision checks. Tests cover swaps, hostile property names, unknown names, blank destinations and duplicate destinations.                                                                                                             |
| 84  | `table-reconcile` | Compare uniquely keyed table versions and export added/removed/changed records, changed columns, complete before/after arrays and parsed row references. Tests cover reordered headers, multiline cells, key/schema refusal and empty changes.                                      |
| 85  | `document-links`  | Inventory supported inline links/images and classify inert targets for review. Tests cover source lines, code exclusion, reference exclusion, unsupported-candidate counts, suspicious schemes/entities and review filtering. No targets are fetched or activated.                  |
| 86  | `document-tasks`  | Extract task status, nearest heading and source line for handoff. Tests cover unordered/numbered markers, open/completed filters, fence handling, indented-code exclusion and empty results.                                                                                        |
| 87  | `document-redact` | Replace explicitly configured literals with named redaction markers and review occurrence counts. Tests cover longest-match overlap, literal dollar text, Unicode, nonrecursive replacement, unused rules, ambiguous rules, output expansion and adversarial prefix work.           |

## Exact semantics and supported subsets

JSON parsing reuses the existing exact-number parser, rejecting duplicate object keys and enforcing 40 levels / 10,000 values. Structural equality ignores object key order and treats mathematically equivalent numeric literals, including negative zero, equally. It never rounds through JavaScript `number`. Retained values keep their source number tokens. Array order remains significant. Missing values are distinct from null; grouping, sorting and indexing reject missing keys, while deduplication gives missing keys their own group. Sorting uses null, boolean, number, string order ascending, reversed descending; strings use code-unit order, with stable ties.

JSON Patch semantics were checked against [RFC 6902](https://www.rfc-editor.org/rfc/rfc6902). The explicitly documented limitation is refusal to remove the root document, since the tool exports JSON and no JSON value would remain. Invalid or failed operations return no partial output. Every intermediate document is bounded; copying cannot create shared mutable subtrees or unbounded expansion.

CSV requires unique nonempty headers and consistent row widths. Composite keys and reconciliation compare cell strings exactly. Decimal sorting refuses empty/invalid cells. Sums use bounded integer arithmetic, normalized exponent range ±1,000, and a 2,048-digit working limit. Empty tables yield a header-only summary rather than an invented zero-count group. Existing CSV export protection prefixes formula-like cells, including negative numbers, with an apostrophe. Such exported cells remain text when reused; the UI recommends retaining the original source for further numeric operations. Numeric parsing does not silently strip protection.

Markdown inventory deliberately supports simple inline `[label](target)` links and `![label](target)` images. Fenced and indented code and matched inline backtick spans are skipped. Reference links, HTML, autolinks, titles, escaped labels and nested destination parentheses are outside this subset. Unsupported recognized candidates are counted when applicable; this is not a complete Markdown parser or a security scanner. Target classification cannot establish target safety, availability or authorization.

Task extraction supports `-`, `*`, `+`, and numbered markers followed by `[ ]`, `[x]` or `[X]`, indented up to three spaces, with nearest preceding ATX heading (`#` through `######`). Deeper nesting, setext headings and code content are outside its subset.

Literal redaction is case-sensitive and only checks configured text. At a source position the longest configured literal wins; inserted replacement text is not searched again. It does not discover secrets. Literal values are omitted from the occurrence table, but user-supplied rule names appear in output and should be nonsensitive.

## Resource envelope and cancellation

- Per input and generated output: 256 KiB UTF-8. Two-input operations can hold up to 512 KiB of source text plus bounded parsed data and output. Browser working memory is greater than source bytes because of strings, objects, indexes, comparison keys and previews; working memory is not claimed to equal the output cap. The R1 observations below measure local serialization and noisy process heap changes only, with no cloud billing claim.
- JSON: 10,000 parsed/output values, 40 nesting levels, 1,024-character number tokens; projection has an early 10,000-value lower-bound guard. Grouping/sorting/deduplication use bounded maps/arrays. Exact comparison keeps exponents symbolic instead of materializing their zeros.
- Patch: at most 100 operations, with intermediate output validation and a cumulative 500,000-unit work guard. Work units are conservative algorithm counters, not measured CPU time or a universal instruction limit; some valid large patches deliberately refuse early.
- CSV: existing parser's 5,000-row / 200-column bounds; generated tables include their header in the 5,000-row cap. Append/unpivot reject excessive row/schema growth before expansion. A guarded iterable checks exact protected CSV byte growth before the shared writer consumes each row. Reconciliation checks serialized change growth before retaining each change.
- Contract audit: 30 rules, 1,000 reported findings, full bounded-input count, and explicit `complete`/count fields. Documents: 10,000 lines, at most 1,000 task/link findings. Redaction: 100 unique rules, 80-character names and 1,024-character literals, a prefix trie and a 500,000-unit traversal guard. Oversized exports refuse rather than silently truncate.
- Sorting is O(n log n) comparisons; other transformations scan bounded records/cells/characters with capped output. Counters, limits and row counts are deterministic evidence, not latency or CPU measurements. Report and exact-JSON string serialization counts escaped UTF-8 bytes before stringifying each fragment and before retaining each finding. Complete reports are joined only within the 256 KiB cap. Formatting still creates bounded temporary strings; this is not zero-allocation processing. Reports use compact JSON with unchanged values.
- All 17 example transformations run with `fetch` stubbed to fail, and make **zero network calls**. There is no new DB read/write, cloud compute loop, poller, persistent private-data cache or background timer. The existing command palette retains its existing workspace search behavior.
- Optional source loads use the existing permission-checked `/text` endpoint and `useBrowserRead` latest-read guard. Workspace requests abort; local file reads are limited before `arrayBuffer()` and their stale completions are ignored. Task/input changes and cancellation clear previews and cancel pending source/module-load lanes. The bounded synchronous transformation itself is not preemptible; cancellation cannot interrupt JavaScript already running. Module-loading cancellation and stale-result suppression are supported without promising background-worker execution.
- Optional saves retain the existing create-only uploader and its quota/path/authorization behavior. Their cost depends on that existing upload path; this subtask introduces no new mutation protocol.

## Validation and review handoff

Focused helper, rendering, examples and affected baseline suites pass; final counts and source manifest are appended after the last run below. Tests include 1,000 generated decimal comparisons against scaled integer arithmetic, all 17 working examples, zero transformation requests, exact JSON semantics, resource refusals, 100-row rendering, inert targets, and shared-lane cancellation/supersession.

Static rendering verifies labelled task controls, explicit preview and empty states. R1 additionally exercised mounted components in an isolated fixture as detailed below. That fixture omits the application stylesheet and mocks APIs; it does **not** establish polished mobile layout or live backend integration. The parent separately owns independent review, consolidated build/integration, and release. No shared application dev server or full build was started here.

Reproduce the focused run:

```sh
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/web test \
  src/lib/browser-record-tools.test.ts src/lib/browser-table-tools.test.ts \
  src/lib/browser-document-tools.test.ts src/lib/browser-feature-bounds.test.ts \
  src/components/platform/browser-features.test.tsx \
  src/lib/lossless-json.test.ts src/lib/json-pointer.test.ts \
  src/lib/csv-inspector.test.ts src/lib/csv-download.test.ts \
  src/lib/latest-browser-read.test.ts src/components/platform/browser-expansion.test.tsx \
  src/components/platform/browser-performance.test.tsx src/components/platform/editor-panels.test.tsx
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/web typecheck
```

### Owned file inventory

Existing files modified:

- `apps/web/src/components/CommandPalette.tsx`
- `apps/web/src/components/platform/FileToolsPage.tsx`
- `apps/web/src/components/platform/AgentOutput.tsx` (R1 optional save lifecycle and MIME props)

New production files:

- `apps/web/src/components/platform/DataPreparationWorkbench.tsx` (contains all three group wrappers)
- `apps/web/src/lib/browser-feature-catalog.ts`
- `apps/web/src/lib/browser-feature-core.ts`
- `apps/web/src/lib/browser-record-tools.ts`
- `apps/web/src/lib/browser-table-tools.ts`
- `apps/web/src/lib/browser-document-tools.ts`

New focused tests:

- `apps/web/src/components/platform/browser-features.test.tsx`
- `apps/web/src/lib/browser-record-tools.test.ts`
- `apps/web/src/lib/browser-table-tools.test.ts`
- `apps/web/src/lib/browser-document-tools.test.ts`
- `apps/web/src/lib/browser-feature-bounds.test.ts` (R1 allocation/work regressions)

Report: `docs/feature-expansion-browser-2026-10-22.md`.

### R1 findings, fixes and measured evidence

The two resource regressions were reproduced before edits. A heading with 1,000 intervening spaces took 234.14 ms locally; 3,000 spaces took 7,058.09 ms. The task-report reproduction produced a single 32,042,896-character stringify result before refusing output; the audit reproduction produced 4,205,021 characters. These are local Node observations, not production CPU measurements.

- Heading recognition now uses a linear parser with charged prefix, suffix and title extents. Supported ATX syntax and small legacy edge cases are covered. For 1,000 / 3,000 / 30,000 / 120,000 spaces, deterministic charged steps were 1,004 / 3,004 / 30,004 / 120,004. Local full-task medians after five warmups (ten samples) were 0.025 / 0.023 / 0.122 / 0.440 ms. Tests assert syntax/work bounds rather than timing thresholds.
- Task, audit, link and reconciliation reports now charge exact serialized UTF-8 bytes, including quotes, controls, surrogate pairs and lone-surrogate escapes, before allocating serialized fragments or retaining report findings. Exact JSON output has the same string preflight. The 64,000-character heading × 500 tasks reproduction now refuses with a largest stringify of 64,002 characters and total stringify bytes 256,206; the 4,096-character pointer × 1,000 missing findings case has largest stringify 4,098 and total stringify bytes 257,434. No complete oversized report is allocated. Process heap deltas in the final probe were −2,053,144 and +1,022,192 bytes; garbage collection makes them unsuitable as heap ceilings or before/after savings. Source arrays, chunks, object overhead and simultaneous bounded strings still consume additional memory.
- Mounted router checks cover command target → different UI selection → original target, back/forward, and preparation-group navigation. Held create-file commits verify locked source/task/example/options, disclosure close/reopen persistence, deferred task changes, retained success and failure feedback, and no hidden retry. Actual upload-intent/blob/commit payloads were checked for CSV, JSON, text and Markdown filenames, exact bytes, MIME and create-only `ifMatch: null`.
- The new boundary tests include repeated headings/pointers, Unicode/control expansion, total serialization budgets, and all UTF-16 code units. Existing structural equality, exact-number survivor semantics, hostile property names, work refusal, all 17 request-free examples, cancellation and rendering coverage remain passing.

The copied fixture and observations are in `/tmp/agfs-r1-implementation/`: `main.tsx`, `build.cjs`, `mounted-checks.json`, `mounted-alert-final.json`, `probes.cjs`, and `probe-results.json`. The original independent review artifacts were preserved. The owned fixture process and tab were closed after testing. This is mounted UI/mock transport evidence, not live Cloudflare/storage/backend validation or styled mobile evidence.

### R2 follow-up: redaction line ceiling

Independent R2 cleared all seven R1 findings and identified one uncounted P3: literal redaction returned before the shared 10,000-line limit. The fix validates the source line count before selecting a document operation. A single bounded scan counts LF, CR and CRLF (CRLF counts once), including the empty final line after a trailing newline, without allocating a line array. It stops on the 10,001st line before parsing redaction rules or constructing the replacement trie. Other Unicode line-separator characters retain their existing treatment as literal text.

The existing 256 KiB UTF-8 input check runs first. The new preflight uses constant auxiliary space and at most one pass over the byte-bounded source; it does not change the redaction traversal's 500,000-unit work budget. This is a source-level resource bound, not a measured cloud CPU or heap claim. Regression tests preserve acceptance of a full 262,144-byte single line, require exactly 10,000 lines to succeed and 10,001 to fail for LF/CRLF/CR/mixed endings, and verify unchanged output text. Maximum-byte newline floods refuse before rule parsing with no string split and at most 20,000 character-code inspections; oversized bytes still fail at the original byte guard.

Post-fix validation: **19 tests passed across the document and bounds suites**, web typecheck passed without diagnostics, and owned formatting/whitespace checks passed. The unrelated mounted suite was not rerun because this change only adds the documented input refusal. R2's prior mounted/110-test clearance remains distinct from this narrow validation. Exactly 17 browser features / 50 phase features remain; no shared build, dev server, install or remote action occurred.

Only `browser-document-tools.ts`, `browser-document-tools.test.ts`, `browser-feature-bounds.test.ts`, and this report changed for P3. The complete browser inventory remains 15 files / nine production files; the other 19 browser/Operations production files match their R2-reviewed hashes. Focused inventory: `/tmp/agfs-browser-r2-fix-files.txt`; production hash: `/tmp/agfs-browser-r2-fix-source.sha256`. The full current browser manifest below and `/tmp/agfs-browser-feature-source.sha256` are refreshed for the new focused R3 review.

### Final focused results and settled source

- **110 tests passed across 16 suites** in the combined browser/Operations/affected-baseline run after R1. This includes the 256 KiB preallocation regressions and four create-file MIME cases. Test output: `/tmp/agfs-r1-implementation/focused-tests.log`.
- Web typecheck passes after the R2 P3 fix. The earlier R1 server-review-test typing diagnostic was resolved by its owner; the old `/tmp/agfs-r1-implementation/web-typecheck.log` is historical, not the current result.
- Owned formatting and whitespace checks passed. No dependency changes were made.
- Nine production files are settled. Fifteen total browser-owned files include five test files and this report. Exact inventory: `/tmp/agfs-browser-feature-files.txt`. Production SHA-256 manifest: `/tmp/agfs-browser-feature-source.sha256`.
- R1 changed five original browser production files and the newly authorized AgentOutput. CommandPalette, FileToolsPage and browser-feature-catalog retain their previous settled bytes. R1 fixes add zero features.

```text
febfd782add1e4e0f53e0d55bb8018d57b4cd294c97fdda9ec950cb1b9c9e545  apps/web/src/components/CommandPalette.tsx
5313007684590d531e67be979ae790f17111d68a9f3785ebd9310c7dd9bea1d8  apps/web/src/components/platform/FileToolsPage.tsx
cc07928c81367e3188da2e27adf2ae15ddaf2142e431a688b4ea36e51ed944c6  apps/web/src/components/platform/DataPreparationWorkbench.tsx
523ef2679faa141315e5bce89118d9744a5ec5ce4ce28090448026ce8c257bb1  apps/web/src/lib/browser-feature-catalog.ts
201e10b72e24aad74bd5737482db090bceb8e3fc6e747eeffedafb42aa7f6f41  apps/web/src/lib/browser-feature-core.ts
1f0dc103d156522bb99a7021aabd757015bead77b8bb52b10e620a4e4738b168  apps/web/src/lib/browser-record-tools.ts
4e59b3e62a44248226546bc34b0d6a3657c8ce8bb99c86455018cb089ed0bcbd  apps/web/src/lib/browser-table-tools.ts
0650fc25f4c73bf2793ac267739cee0b609651d9b8ef1baf80c50f4ac96e4215  apps/web/src/lib/browser-document-tools.ts
fbdb6e5d9a2b8651a92d4689ec8e75f7ca8a736a7418b802206538205c6b5599  apps/web/src/components/platform/AgentOutput.tsx
```
