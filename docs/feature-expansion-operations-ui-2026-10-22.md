# Operations UI integration — 2026-10-22

This handoff integrates the 17 server features #88–104 into Operations & recovery. These UI integrations are **not additional counted features**. The separate browser #71–87 report records its explicitly authorized R1 fixes; feature counts are unchanged. No server/contracts/client-package sources, manifests, dependencies, or shared scripts were edited for this integration.

## Delivered workflows

Resource controls & planning is a lazy section on the existing Operations page. Connecting binds the controls to the current account/workspace; six task groups load their component chunks only when opened. Opening a group does not fetch its endpoints. Current health, thresholds, job diagnostics, credential notices, snapshots, restore preview, and restore confirmation remain available.

| Server feature                 | UI and acceptance behavior                                                                                                                                                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #88 Search indexing policy     | Load the saved policy before editing content/metadata mode and the 0–1 MiB threshold. Show revision, saved threshold, and explicit reindex requirement.                                                                                                              |
| #89 Index diagnostics          | Folder/state filters, typed diagnostic rows, latest-page inspected count, and explicit continuation. Empty filtered pages retain Load next page.                                                                                                                     |
| #90 Scoped reindex             | Actual server dry run of one page before a separate apply action. Folder, failed-only filter, and cursor are captured; edits invalidate the preview. Show inspected, candidates, enqueued, and maximum potential object reads.                                       |
| #91 Background controls        | Load and edit indexing/webhook pause flags. Explain that queued work is retained and maintenance continues.                                                                                                                                                          |
| #92 Queue failures and retry   | Explicit paged failure listing, up to 20 selected IDs, and per-item retried/unavailable outcomes.                                                                                                                                                                    |
| #93 Maintenance status         | Explicit snapshot with at-least pending/due counts, next due times, dispatch/health progress, per-turn limits, and continuation explanation.                                                                                                                         |
| #94 Upload inventory           | Folder/status/token/UTC-before filters, multipart/direct distinction, size/reserved/uploaded bytes, timestamps, and explicit candidate-page continuation. Direct uploaded bytes remain unknown when null.                                                            |
| #95 Upload abandonment         | Select at most 20 reservations, obtain an actual dry run, then apply only IDs eligible in that preview. Show every returned outcome and explicitly state that daily upload budget is never refunded.                                                                 |
| #96 Budget history             | Bounded token-page selection or known token ID, 1–90 days, UTC dates, operations and upload-budget usage.                                                                                                                                                            |
| #97 Budget preflight           | Planned operations/upload/storage inputs; advisory allowed/blockers/remaining/used/reset/constraints display. No reservation or guaranteed execution is claimed.                                                                                                     |
| #98 Batch budgets              | Select up to 20 tokens across bounded pages, retain individual drafts, review, and save. Empty limits serialize to null/unlimited; zero remains zero. Page loads, selection changes, edits, and submission invalidate review. Actual returned updated IDs are shown. |
| #99 Request metrics            | 1–168 hours and 5/15/60-minute buckets; reject over 168 buckets before requesting. Optional route filter, counts, errors, rejections and elapsed latency. Latency is explicitly not CPU time.                                                                        |
| #100 Alert acknowledgement     | Lazily opened alert forms display existing attention state, add/update notes up to 500 characters, and clear acknowledgement.                                                                                                                                        |
| #101 Alert snooze              | Snooze 1–10,080 minutes and explicitly unsnooze with zero. Include hidden/resolved/acknowledged alerts for inspection. Attention remains distinct from resolution and live evaluation.                                                                               |
| #102 Retention references      | Live-path reference lookup, multiple reference kinds, expiration and cursor navigation. No object keys are exposed.                                                                                                                                                  |
| #103 Expiring pins             | 1–90-day window, paged pin rows, reference kind/name, expiration and referenced bytes. No promise that those bytes will be freed.                                                                                                                                    |
| #104 Terminal delivery cleanup | Explicit webhook selection and latest-100 delivery history. Only delivered/failed rows can be selected (maximum 50); actual dry run precedes separate deletion of preview-eligible IDs. Per-selected-ID outcomes and server note remain visible.                     |

The old immediate workspace-wide reindex button now opens the scoped controls and explains the preview flow. Reindex previews now return an authenticated five-minute review token and epoch-millisecond expiry. Apply sends that token with the identical path, failed-only filter and original input cursor (never the response next cursor). The server contract atomically rejects changed candidate snapshots/revisions/policy or invalid/expired reviews with 409 and zero enqueue. The UI disables missing/expired reviews and consumes local review on every apply attempt, with explicit re-preview after error or an uncertain response. It never automatically retries or previews. Abandonment and delivery cleanup narrow the applied request to the IDs eligible in the actual preview. All three require another preview after a consumed or invalidated review.

