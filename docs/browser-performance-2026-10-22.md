# Browser performance improvements — 2026-10-22

Exactly eight new browser/frontend improvements are implemented below. The audit found that directory pagination (100 entries), FileToolsPage lazy panels, JSON/CSV/JSONL pagination, and cancellation in `useData` and directory refresh already existed. Those existing behaviors are preserved and are not counted as new features.

The implementation follows the React performance guidance for conditional loading, deferred work, stable memo inputs, and indexed lookups. All retained private data belongs to a mounted component; no global or persistent private-data cache was introduced. API authorization, mutations, upload revision checks, and save behavior remain on their existing paths.

## 1. Reuse a prepared directory snapshot across searches and UI updates

**Hotspot:** Each folder query filtered and sorted again, lowercased names/paths again, and parsed timestamps inside the sort comparator. Counts and selection membership also repeatedly scanned the directory.

**Change:** `prepareDirectory` normalizes searchable text, parses timestamps once when date sorting, computes counts/bytes, builds path lookups, and sorts a component-owned snapshot. `filterDirectory` only scans that ordered snapshot. Files memoizes the preparation against entries/sort, maintains a selection Set, and reuses selected entries without changing their original order.

**Sources:** [directory-view.ts](../apps/web/src/lib/directory-view.ts), [files.tsx](../apps/web/src/routes/app/files.tsx).

**Verified:** [directory-view.test.ts](../apps/web/src/lib/directory-view.test.ts) checks natural sorting, folders first, stable ties, case-insensitive paths, refreshed snapshot isolation, counts, and original entry references. A 10,000-entry fixture performs exactly 10,000 date parses at preparation and zero date parses on subsequent queries.

**Limit:** Sorting still costs O(n log n) when the entries or sort changes; filtering remains O(n). The snapshot uses additional memory proportional to the current directory. Server list size and the existing 100-row page size are unchanged.

## 2. Defer directory search computation while keeping typing immediate

**Hotspot:** The directory query was directly coupled to synchronous filtering/sorting on every input update.

**Change:** Files uses `useDeferredValue(query)` as the memoized filter input. The input keeps its immediate value; a filtering status and `aria-busy` identify results from the previous query. Page-selection, row-selection, paging, and directory-export buttons wait for the results to catch up.

**Sources:** [files.tsx](../apps/web/src/routes/app/files.tsx), [DirectoryExport.tsx](../apps/web/src/components/platform/DirectoryExport.tsx), [FileAdvancedTools.tsx](../apps/web/src/components/platform/FileAdvancedTools.tsx).

**Verified:** The directory tests establish identical filtering and ordering semantics for the derived results. Source review verifies that the memo depends on the deferred query and that result-dependent selection/export controls are guarded. TypeScript passes.

**Limit:** React can defer renders but cannot interrupt a single running JavaScript filter. This is scheduling, not a debounce or a worker. Input latency and browser scheduling were not benchmarked in this subtask; live interaction remains part of the parent's integration checks.

## 3. Load optional directory workflows only when first opened

**Hotspot:** Files eagerly imported handoff, batch rename, selection export, folder upload, and inventory utilities. Some tools mounted and transformed selections even while their enclosing settings were closed.

**Change:** Two lazy modules contain selection workflows and advanced file tools. `AdvancedSettings` gains an opt-in lazy mode backed by Disclosure's existing mount-on-first-open behavior. Suspense announces loading. Once opened, content stays mounted so handoff notes, pending uploads, and navigation guards survive collapsing or temporarily clearing the selection. Ordinary AdvancedSettings forms remain eager for native validation.

**Sources:** [FileSelectionTools.tsx](../apps/web/src/components/platform/FileSelectionTools.tsx), [FileAdvancedTools.tsx](../apps/web/src/components/platform/FileAdvancedTools.tsx), [advanced-settings.tsx](../apps/web/src/components/ui/advanced-settings.tsx), [files.tsx](../apps/web/src/routes/app/files.tsx).

**Verified:** [browser-performance.test.tsx](../apps/web/src/components/platform/browser-performance.test.tsx) verifies that a closed lazy setting never invokes its module loader and that ordinary required form fields still render. A local static-import graph comparison against HEAD found 37 eagerly reachable local modules before and 19 afterward: 18 modules representing 43,379 original source bytes leave this route's eager graph. The inspection follows local static runtime imports and excludes type-only, dynamic, and package imports.

