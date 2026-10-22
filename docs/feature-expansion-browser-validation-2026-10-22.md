# Styled browser and local API validation — 2026-10-22

**Live execution and final narrow recheck complete. P3 mobile label defect CLEARED on the final build; no outstanding browser finding. This report records browser evidence, not deployment or combined-suite clearance.**

## Final build narrow recheck — PASS

The requested follow-up passed on the final local fixture. **P3 is CLEARED in the built application.** Earlier broad results below retain their original build attribution and limits; they were not rerun.

- Final web aggregate: `86d43c431846db0d653b2f110f6a7588dd6b3b91d409f9aea70b25adf80ed476`. All497 web-manifest files matched after the recheck. Wider518-artifact manifest SHA supplied by integration: `3cbb1690bea1e332987c947e5003132ae16e3414035d2951aa3f8f5d9a8f986f`.
- Served `app-BDRkd5p2.css`: HTTP200,93,811bytes, SHA256 `64347b350bb7ba87e5c1640de1f81c0b1b637670691db980fa2f29805319b417`. Budget source SHA256 matched `4f382ca7d46b00035bfb8162e7772aa201c818ea8f7096242bcdacdf09c581e6`.
- At390×844, both a normal label and a valid95-character label displayed **Remove from batch**:128px text inside188px button inside222px card. Exact accessible names retained `Remove <full label> from batch`. Document width remained390px. [Normal card](/home/nearby/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvk36pmd-3263a73e.png); [long-label removal control](/home/nearby/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvk36wep-02ed0ec8.png). Both screenshots visually inspected.
- Review two drafts → remove normal draft: one draft remained, review unchecked, save disabled. Review remaining long-label draft → remove: zero drafts, selection cleared, empty instruction shown, no budget mutation request. The missing long-label fixture was created through local `POST /api/v1/tokens`200 and revoked through `DELETE /api/v1/tokens/:id`200 afterward.
- Mobile command→Project JSON fields→example→preview→download: `record-project.json`, application/json,103bytes, exact9007199254740993 retained. Desktop1280×800 command→Summarize CSV groups→example→preview→download: `table-group.csv`, text/csv,74bytes with UTF8 BOM/CRLF and exact0.3 sum. Both transformation windows had zero requests. Actual downloaded binaries were copied before tab closure and their SHA256 matched the captured Blobs.
- Desktop Operations connect→bounded50-row token read and mobile reconnect→search policy read returned200/private-no-store, with one whoami per connection. No observed runtime errors or horizontal page overflow. [Mobile smoke](/home/nearby/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvk37ck3-b606dd8d.png); [desktop smoke](/home/nearby/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvk37ed6-19e88d1d.png); [mobile Operations](/home/nearby/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvk37qg9-564aaa4b.png).
- Evidence: [results.json](/home/nearby/.t3/userdata/tmp/agfs-final-browser-recheck-p588Hb/results.json), [integrity.json](/home/nearby/.t3/userdata/tmp/agfs-final-browser-recheck-p588Hb/integrity.json), [JSON download](/home/nearby/.t3/userdata/tmp/agfs-final-browser-recheck-p588Hb/record-project.json), [CSV download](/home/nearby/.t3/userdata/tmp/agfs-final-browser-recheck-p588Hb/table-group.csv).
- Used a fresh empty Incognito context with only the matching final synthetic owner cookie, personal namespace `feature-a9c2cf15-dd53-4ee7-8fe6-44ce5ef19698`. Owned tab `tab_1c_0d4a421e-6dbf-49b4-a1b6-cd5e2e690d68` closed; final T3 status showed no tabs. No user state changed and no fixture process was signaled. Root received PASS/tabs-closed handoff; integration owner3810097/PTY1186 retains shutdown authority.

No broader suite, device, security-matrix or maximum-input rerun was added. The responsive-browser and other previously documented limits remain. There are **no outstanding browser findings or requested browser rechecks** from this task.

Baseline HEAD: `9663bb0b0f778a933dc02028bf0ca3ddd27322a0`. Tested browser #71–87 and Operations integrations #88–104. The latter add no feature count. All results below are actual styled-browser/local HTTP observations unless explicitly marked as a limit.

## Environment and integrity