## Interaction and safety

- New results use exported `@agfs/contracts` response interfaces. Local response shapes only describe pre-existing webhook listings and existing health base fields. Budget token metadata uses `BudgetTokenSummary` and `BudgetTokensResult` from the shared contracts.
- Index, upload inventory and retention-reference reads always use read-only POST JSON, preserving full paths and undefined-field omission. These requests use `useOperation.read` through the paged read helper, carry abort signals, and do not set the mutation flag or perform identity preflights. Other GET reads are unchanged.
- Reads use the existing component-owned latest-read lane. Abort signals, cancel controls, latest-response guards, and unmount cancellation prevent late reads/previews from becoming current results.
- Writes use a synchronous duplicate-submission lock and disable related controls. They run to completion; canceling an HTTP request would not guarantee rollback, so no mutation-cancel promise is made. Unmounted components suppress their write completion updates.
- Before each actual mutation, the transport checks the current account/workspace again. A change invalidates the connected controls and requires reconnect/review. Every operation request pins the selected workspace with the supported header; server authorization remains authoritative. Normal workspace switching already reloads the application. Connected controls cannot be manually torn down by a reconnect button during an active mutation.
- Filter, selection, cursor, endpoint, and namespace changes clear affected previews and pages. Review requests are cloned and consumed once. Failed applies require another preview.
- Tables use the existing scroll container and 100-row local pager, with stable source arrays and row keys. Forms use existing labels, native validation, keyboard-operable disclosures/selects/buttons, responsive grids, explicit loading/status text, focusable announced errors, and empty states. Individual alert forms mount only when opened.
- Health refresh uses an abort/latest-request guard. Alert mutation state, duplicate-submission lock and completion/error feedback live above filtered alert children. The pending alert remains rendered when filters change; all attention actions stay locked through the single health refresh. A new action clears the previous success. A failed refresh is reported separately from a successful attention mutation.

## Resource envelope and limitations

These are source-level bounds and request counts, **not measured cloud CPU, memory, billing, or latency savings**.

- Initial Operations behavior keeps the existing health/snapshot loads. New control groups add **zero endpoint requests on mount**, zero polling, zero recursive page drains, and zero automatic mutation/retry loops.
- Connect makes one `whoami` request. Each requested view or preview makes one endpoint request. Each actual mutation adds one identity check before its endpoint request. Successful alert-attention changes add one health refresh. There is no per-row fetch fanout.
- Index/upload/reindex candidate pages are server-bounded at 50; empty filtered pages still advance explicitly. These candidate/reference views retain at most 500 matching rows and render at most 100 at once. Budget selection has a separate, stricter single-page bound described below. The append ceiling is checked before concatenation. Cursor progression is not inferred from result count.
- Retry/abandon/batch requests contain at most 20 IDs/updates; terminal cleanup contains at most 50 IDs. Webhook history uses the existing latest-100 endpoint. Alert forms derive from the existing latest-50 health list. Metrics retain at most 168 buckets; budget history at most 90 daily rows.
- Budget selection calls only `GET /operations/budgets/tokens?cursor` through explicit first/next/reload actions. Each response replaces the previous page: at most 50 token metadata rows are retained and displayed, plus at most 20 independently editable drafts. There is no accumulated page array or per-token usage request. The server-owned endpoint selects at most 51 metadata rows with one indexed owner-scoped SQL query, returns at most 50, and performs no usage/storage aggregates or object reads. The UI rejects an oversized response before retaining/rendering it. Known token ID entry supports history/preflight with **zero token-list requests**. The new Operations UI makes no calls to the legacy unpaged budget listing.
- Reindex expiry uses one local timeout for the current review, canceled when it changes; it performs no requests.
- Closing a visited disclosure preserves its component state. No new local/session storage, global private-data cache, subscription, or paid service is introduced.
- Read cancellation prevents stale UI updates; it cannot promise to stop work already accepted by the server. Mutation/network ambiguity is surfaced as an error, not invented success.

## Validation

After dependency recovery was declared ready:

```sh
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/web typecheck
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/web test src/lib/browser-operation-budgets.test.ts src/lib/browser-operations.test.ts src/components/platform/operations-ui.test.tsx src/lib/latest-browser-read.test.ts src/components/platform/browser-performance.test.tsx
```