**Limit:** Those byte counts are unbundled source evidence, not compressed bundle savings. Shared chunks and other routes may still load some modules. First opening requires loading a chunk; production chunk sizes and real navigation need the parent's full build/browser validation.

## 4. Suspend cleanup and replacement previews while their editor panels are closed

**Hotspot:** Every edit recomputed cleanup and replacement outputs inside closed native disclosures. Cleanup also encoded both whole drafts for byte counts.

**Change:** Computation and preview rendering are gated on disclosure visibility. Recipe options, replacement text, and undo remain in component state across close/reopen. Byte counts are memoized with the cleanup result; identical output reuses the original count. Open-panel Apply and Undo use the current draft synchronously and retain freshness guards.

**Sources:** [TextCleanup.tsx](../apps/web/src/components/platform/TextCleanup.tsx), [TextReplace.tsx](../apps/web/src/components/platform/TextReplace.tsx).

**Verified:** [editor-panels.test.tsx](../apps/web/src/components/platform/editor-panels.test.tsx) renders large drafts and asserts zero cleanup, replacement, or byte-encoding calls while closed, and no private preview text in the rendered markup. Existing cleanup/replacement tests cover transformation semantics.

**Limit:** Open panels still compute synchronously for each draft change. Reopening recomputes against the latest draft. Browser close/reopen and undo interactions were reviewed in source, not exercised in a browser here.

## 5. Index editor line and Unicode offsets for repeated caret navigation

**Hotspot:** Cursor events sliced and split the document prefix and allocated code-point arrays. Four event listeners were detached/reattached on every edit.

**Change:** A per-document index stores line starts and surrogate-pair ends. Caret/selection counts use binary searches; go-to-line uses direct indexed offsets. The component reuses the index for caret events, refreshes on input or programmatic draft changes, keeps listeners stable across edits, and preserves state identity for unchanged positions.

**Sources:** [editor-position.ts](../apps/web/src/lib/editor-position.ts), [EditorNavigation.tsx](../apps/web/src/components/platform/EditorNavigation.tsx).

**Verified:** [editor-position.test.ts](../apps/web/src/lib/editor-position.test.ts) compares every UTF-16 selection boundary in mixed Unicode/newline fixtures against the old slice-based semantics, including split surrogate pairs, combining marks, CRLF, empty lines, invalid offsets, and independent revisions. A 50,000-line fixture requires at most two indexed reads per line selection and at most 81 indexed reads per caret/selection query.

**Limit:** Building a new index remains O(document length); index memory grows with lines and surrogate pairs. Display counts remain code points, not grapheme clusters. The component indexes native textarea text to account for browser CRLF normalization.

## 6. Bound draft diff rendering with reachable pages

**Hotspot:** LineDiff allocated and mounted every changed line, even though a scroll container displayed only a small portion. Unrelated draft form updates repeated splitting and comparison.

**Change:** A memoized prefix/suffix model retains the existing comparison semantics. A page materializes at most 100 diff rows, with Previous/Next controls, row totals, page status, and original line numbers. A changed proposal immediately starts from page one. All changed rows remain reachable.

**Sources:** [line-diff.ts](../apps/web/src/lib/line-diff.ts), [LineDiff.tsx](../apps/web/src/components/platform/LineDiff.tsx).

**Verified:** [line-diff.test.ts](../apps/web/src/lib/line-diff.test.ts) checks context, line numbers, empty/deleted files, clamped page bounds, and traverses all 80 pages of an 8,000-row diff without omissions. [browser-performance.test.tsx](../apps/web/src/components/platform/browser-performance.test.tsx) confirms exactly 100 rendered rows and accessible navigation for that fixture, reducing initial diff row DOM by 98.75%.

**Limit:** The full before/after strings and line arrays remain in memory. Browser find within this diff sees the current page; the existing full-before-and-after disclosure still exposes complete text. This retains the existing coarse prefix/suffix comparison rather than changing its diff algorithm.

## 7. Profile CSV columns only on demand using stable source rows