- Actual app/API: `http://localhost:8787/app`, real local Worker/D1/R2 fixture. Preview8788 and local CIMD8792 were integration-owned; no Queue worker. No production requests, external webhook delivery, application edits, builds, installs, nested agents, or commits by this agent.
- Web build hash: `cfd33ff1777c53591f1a55e711d9019c5cd143457a15fe5325987d78723d7223`.
- Served `/assets/app-uHtxr6xn.css`: HTTP200, 93,784 bytes, SHA256 `ab5c92b756fee834c72f43da8b16fd28fb5420d61f63f416a6a19a2dc130c4d6`; screenshots were visually inspected with the actual stylesheet.
- The supplied `built-assets.sha256.json` contains **497 web-dist entries**, all byte-identical at completion. Root's wider518-artifact inventory included separately authorized SDK/CLI refreshes; no claim that all518 stayed immutable.
- Fresh before/after hashes covered30 owned UI files. Only `OperationsBudgets.tsx` and the Operations report changed, as authorized for the P3 fix. All other UI files stayed unchanged; the served web build still contains the old label.
- Authentication used only private synthetic localhost fixture cookies. Owner personal namespace: `feature-f4f054a7-7656-4994-b695-1a0ca183ae12`. Viewer: separate synthetic `-other` identity, team `ws_b890f1885a9d27e751056575`. Owner and viewer each began in a fresh, empty Incognito context; owner context was closed before viewer opened. No human profile/cookies/tabs were altered.
- T3 collaborative browser only; initial status/open protocol followed. Measured CSS viewports1280×800,768×1024,390×844. These are responsive desktop-browser viewport checks, **not physical device tests or accessibility conformance certification**.
- Frontend-design and applicable React guidance were read/announced in Phase1. No speculative redesign was proposed.

Evidence directory: [live evidence](/home/nearby/.t3/userdata/tmp/agfs-styled-live-20261022-xwwmk5pd). Phase1 plan preserved as `phase1-plan.md`; earlier phase1 evidence remains at `/home/nearby/.t3/userdata/tmp/agfs-browser-validation-phase1-20261022-vwiwspdl`.

## Concrete finding

**P3 — budget draft removal label overflows at390px.** Operations → Resource controls → Budget planning → load token page → select an ordinary “Local budget34” row. The built “Remove Local budget34 from batch” text spans237.5px inside a188px button and crosses the222px draft card. [Screenshot](/home/nearby/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvk2evlp-22fd0a93.png).

Location: `apps/web/src/components/platform/OperationsBudgets.tsx:496`, originally the ghost Button at496–504; shared Button inherits `whitespace-nowrap` from `components/ui/button.tsx:7`. Root assigned the original owner. The owner changed visible text to **Remove from batch** with contextual `aria-label`; this agent did not edit it. **Final built verification passed**, as recorded above. No global Button/layout change was needed.

## All17 browser tools

Every row was reached through the actual command palette, selected the correct task/hash/group, loaded its example, generated the expected preview, and downloaded the real output. Each transformation observation window recorded **zero API requests**. Existing command search/auth/chunk loads were separated from transformations.

| # | Actual task | Observed result | Actual export |
| --- | --- | --- | --- |
| 71 | Project JSON fields | 3 records projected into 2 named fields. | `record-project.json` · application/json · 103 B |
| 72 | Deduplicate JSON records | 1 duplicates removed; 2 survivors retain source order and numeric literals. | `record-dedupe.json` · application/json · 90 B |
| 73 | Group JSON records | 3 records in 2 groups. First-seen key literals and group order are preserved. | `record-group.json` · application/json · 183 B |
| 74 | Sort JSON records | 3 records sorted. Equal keys keep source order; numbers are compared without rounding. | `record-sort.json` · application/json · 127 B |
| 75 | Index JSON records | 2 records indexed by unique string keys. | `record-index.json` · application/json · 68 B |
| 76 | Preview JSON Patch | 3 operations applied to the preview. Source unchanged. | `patched.json` · application/json · 39 B |
| 77 | Audit a record contract | 3 findings across 3 records. All findings included. | `record-audit.json` · application/json · 299 B |
| 78 | Sort CSV rows | 3 rows sorted; equal keys keep source order. CSV export protects spreadsheet formulas. | `table-sort.csv` · text/csv · 82 B |
| 79 | Deduplicate CSV rows | 1 duplicate rows removed; 2 survivors remain in source order. CSV export protects spreadsheet formulas. | `table-dedupe.csv` · text/csv · 63 B |
| 80 | Summarize CSV groups | 3 rows summarized into 2 groups with exact decimal sums. CSV export protects spreadsheet formulas. | `table-group.csv` · text/csv · 74 B |
| 81 | Reshape wide CSV to long | 2 wide rows become 4 field/value rows. CSV export protects spreadsheet formulas. | `table-unpivot.csv` · text/csv · 89 B |
| 82 | Append CSV by schema | 4 rows aligned by header name. Missing union columns become empty cells. CSV export protects spreadsheet formulas. | `table-append.csv` · text/csv · 101 B |
| 83 | Map CSV headers | 2 headers renamed. Row values are unchanged before CSV formula protection. CSV export protects spreadsheet formulas. | `table-rename.csv` · text/csv · 88 B |
| 84 | Reconcile CSV versions | 1 added · 1 removed · 1 changed. Row numbers count parsed records, including the header. | `table-reconciliation.json` · application/json · 472 B |
| 85 | Inventory Markdown links | 4 inline links/images listed · 0 unsupported candidates skipped. Targets are not fetched or opened; classifications are not a safety guarantee. | `markdown-links.json` · application/json · 428 B |
| 86 | Extract Markdown tasks | 3 tasks in the selected status. Line numbers refer to the source document. | `markdown-tasks.json` · application/json · 227 B |
| 87 | Redact literal text | 2 literal matches replaced. Only configured literals were checked; review all output before sharing. | `redacted.txt` · text/plain · 61 B |