Initial bounded-selector validation: web typecheck passed with no diagnostics; **32 tests passed across five suites** (24 new integration tests, eight existing shared-read/rendering tests). Transport/behavior coverage includes pinned namespace requests, authorization denial, changed namespace refusing mutation, real dry-run response followed by a separate apply request, preview narrowing and partial outcomes, immutable one-use review, canceled/late preview suppression, empty-page continuation, row/selection ceilings, metric-window rejection, and null versus zero limits. Static component rendering covers no automatic request fanout, no automatic mutation, empty-page navigation, 100-row rendering, escaped content, labelled selection, lazy alert forms, attention states, read-only cancellation affordances, focusable errors, and truthful resource wording. Bounded-selector tests additionally exercise single-page replacement, 50-row rejection, cross-page draft preservation, 20-draft ceiling, off-page draft removal, review invalidation after refresh/selection/edit/submission, null/zero round trips, empty-page continuation, cancellation, and accurate paused/enabled labels.

The repository component tests render React markup in Node. R1 additionally exercises actual mounted controls in the copied isolated fixture described below. Neither proves styled mobile layout or live endpoint integration; those remain with root-coordinated review. This agent did not run a shared full build, application dev server, remote action, commit, or deployment.

Owned changed-source whitespace and formatting checks passed. The production hash manifest below is the current R1 UI source reference for review; browser hashes are separately refreshed in its report.

## Exact owned inventory

Modified production:

- `apps/web/src/components/platform/OperationsPage.tsx`

New production:

- `apps/web/src/components/platform/OperationsControls.tsx`
- `apps/web/src/components/platform/OperationsShared.tsx`
- `apps/web/src/components/platform/OperationsIndexing.tsx`
- `apps/web/src/components/platform/OperationsBackground.tsx`
- `apps/web/src/components/platform/OperationsUploads.tsx`
- `apps/web/src/components/platform/OperationsBudgets.tsx`
- `apps/web/src/components/platform/OperationsRetention.tsx`
- `apps/web/src/components/platform/OperationsObservability.tsx`
- `apps/web/src/lib/browser-operations.ts`
- `apps/web/src/lib/browser-operation-budgets.ts`

New validation/report files:

- `apps/web/src/lib/browser-operations.test.ts`
- `apps/web/src/lib/browser-operation-budgets.test.ts`
- `apps/web/src/components/platform/operations-ui.test.tsx`
- `docs/feature-expansion-operations-ui-2026-10-22.md`

Total: 15 owned files; eleven production files (one modified, ten new), three new test files, and this new report. `/tmp/agfs-operations-ui-files.txt` contains the same complete inventory; `/tmp/agfs-operations-ui-source.sha256` contains production hashes.

## Bounded token-selector follow-up

The follow-up changes only `OperationsBudgets.tsx`, its new browser-only `browser-operation-budgets.ts` helper and focused test file, the existing `operations-ui.test.tsx`, and this report. It supports #96–98 and adds zero feature count. At that selector handoff, other settled Operations production files and all eight #71–87 browser production files were byte-identical. The later R1 changes are listed separately below.

Token rows contain metadata only, with budget paused/enabled labels rather than an assertion of valid credentials. Non-revoked expired tokens remain visible for management/history; preflight decides whether proposed use is permitted. First/next/reload actions invalidate review immediately, including canceled or failed loads, while preserving selected local drafts. Selecting an already-drafted token does not overwrite edits. Drafts absent from the current page remain editable/removable. The UI explains how to remove and reselect a token to refresh a draft's saved limits. Account/workspace key changes remount the budget controls and cancel old reads.

Focused suites and web typecheck passed after the typed selector contract landed. No shared build, server, dependency change, commit, or remote action was performed. Mounted browser interaction was subsequently exercised for R1; styled/live integration remains part of the coordinated review.

## R1 review fixes and transport validation

These changes add no features. OperationsIndexing, OperationsUploads, OperationsRetention, OperationsObservability and browser-operations are the only production files changed after the bounded-selector handoff. The other six Operations production hashes are unchanged.