**Hotspot:** CsvInspector passed a newly sliced data array on every render, invalidating CsvProfile's memoization. Profiling scanned and sorted column values even while closed; width/header metadata was rebuilt while searching.

**Change:** Dataset metadata and source data rows are memoized independently of the search query and page. CsvProfile computes only while open, using the stable full-data array. Search and paging therefore do not invalidate column profiling. Header-mode or loaded-file changes correctly supply fresh data.

**Sources:** [CsvInspector.tsx](../apps/web/src/components/platform/CsvInspector.tsx), [CsvProfile.tsx](../apps/web/src/components/platform/CsvProfile.tsx).

**Verified:** [browser-performance.test.tsx](../apps/web/src/components/platform/browser-performance.test.tsx) confirms zero profiling calls for a closed panel with 5,000 rows. [csv-profile.test.ts](../apps/web/src/lib/csv-profile.test.ts) and [csv-inspector.test.ts](../apps/web/src/lib/csv-inspector.test.ts) preserve statistics, missing/blank cells, limits, and CSV parsing semantics. Memo dependencies were inspected for independence from filter/page changes.

**Limit:** Opening, changing columns, or changing header mode still profiles all loaded rows. Profiles intentionally cover the entire loaded dataset, including rows excluded by the table filter. No browser timing measurements were taken.

## 8. Cancel obsolete file-tool reads before parsing or publishing results

**Hotspot:** TextToolSource and CsvInspector used an action helper with no request cancellation. Leaving a tool could finish a private download and parse results that would never be displayed.

**Change:** A component-owned read lane aborts the previous request and aborts on unmount. Request identity guards success, error, and settled callbacks even when a transport ignores abort. File tools expose Cancel while loading; cancellation errors are suppressed. CSV parsing and TextToolSource callbacks run only for the active response. Explicit reloads still make fresh requests. Mutation helpers are unchanged.

**Sources:** [latest-browser-read.ts](../apps/web/src/lib/latest-browser-read.ts), [use-browser-read.ts](../apps/web/src/lib/use-browser-read.ts), [TextToolSource.tsx](../apps/web/src/components/platform/TextToolSource.tsx), [CsvInspector.tsx](../apps/web/src/components/platform/CsvInspector.tsx).

**Verified:** [latest-browser-read.test.ts](../apps/web/src/lib/latest-browser-read.test.ts) resolves requests out of order, simulates cancellation and ignored aborts, checks errors/parser failures, verifies independent tool instances, and proves repeated reads return new revisions. Superseded responses never invoke parsing/publication or clear the current request's loading state.

**Limit:** Cancellation cannot undo work already completed on the server or interrupt synchronous parsing already underway. Collapsing an already-mounted tool keeps it alive by design; the explicit Cancel control or route unmount cancels its read. Existing data retention is local to the mounted tool.

## Verification record

From `apps/web`, the focused suite passed **57 tests in 13 files**:

```sh
node_modules/.bin/vitest run --config vitest.config.ts \
  src/lib/directory-view.test.ts src/lib/line-diff.test.ts \
  src/lib/latest-browser-read.test.ts \
  src/components/platform/browser-performance.test.tsx \
  src/lib/csv-profile.test.ts src/lib/csv-inspector.test.ts \
  src/lib/rename-plan.test.ts src/lib/release-handoff.test.ts \
  src/lib/directory-export.test.ts src/lib/editor-position.test.ts \
  src/lib/text-cleanup.test.ts src/lib/text-replace.test.ts \
  src/components/platform/editor-panels.test.tsx
```

Web TypeScript validation passed. The Vitest config adds the existing `~` source alias so real UI components can participate in focused server-render tests. No testing dependencies were added. No browser session, full production build, commit, deployment, or publication was performed by this subtask. Full build/integration belongs to the parent task; source-graph and bounded-work evidence above must not be interpreted as measured real-user latency.

Parent browser verification subsequently exercised the built app: directory filtering and selection, first-open loading of both lazy workflow chunks, text cleanup/replacement undo across closing/reopening, Unicode line selection, saving a file, CSV profiling independent of its filter, and all three pages of a 251-row draft diff. Mobile checks used a 390px viewport. A selected-download button overflow found during those checks was fixed; files, tools, and draft review then fit the viewport. See [the combined maintenance report](maintenance-2026-10-22.md) for final checks and limits.