`examples.json` retains full observed output and Blob MIME/text/size; `downloads.json` retains T3 completed-download filenames and sizes. `export-verification.json` confirms all17 captured Blob contents match complete output and all17 byte counts match the completed downloads; CSV exports include UTF8 BOM/CRLF. Output SHA256 values are recorded there. T3 removed temporary download files when the owner tab closed, so these are captured Blob/download observations, not retained post-close binary files. Clipboard read permission was denied; the native clipboard write completed successfully with exact61-byte redaction text and “Output copied” feedback.

Focused actual checks:
- Exact JSON integer9007199254740993 survived projection/sort; CSV group arithmetic produced0.3. Missing and explicit null differed: error, write-null, and omit policies produced their expected results.
- A101-finding audit displayed100 rows, then the reachable next-page control showed record101. Cells capped at300 characters plus ellipsis; visible output capped at16,000 characters; complete39,177-byte export retained all101 findings.
- Strict CSV rejected wrong row width. Formula-like and negative cells received apostrophe protection; quoted multiline text and exact large numerics survived. Reusing a protected negative as decimal input refused visibly and cleared stale output; replacing the example recovered.
- Markdown link inventory kept suspicious targets inert; no target was requested. Documents/redaction examples produced the expected tasks, headings, literal replacement counts and output.
- Command dialog Escape returned focus to Find a command at desktop/mobile; Tab remained inside the open dialog in the sampled sequence. Actual custom selectors, keyboard Enter navigation, disabled states and focusable error feedback were exercised. This was a spot check, not an exhaustive keyboard/screen-reader audit.
- No horizontal page overflow was measured at the three widths in captured states. Long paths/errors wrapped; table overflow stayed local. Mobile retention table horizontal scrolling exposed the right-hand expiry column and preserved reachable continuation controls. One budget label defect is recorded above.

## Browser → API → stored file

All paths below are under the synthetic owner root. UI source load used `GET /api/v1/platform/text?path=…`. Save used real `POST /api/v1/fs/upload-intents` with exact size/MIME and `ifMatch:null`, then `PUT /api/v1/fs/uploads/:id/blob`, then `POST /api/v1/fs/uploads/:id/commit`. Successful stages returned200.

| Group | Source → output | Actual persisted readback |
| --- | --- | --- |
| Records | `records.json` → `browser-loaded-records.json` | GET200; application/json;63bytes; two mapped records with0.1/0.2 unchanged. |
| Tables | `table.csv` → `browser-summary.csv` | GET200; text/csv;55bytes including BOM/CRLF; north/count2/sum0.3. |
| Documents | `handoff.md` → `browser-tasks.json` | GET200; application/json;160bytes; source-line2 open and line3 complete tasks. |

Duplicate destination creation returned409; explicit readback showed original bytes unchanged. A different destination then committed successfully. An initial read attempted before commit completed returned404; this was test timing, followed by successful readback, not a product defect.

A real upload-intent response was held before delivery to the UI: source/task/example/options/create/copy controls stayed locked; disclosure close/reopen preserved pending state; release completed upload/commit. Download remained available. A real source GET was held, canceled, then released after source editing; the late response did not overwrite the newer state.