- The alert race was tested on actual mounted components: begin a held acknowledgement, hide/show the acknowledged/snoozed/resolved group, close/reopen the disclosure, and attempt another acknowledgement. The same pending form survives, the duplicate does not dispatch, and the original completion/health refresh is retained above the filter. A subsequent failed action clears old success and keeps error feedback after hiding the form. Two explicit attempts produce two acknowledgement requests and only the successful one refreshes health.
- Mounted reindex checks verify the original input cursor and token on a successful apply, consumed review after success, missing-token refusal, expiry disabling via the one-shot timer, stale 409 error with consumed review, explicit re-preview, input-change invalidation and no automatic retry. The exported typed contract is used. The fixture simulates 409; it does **not** validate the server's HMAC, snapshot/transaction guards or actual queue behavior. Those remain server-agent/root integration evidence.
- All three path reads were mounted with `/` plus 4,095 CJK characters: the exact 4,096-code-unit path is sent in JSON, not the URL. Measured request bodies were 12,297–12,327 UTF-8 bytes with the short fixture continuation cursor, below the server's 16 KiB JSON cap. Index and retention-reference empty pages retain continuation. Mounted cancellation aborts the passed signal and a late result after a path change is suppressed. The entire read sequence has one connect identity request, no mutation preflight, no automatic panel fetches, and no automatic dispatch/audit call.
- The real server cursor has an 11,023-character wire cap and relative UTF-16/base64url positions; the server owns generation and combined path/cursor body bounds. The fixture's short cursor is not evidence of the maximum real combined body. Server maximum-path/cursor round trips and live integration must be assessed separately. The UI never truncates user paths or silently alters continuation values.
- Final combined browser/Operations/affected-baseline validation: **110 tests across 16 suites passed**, and no browser/Operations UI typecheck diagnostics. An earlier shared web typecheck passed; the final rerun reports only the concurrently added `server-feature-expansion-review.test.ts:66` response-typing diagnostic (`revision`), which is parent/test-owner work. Tests retain authorization denial, cancellation, null/unlimited versus zero, bounded token-page/draft behavior, no fetch fanout, and resource semantics coverage; new transport tests exercise Unicode JSON bodies, omitted undefined fields, abort signals and absence of mutation identity checks.

Artifacts: `/tmp/agfs-r1-implementation/mounted-checks.json`, `mounted-alert-final.json`, `focused-tests.log`, and `web-typecheck.log`, with the copied fixture source/build script in the same directory. The original reviewer fixture is untouched. The owned fixture server/tab were closed. This harness mocks APIs and omits application styles; no polished mobile or live backend claim is made. Fresh independent R2 and combined integration are parent-owned before release.

## Mobile label follow-up

The live browser review found that the full token name in the batch-removal button overflowed its card at 390 × 844. The visible label is now the concise “Remove from batch”; `aria-label` retains “Remove {token label} from batch” for the full contextual identity. The removal handler, review invalidation, disabled state and shared Button styles are unchanged. This adds no feature or request/resource cost.

Only `OperationsBudgets.tsx` and this report changed. Production SHA-256 changed from `4e9d932f8bcf73907017dcfdd3a2f4e31b504895eabfb9a78139f9628a485283` to `4f382ca7d46b00035bfb8162e7772aa201c818ea8f7096242bcdacdf09c581e6`. The other ten Operations production files and all nine browser production files match their prior manifests. Inventory counts remain 15 Operations files / eleven production files. Whitespace and formatting checks passed; no new tests were added for this text/accessible-label-only change. Styled visual verification of this exact fix is pending the root-coordinated final web build; no new browser, build or fixture was run here.

## Settled production SHA-256

```text
f23b5840b03b47d3765a6a75011a30774d22d1413f6ea7227e9a2848dc46ff75  apps/web/src/components/platform/OperationsPage.tsx
ea8e25132a48601de1db453900b107cfb4ab018ee33eedce16658eb920c73062  apps/web/src/components/platform/OperationsControls.tsx
f2f17a01cdb378e16e7f6baca141137e4cd93e85cd34e1002b32b96819846d36  apps/web/src/components/platform/OperationsShared.tsx
89cac53140e32c781bb6b8ec669b4a36385d2dace705abfb5ef07047dcad979b  apps/web/src/components/platform/OperationsIndexing.tsx
1061582a988e83818a9dc845c77ee647928f5410be3a7d54e09f71625f0a2336  apps/web/src/components/platform/OperationsBackground.tsx
c1d29beedc48b21c3e587e06112e15ff53b56cc2e026316ea8233f6a08915003  apps/web/src/components/platform/OperationsUploads.tsx
4f382ca7d46b00035bfb8162e7772aa201c818ea8f7096242bcdacdf09c581e6  apps/web/src/components/platform/OperationsBudgets.tsx
32f40fb14f6efbc5530e721ade55148e36447edee1a8889b2842b1e6cb67e9fa  apps/web/src/components/platform/OperationsRetention.tsx
4bb2327a69303e77314431e53051e3821db42f0aa78b50f2bb7d3e38c49a316f  apps/web/src/components/platform/OperationsObservability.tsx
fec4719fb9aa24363265b59c01d4d0fed7083ecb86910702181c7cb56545ce01  apps/web/src/lib/browser-operations.ts
2295ffda612b84548bc29d4d507249c0567c30454d2a938d96d5b0051165f0d0  apps/web/src/lib/browser-operation-budgets.ts
```