## All17 Operations integrations

Routes below are relative to `/api/v1/platform/operations`, except where marked. The sanitized owner ledger contains102 observed requests, including explicit test readbacks, fixture conflict actions and existing health/snapshot reads;51 target Operations routes. These counts are not independent test counts.

Connect issued one `GET /api/v1/whoami`; opening all six groups added no feature endpoint requests. Operation requests pinned the personal workspace. UI mutations rechecked identity. Path-sensitive read POSTs had no extra identity preflight. No polling, automatic page drain, per-row request fanout, or automatic retry was observed in the exercised flow. Captured operation responses used `private, no-store`.

| # | Actual UI/API case | Observed response and state |
| --- | --- | --- |
|88| GET/PUT `/search-policy` |200; content1048576 changed to metadata2048; explicit GET confirmed revision212/settings. UI explains reindex requirement. |
|89| POST `/index`, failed filter |200; first50 candidates yielded zero matches plus real cursor; continuation inspected3 and found candidate051. Empty page retained continuation. |
|90| POST `/reindex` dry-run/apply |200 previews50 then3; expiry approximately300seconds. Second-page apply retained original input cursor/path/failedOnly. Real policy change caused409; review consumed, no automatic retry. Explicit re-preview/apply200 enqueued3; subsequent health showed candidate051 pending/attempts0. Signed review value was redacted, not independently compared byte-for-byte. |
|91| GET/PUT `/background` |200; indexing pause toggled off; explicit GET confirmed false; restored indexing/webhook paused. Queued work remained. |
|92| GET `/failures`; POST `/failures/retry` |200 mixed outcomes: selected index job retried, disabled webhook unavailable. Explicit inbox reload retained only webhook failure. |
|93| GET `/maintenance` |200; indexing pendingAtLeast50/dueAtLeast50 with hasMore. UI says lower bound; no exact count/CPU/billing promise. No worker processing claim. |
|94| POST `/uploads` |200; active filter first50 candidates empty with cursor, next13 returned direct pending, multipart pending and multipart completing. Direct uploaded bytes correctly unknown; multipart progress27/30bytes. |
|95| POST `/uploads/abandon` |Dry-run identified two eligible pending IDs; completing ID was ineligible. Integration-provided recipe completed pending multipart through real HTTP200. UI apply submitted only two reviewed eligible IDs: direct abandoned, raced multipart not-pending. Explicit expired inventory showed direct reserved0. Review consumed. |
|96| GET `/budgets/history` |Known nonsecret token ID loaded nonempty UTC history200 without token-list fanout: three seeded dates, operations12/11/13 and upload3072/2048/1024bytes. |
|97| POST `/budgets/preflight` |200 allowed for unlimited fixture token;200 denied uploadBytes for a zero-upload-limit token. UI displayed used/remaining/reset and advisory/no-reservation semantics. No separate before/after reservation-state measurement. |
|98| GET `/budgets/tokens`; PUT `/budgets/batch` |50-row page replaced by2-row page;19 drafts survived pagination; twentieth selected, twenty-first refused locally. Editing/reloading invalidated review; batch200 updated20 selected IDs. Reload confirmed first token storage4097/upload0/operationsnull. Authentication token was excluded. P3 mobile label only. |
|99| GET `/metrics?hours=24&bucketMinutes=60` |200;24 buckets with zero intervals and nonempty counts/errors/rejections/elapsed latency.168hours×5minute selection failed locally with zero requests. |
|100| PUT/DELETE `/alerts/:id/acknowledge` |200; native health refresh persisted note, actor and acknowledgement, then clear. Held real response plus hide/show filter retained disabled controls; exactly one acknowledgement write and one resulting health refresh. |
|101| PUT `/alerts/:id/snooze` |200 for60minutes; health showed visible0/future expiry. Explicit zero unsnoozed; acknowledgement cleared separately. Underlying unresolved condition remained distinct. |
|102| POST `/retention/references` |200 pages1/44/11 results: live/run/snapshot/pin/version, with expired candidates skipped. Real cursors; no object keys exposed. Canceled held response ignored after path edit; only read POST, no identity preflight. |
|103| GET `/retention/expiring?days=30` |200 pages50+7; fixed continuation window and pin/snapshot/run kinds. UI explicitly says referenced bytes are not guaranteed freed bytes. |
|104| Platform GET `/webhooks`, `/webhooks/:id/deliveries`; POST `/webhooks/cleanup` |Disabled endpoint selected; one failed terminal delivery. Dry-run200 eligible1/payload15bytes. Agreed competing real cleanup deleted it; UI apply used reviewed ID and returned200 eligible0/deleted0. Explicit history reload returned empty. No webhook delivery occurred. Positive deletion was the competing HTTP recipe, not a positive UI deletion case. |

Namespace refusal: while owner controls were bound personal, the normal local workspace-selection API changed current scope to team. Attempted Save search policy issued only fresh whoami, then showed **Account or workspace changed. Reconnect controls and review the selected scope again.** Controls disconnected and no policy PUT occurred. Personal scope was restored.

Permission case: a second fresh Incognito context authenticated only the synthetic viewer and selected its agreed team. Connect succeeded; policy GET returned403/private-no-store. UI clearly stated **Owner/manage permission is required** and exposed no save form. This verifies a distinct viewer context and changed-workspace refusal; a mid-flight cookie actor swap was not separately tested.

## Screenshots and evidence

All captures in this list were visually inspected; the full screenshot index is `screenshots.json` in the evidence directory.

- [Desktop Records](/home/nearby/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvk25w0n-bf8c45d0.png), [desktop Tables](/home/nearby/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvk269e0-8961b39b.png), [desktop Documents](/home/nearby/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvk26byw-5c7901a4.png).
- [Mobile command dialog](/home/nearby/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvk28wgn-9a126816.png), [mobile101-findings report](/home/nearby/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvk28vtv-6ae877c5.png), [mobile CSV error](/home/nearby/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvk297ti-fc0e700e.png), [mobile Documents](/home/nearby/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvk26pwa-80a0a8b3.png).
- [Mobile pending save](/home/nearby/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvk275a8-667be26a.png), [tablet save conflict](/home/nearby/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvk27igq-51c13746.png), [desktop stale reindex409](/home/nearby/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvk2au3b-b31f5a76.png).
- [Tablet budget drafts](/home/nearby/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvk2em07-d076aaed.png), [mobile budget defect](/home/nearby/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvk2evlp-22fd0a93.png), [mobile alert state](/home/nearby/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvk2iyso-49f1ece7.png), [mobile retention horizontal scroll](/home/nearby/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvk2kjya-2674a0f7.png), [mobile viewer permission](/home/nearby/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvk2m9tm-4d843c3d.png).
- Twelve additional desktop/tablet/mobile Operations group captures with measured viewport/document widths are indexed in `screenshots.json`; they show indexing/background/uploads/retention/metrics layouts. No page-level overflow in those measurements.
- `owner-ledger.json`: selected request/response/body fields with credentials/review tokens redacted. `viewer-ledger.json`: whoami and permission denial. `save-readbacks.json`, `examples.json`, `export-verification.json`, `served-css.json`, `ui-before.json`, `ui-after.json`, `integrity.json` provide focused evidence. Raw credentials and raw request headers are not published.

## Limits and final-build handoff

Not run here: full security/HMAC/replay matrix or five-minute expiry wait; combined maximum-length Unicode path with a real generated cursor; every optional filter/empty state; every task-specific edge case from Phase1; browser back/forward re-selection; all pending/sending webhook variants (fixture had one failed terminal); all MIME save variants (JSON/CSV saved, plain-text downloaded, existing Markdown-producing caller not saved); physical devices, exhaustive keyboard/contrast/accessibility certification, or heavy limit/load tests. Earlier mocked/unit/integration checks remain separate evidence and are not relabeled as live UI passes. Real-response holds delayed delivery after HTTP completion; they do not prove canceled server work.

Root's pending server cost/SDK source fixes were not in this web artifact. This report does not claim current-source whole-system integration. No new broad mock coverage was run.

**Previously requested final-build follow-up is complete:** normal/long-label removal, new hashes, desktop/mobile command/download and Operations bounded-read smoke all passed. See the final recheck above.

Owned owner tab `tab_15_0d4a421e-6dbf-49b4-a1b6-cd5e2e690d68` and viewer tab `tab_1a_0d4a421e-6dbf-49b4-a1b6-cd5e2e690d68` are closed. Final T3 status had no tab. No test-owned processes exist. Integration owner retains fixture/processes (owner3625023, PTY37509; guardian3626643/3626768/3626769; Wranglers3626652/3626775/3626774); none were signaled. Root was sent completion/fixture-restart handoff. Final refresh/retest/release remains root/integration-owned.
