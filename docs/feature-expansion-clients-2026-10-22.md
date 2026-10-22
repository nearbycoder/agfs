# Client feature expansion — October 22, 2026

Baseline: `9663bb0b0f778a933dc02028bf0ca3ddd27322a0` (PR 81). This allocation implements exactly **16 new workflows, #105–120**. Existing lazy mapping, streaming/resumable uploads, atomic downloads, sync/watch, search pagination, direct run/draft APIs, range-download protocol and all prior performance improvements are reused, not recounted. Language ports, tests, documentation and security hardening do not add feature count.

No server endpoint, protocol, dependency, manifest or lockfile change is required by this allocation. No commit, push, deployment, publication, remote mutation, production fixture or stored credential read was performed. Shared build outputs were not generated; package artifact checks emitted only to `/tmp`.

## Feature and availability matrix

“Via” identifies a user-visible CLI workflow that uses the capability, rather than a second counted port. A dash means this phase does not expose that capability in that interface.

| # | Distinct new capability and acceptance behavior | TypeScript SDK | CLI | Python |
| --- | --- | --- | --- | --- |
| 105 | Bounded, pull-driven subtree traversal with pruning, depth/entry/folder ceilings and descendant validation. Early return does not request the next folder. | `walk`, `WalkOptions` | Via `inventory capture` limits | — |
| 106 | Portable scoped metadata inventory; deterministic ordering, versioned schema, sanitized entries and metadata ceiling; no file-content downloads. | `captureInventory`, `validateInventory`, `Inventory` | `inventory capture` | — |
| 107 | Offline inventory comparison distinguishes added, removed, changed and unchanged paths and rejects different scopes. | `compareInventories`, `InventoryDifference` | `inventory diff` | — |
| 108 | Restartable manifest-selected backup with conditional GETs, atomic create-only content installation and checkpoint/local-content revalidation. | — | `export` | — |
| 109 | Conditional cross-client copy with separate credentials, pinned source version, create-only destination default and direct streaming. | `copyFile` | — | — |
| 110 | Resumable strict UTF-8 line ingestion with exact complete-line byte checkpoints, ETag binding and LF boundary verification. | `readLines`, `LineCheckpoint`, `LineOptions`, `TextLine` | `lines` | `read_lines` |
| 111 | Bounded streaming JSONL ingestion with record validation, precise error lines, backpressure and record checkpoints. | `readJsonLines`, `JsonLineError` | `records` | `read_json_lines` |
| 112 | Content-aware text publication skips identical files and conditionally creates/replaces changed content. | `publishText`, `PublishResult` | `text publish` | — |
| 113 | Optimistic JSON transformations and RFC 7396 merge patches, with exact null behavior, loss-prone-value rejection and no callback retry after conflicts. | `transformJson`, `mergeJsonPatch`, `JsonValue` | `json patch` | — |
| 114 | Finite, resumable change windows with scope-bound durable checkpoints, fixed `through`, explicit limits and no polling/full-scan fallback. | `changeBatches`, `ChangeCheckpoint`, `ChangeBatch` | `changes` | — |
| 115 | Operation-lifetime request-attempt budgets and deadlines with cancellation, owned-reader cleanup and closed-scope enforcement. | `AgfsClient.withScope`, `signal` | Automation `--max-requests`, `--timeout-ms`, Ctrl+C | — |
| 116 | Machine-readable actionable failures with stable categories/status/retryability, exit codes and partial-workflow recovery identifiers. | `diagnoseError`, `ErrorDiagnostic`, error classes | `--json-errors` on stderr; data on stdout | `diagnose_error`, error classes |
| 117 | Offline exact-body webhook HMAC verification supporting the actual rotating two-signature protocol and bounded replay/header/body inputs. | `verifyWebhook` | — | `verify_webhook` |
| 118 | Declarative draft batch staging validates every operation before creation, stages sequentially and exposes partial recovery state without approving/applying. | `stageDraft`, `validateDraftBatch`, `DraftBatch` | `draft stage` | `stage_draft` |
| 119 | Managed run execution invokes work once, completes only after success and preserves run ID/original cause on failure. | `withRun`, `WorkflowError` | — | `with_run`, `WorkflowError` |
| 120 | Explicit resumable upload bundles with local-only dry-run, source fingerprinting, complete destination preflight, per-file conditions and checkpoint revalidation. | Uses existing upload API plus `verifySource` commit guard; no standalone bundle API | `bundle upload`, `--dry-run` | — |

All public TypeScript functions/types are reachable through `src/index.ts` and the emitted package entry/declarations. Python functions are explicitly imported by `agfs_sdk/__init__.py`; normal setuptools package discovery includes the new module. CLI registration is wired into the existing entrypoint. READMEs and command help contain examples and limits.

## Resource bounds and evidence

These are explicit caps and deterministic local request/operation observations. They are **not measured production Worker CPU, RSS, billing, latency or database-row reductions**.

- Discovery uses one sequential scoped folder request per visited folder: defaults 1,000 folders, 10,000 observed entries, depth 16; one listing body is capped at 2 MiB. Entries are sanitized to documented fields before retention. Inventory capture additionally caps compact serialized metadata at 8 MiB. The existing server still executes its normal per-folder query; cancelling the client body cannot undo a query already executed. There is no new server-wide scan.
- Inventory comparison makes zero requests and costs `O(N log N)` ordering plus `O(N)` maps, bounded by the input's 10,000 entries. CLI inventory inputs/checkpoints are capped at 8 MiB. Depth limits deliberately produce partial inventories; capture is not an atomic namespace snapshot.
- Export defaults to 1 GiB total declared content (maximum 20 GiB), processes files sequentially, and never retains whole file contents. Each safely skipped file is rehashed locally. A two-file interrupted fixture resumes with exactly one remaining GET and one skipped local file. Changed local bytes produce a conflict with zero content requests. ETags pin every download. SHA-256 is calculated while writing, and checkpoint size is capped at 8 MiB.
- Copy does one source parent listing and one conditional download, followed by the existing destination resumable sequence. A four-byte fixture performs exactly two source requests and three destination requests; exceeding the source byte ceiling stops after the list. Destination credentials never appear on the source transport or vice versa. Memory inherits the documented one-owned-part `uploadStream` behavior, plus producer/runtime/transport buffers.
- Line/JSONL ingestion makes one bounded parent listing and one range GET. Default requested range is 8 MiB, default line buffer 64 KiB; resume requests at most one additional preceding byte. Maximum range is 1 GiB, line buffer 1 MiB; line/record limits are explicit. TypeScript retains its bounded line buffer plus the current transport chunk; Python retains its line buffer plus one 64 KiB read. Final unterminated lines and bare final CR are preserved. Producer/runtime queues are outside these owned-buffer bounds.
- Text/JSON operations default to 1 MiB input/result (maximum 8 MiB). They do one parent list and at most one bounded GET before deciding whether to upload. Identical text/JSON fixtures perform zero upload requests. Bounds apply to document content, not total process RSS; decoding, parsing and serialization create additional bounded representations.
- Change windows add one identity request and then at most `maxPages` sequential pages (default 100), each with at most 500 rows and an 8 MiB response cap. Resume fixes the original `through` until the window completes. Expired checkpoints surface 410; no hidden history scan/polling occurs.
- Scopes default to 100 actual transport attempts and 30 seconds, maximum 10,000 and one hour. Retry attempts and empty-upload capability PUTs consume that same budget exactly once. A controlled transient-failure test observes exactly two transport calls at budget two; a completing zero-byte upload is prevented from making a third commit call at budget two. Nested scopes cannot escape an outer budget. Pre-aborted/exhausted/closed clients make zero additional transport calls. Owned timers/listeners/readers are cleaned on completion/abort/deadline; controlled tests observe zero remaining timers and no parent abort listeners.
- Scopes accept only static/resolved tokens. Opaque token callbacks are rejected before work because caller-owned OAuth refresh calls cannot honestly be counted by this SDK's transport wrapper. Resolve OAuth before the scope; those external requests are outside its budget. Retained clients/iterators do not extend scope lifetime. Arbitrary user callbacks and transports must cooperate with cancellation; the scope cannot forcibly terminate caller-owned computation.
- Webhook verification makes zero requests and hashes at most 1 MiB by default (maximum 8 MiB). Timestamp tolerance is ±300 seconds by default, at most 3,600. Headers allow at most two fixed-size `v1` signatures and 160 characters. TS WebCrypto verification/Python `hmac.compare_digest` check all candidates without a secret-dependent string comparison. Event-ID deduplication remains the consumer's job.
- Draft staging uses one create request plus at most 30 sequential writes. All operations are validated first. Run execution uses exactly one start plus one completion after successful work. Neither workflow retries a non-idempotent create or polls status; errors expose the created ID for inspection.
- Bundles accept at most 1,000 explicit source files, default 1 GiB total (maximum 20 GiB), one bounded list per explicit destination parent, then sequential existing 8 MiB multipart uploads. Local source hashing uses 256 KiB stream reads and content revalidation immediately before commit. Dry-run performs zero auth/network requests and writes no job state. A two-file interrupted fixture resumes with one upload and one skip after one parent listing per invocation. Destination changes cause a conflict before any upload. Fresh conditional state conflicts, including explicitly abandoned uploads, surface without retrying them as unconditional writes.
- Bundle preflight retains one bounded parent listing plus metadata for at most 1,000 selected destinations, instead of retaining all unrelated entries across parents. A four-parent fixture parses 5,001 entries per parent (20,004 total). Weak references and isolated V8 GC observe **zero objects from each prior listing** at the next-parent boundary; all four parents are still checked before the first upload. This measures object reachability, not RSS, cloud CPU or database-query reduction.
- Completing upload sessions now reread/hash every source part sequentially and compare all server digests before commit. Missing/different digests fail with 409 and no PUT/commit. This adds bounded local CPU/read work to completing resumes; it does not add requests or claim to reduce cloud cost. The prior one-owned-part stream reachability test still passes for both pending and completing sessions.
- Scoped workflow journals retain only acknowledged IDs and confirmed change counts; each new resource consumes a request attempt, so journal size is bounded by the scope budget. Successful records are removed and scope exit clears the journal. Cancellation returns recovery information without waiting for an uncooperative callback.
- Line-checkpoint validation copies six primitive fields before any request and adds no remote operations. Malformed/missing fields cost zero transport attempts. Nested error diagnostics use iterative cycle detection and local maps, proportional to the caller-supplied cause chain and recovery records; they do not add retries or requests. Tests with 10,000 wrappers establish nonrecursive termination, not a total process-memory or CPU bound.
- Upload part retention, version retention, reservations, database authorization and quota behavior remain those of existing endpoints. An interrupted upload can retain staged parts until normal cleanup; newly committed versions consume ordinary retention/storage allowances. No new paid service or background job was introduced.

## Filesystem support and recovery limits

New durable CLI jobs require Linux with `/proc/self/fd` and `O_NOFOLLOW`. Inventory capture/export/bundle check support before authentication/network work or output creation. `UnsupportedPlatformError` maps to category `unsupported_platform`, exit 9, and suggests the portable SDK or offline comparison. Permission-denial errors retain their cause. `inventory diff` uses portable read-only bounded regular-file reads and does not require `/proc`; remote line/record/change consumption without local checkpoint input also remains portable. Protected local checkpoint/document readers currently require Linux.

Durable traversal opens directory descriptors one segment at a time, refuses parent traversal/symlinks/special files, creates private staging directories and verifies ownership/permissions plus staged inode identity. Checkpoints use atomic rename without truncating another hard link. Export content uses atomic create-only hard-link installation, preserving even a destination created at the install step; the destination filesystem must support hard links, and filesystem denial fails safely without replacement. A substituted destination parent cannot redirect a write into a foreign directory: the held original directory receives it. A substituted staging file or parent directory is refused. Cleanup verifies the owned content inode/device and preserves detected foreign regular/symlink replacements and their parent entries. These checks are not an isolation boundary against processes with the same UID/full authority. Atomic visibility does not provide fsync durability.

Checkpoints bind origin/account/workspace and the exact manifest. Bundle binding additionally includes source hashes and conditions. Completed flags alone are never sufficient: backup skips require local SHA/size agreement, and bundle skips require current local SHA/size plus remote ETag agreement. Unknown/malformed completion entries fail before mutations. Checkpoints are local operational records, not cryptographically authenticated attestations against a malicious local owner.

Checkpoints and individual content commits are separate atomic actions, not a multi-file transaction. A crash after local installation but before checkpoint persistence leaves an untracked destination; resume refuses to overwrite it. A crash/lost response after remote bundle commit but before checkpoint persistence similarly produces a conditional conflict. Inspect the specific file/version and make an explicit recovery decision. Existing data is preserved. Locks prevent concurrent jobs; forced-process termination may leave a lock that must be removed only after confirming no job remains active.

## Verification

At the final R2 correction checkpoint (all affected package tests and typechecks rerun):

- SDK package: **169 tests** in seven files, including 18 initial automation tests, **85 R1 regression cases** and **31 R2 regression cases**, pass.
- CLI package: **71 tests** in 11 files, including 18 initial automation/adversarial tests and **12 R1 regression cases**, pass.
- Python package: **44 tests**, including **7 initial automation tests** and **10 R2 regression methods** with parameterized subcases, pass.
- Total: **284 tests**, including 43 initial new tests, 97 R1 regression cases and 41 R2 regression cases/methods. The remaining 103 preserve affected baseline transfer, security, OAuth, concurrency and sync behavior; none counts as a new feature. Both independent suites pass: original R1 **26/26** (20 TypeScript, six Python), and R2 **62/62** (56 TypeScript, six Python). All nine R2 failures were reproduced before correction (four TypeScript, five Python).
- SDK `tsc --noEmit` and CLI source-aliased `tsc --noEmit` pass.
- Fresh SDK declarations/JS and CLI output were emitted once into separate package directories below `/tmp/agfs-clients-r2-fixed-20261022-rveabgsv`, using current SDK source aliases for the CLI. The entire artifact directory was verified symlink-free before and after emission and execution; no runtime dependency links were created.
- Runtime checks find all 32 public exports from the four automation modules through the emitted package entry plus `AgfsClient.withScope`; emitted scoped run recovery also passes. A standalone TypeScript consumer successfully imports all **14** new named types (including `WorkflowResource`) from the emitted declarations and resolves scope/upload/recovery option types. The internal workflow journal is included through ordinary transitive compilation.
- Actual CLI executable top-level help and all ten new command help routes succeed, including platform support descriptions. Unknown-option `--json-errors` exits 2 with one JSON stderr record and empty stdout. Actual bundle dry-run emits a valid seven-byte local plan with networking explicitly disabled and no local job-state writes. A temporary Node resolution hook supplies installed external dependencies to the output outside the repository; it does not change the artifact or package source.
- Scoped whitespace check passes. No shared web build/dev server was started.

Adversarial coverage includes malformed/escaped listings, inventory scope mismatches, changed source/destination ETags, early iterator close, one-byte UTF-8 chunks, forged line offsets, invalid UTF-8, bare CR, ignored/truncated ranges, non-finite JSON, cursor loops, expired history, request budgets including retries/capabilities, nested scopes, external custom abort reasons, deadline body cancellation, key rotation/stale/forged webhooks, invalid-last-operation draft preflight, partial draft/run failures, missing `/proc`, unsupported OS, permission denial, symlinks/traversal/hard links, destination-parent replacement, staging content/directory substitution, exclusive-create collisions, untrusted checkpoint fields and failure after rename before checkpoint persistence. R2 adds every missing line-checkpoint field, wrong types/ranges/invariants, accessors/subclasses and mutation during metadata awaits; EOF revalidation; six nested workflows with all recovery IDs; 10,000 cause wrappers and cycles; Ctrl+C after creation/partial progress/completion failure; native `SystemExit` identity/code propagation; and programming-error classification.

Commands (from the repository root):

```sh
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/sdk exec vitest run --maxWorkers=1
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/cli exec vitest run --maxWorkers=1
PYTHONPATH=packages/python-sdk python3 -m unittest discover -s packages/python-sdk/tests
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/sdk typecheck
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/cli exec tsc --noEmit -p /tmp/agfs-clients-typecheck-20261022.json
```

The temporary CLI typecheck config extends the package config and resolves `@agfs/sdk` to current source while preserving existing contract/database aliases and the repository Node type root. This avoids stale package output or mutation of shared build artifacts. Artifact emission uses the normal package compilers with only temporary output directories/source aliasing; these are verification artifacts, not published packages.

### Local artifact-cleanup incident and exact source recovery

After all 146 tests passed against the hashes below, repeating a temporary CLI artifact build exposed `tsup` cleanup following a runtime dependency symlink inside the output directory. The output's `node_modules` link pointed at the CLI dependency directory, which in turn linked workspace SDK/contracts and shared dependency packages. Cleanup deleted SDK/contracts source and affected dependency contents. No remote operation occurred. This incident and its fixes add **zero features**.

The temporary symlink was verified and unlinked without recursive deletion. SDK recovery extracted this thread's 17 exact SDK-only patch calls, replayed them on baseline in a disposable symlink-free directory, and verified all five saved SDK production hashes before copying back. All 16 SDK source/test/README/config files were recovered; all 12 saved client production hashes match. Contracts recovery belongs exclusively to the server agent after an initial missing-tracked-file baseline restoration; the parent coordinated its concurrent `operations.ts`/export restoration. CLI/Python source and emitted SDK JS/declarations remained intact.

The command that exposed the cleanup traversal was:

```sh
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/cli exec tsup --out-dir /tmp/agfs-feature-clients-cli-20261022 --tsconfig /tmp/agfs-clients-typecheck-20261022.json
```

Recovery evidence is preserved at `/tmp/agfs-sdk-exact-recovery-patches.json`, `/tmp/agfs-sdk-recovery-inventory-20261022.json`, and `/tmp/agfs-feature-clients-production-20261022.json`; the symlink-free replay directory is recorded in the inventory. The original full 20-file inventory and pre-repair source tar remain preserved separately. Server recovery replayed its exact three contracts patches and confirmed six restored files; its inventory is `/home/nearby/.t3/userdata/tmp/agfs-contracts-exact-recovery-9cf7c59z/recovered-inventory.json`.

After explicit coordinated repair readiness, `npm exec --yes --package=pnpm@10.34.7 -- pnpm install --force --frozen-lockfile` successfully replaced dependency contents (456 packages added, with no store cleanup or version changes). Actual imports and representative functions/version checks passed for Commander 15.0.0, Zod 4.6.7, mime-types 3.0.2, tsup 9.0.0, TypeScript 7.0.2 and Vitest 5.0.5. Package executable files were inspected and `tsup`, `tsc` and `vitest --version` executed successfully. All five workspace dependency links resolved correctly. `/tmp/agfs-client-dependency-import-verification-20261022.json` records resolved paths, versions and executable-content hashes.

All 12 client production hashes, all 20 then-current owned file hashes, all six recovered contracts hashes and all 11 saved manifest/lock/workspace hashes matched after installation. The 146 package tests and both typechecks were then rerun successfully, followed by the fresh artifact checks above. Final metadata is `/tmp/agfs-clients-postrepair-artifacts-20261022.json`; its directory preserves build logs and runtime/declaration check results. The final 20-file inventory is `/tmp/agfs-feature-clients-all-files-postrepair-20261022.json`, with a matching source snapshot at `/tmp/agfs-client-settled-source-postrepair-20261022.tar`.

Fresh artifact directories must remain symlink-free while a clean-enabled build can run. Never repeat a clean-enabled build after adding runtime dependency links. The recovery artifacts and original production hashes remain preserved; R1 corrections intentionally supersede that production snapshot with the hashes below.

### Independent review R1 corrections (uncounted)

The R1 corrections addressed all ten reported reproductions. R2 cleared both P1s and nine of ten findings, identifying a deeper nested-diagnostic gap in R1 #5; the R2 corrections below now address it. All corrections add zero workflows; the allocation remains exactly #105–120. Evidence was read from `/home/nearby/.t3/userdata/tmp/agfs-client-independent-review-rpd_wp43`. Its original 20-case TypeScript suite reproduced 11 failures; the same suite now passes all 20 cases. Two permanent regression files add 97 cases. Three existing test fixtures now supply valid completing-session digests so their original memory/length/source-guard assertions remain meaningful.

| R1 | Correction and permanent evidence |
| --- | --- |
| 1, P1 | Every part of a completing upload is verified before commit. Byte/Blob/file/stream, pending/completing, same first part with different final byte, missing digests, exact chunk/length boundaries, lost completion, bundle checkpoint refusal and streaming copy are covered. No blind replacement follows ambiguity. |
| 2, P1 | Export uses atomic create-only installation. Tests create foreign content during download and immediately inside the install call; both survive with conflict, no checkpoint and safe subsequent resume. |
| 3 | Checkpoint required fields/types/cursor invariants and known origin/path bindings are checked before any transport. Account/workspace identity is checked after the necessary identity request. Partial checkpoints never become fresh captures. |
| 4 | Cleanup checks staged content inode/device before unlinking. Foreign regular files, symlinks and substituted parent entries survive detected substitution. |
| 5 | A bounded scope journal preserves known draft/run IDs and confirmed progress across budget/deadline/external-abort races, with original causes/categories. Concurrent and nested workflows, failed completion, completed-record removal and uncooperative callbacks are covered; timers/listeners are released. |
| 6 | Ancestor checks traverse actual separators. ASCII/Unicode prefix siblings succeed; true shallow/deep file ancestors fail before local mutation. |
| 7 | Line and JSONL iterators check cancellation before processing/emitting and after yield resumption. Buffered normal/empty/final lines, expiry and consumer break are covered. |
| 8 | Traversal state is separate from prune/consumer snapshots, with a root check before each request. Mutation cannot request `/outside`; capture retains valid original paths. |
| 9 | Listings, inventories and change pages enforce complete entry metadata and retain documented fields only. Accessors are refused without invocation; valid nullable folder fields remain accepted. Existing numeric change-log timestamps are normalized to ISO strings, preserving the actual protocol. |
| 10 | Parent listings are discarded before the next parent; only selected destination metadata survives. The reachability fixture above observes zero prior-listing objects while preserving preflight-before-upload and detecting last-parent conflicts. |

R1 verification logs, command records and emitted artifact checks are preserved below `/tmp/agfs-clients-r1-fixed-20261022-gw3yjtzp`; metadata is `/tmp/agfs-clients-r1-artifacts-20261022.json`. Final production hashes, all 25 owned file hashes and the regular-file source snapshot are `/tmp/agfs-feature-clients-production-r1-20261022.json`, `/tmp/agfs-feature-clients-all-files-r1-20261022.json` and `/tmp/agfs-client-settled-source-r1-20261022.tar`. The original recovery evidence is preserved separately. All 11 manifest/lock/workspace hashes remain unchanged.

### Independent review R2 corrections (uncounted)

The independent R2 review evidence remains at `/home/nearby/.t3/userdata/tmp/agfs-client-review-r2-cljc68s0/review-summary.json`. Its nine failing checks were reproduced before editing; all 62 checks now pass. These are corrections to the same 16 workflows, with no new endpoints, dependencies, feature counts, or remote work.

| R2 | Correction and permanent evidence |
| --- | --- |
| 1 | TS/Python line and JSONL resume requires every emitted field before transport: `version`, `origin`, `path`, `etag`, `offset`, `line`. Validated primitive snapshots prevent mutation across metadata awaits. Missing offset/line cannot replay or renumber records; invalid types, bounds, zero/count invariants and accessors/subclasses fail with zero requests. Fresh calls retain their defaults; valid EOF resumes perform only metadata revalidation. |
| 2 | Iterative cause traversal replaces the four-wrapper cutoff. Cycle detection prevents infinite traversal; nested helper failures retain every acknowledged ID and maximum confirmed progress per ID, plus the underlying conflict/budget/deadline/cancellation classification. A meaningful non-workflow error terminates classification so caller-owned abort reasons cannot override cancellation. Tests cover six actual nested runs, shared-budget exhaustion, 10,000 wrappers, cyclic causes and dynamic TS cause getters. Scope lifetime/cleanup behavior is unchanged. |
| 3 | Python `KeyboardInterrupt` after acknowledged creation is retained as the original cause of `WorkflowError`, diagnosed as cancellation/130 with IDs and confirmed counts, including nested runs/drafts and completion failures. Callers should honor exit 130 or re-raise the original interrupt after saving recovery data. `SystemExit` is re-raised as the same native exception/code, annotated with recovery data; diagnostics report `terminated` and Python's normal exit-code mapping. Ordinary programming errors keep their classification; `GeneratorExit` is not wrapped. No callback is retried and unknown creation IDs are not invented. |

There are 31 permanent TS regression cases and ten Python test methods with additional subcases for R2. Production edits are limited to four SDK modules (`automation-core.ts`, `automation.ts`, `lines.ts`, `workflow-state.ts`) and Python `automation.py`: **five production files total**; CLI source remains identical to R1. Public `WorkflowResource.kind` is optional for manually constructed errors with only an ID/count; helpers always supply the known kind. The current total remains 13 production files in the original client allocation.

R2 verification logs, reproducible artifact-check scripts, commands and final summary are below `/tmp/agfs-clients-r2-fixed-20261022-rveabgsv`; artifact metadata is `/tmp/agfs-clients-r2-artifacts-20261022.json`. Current production hashes, all 25 owned file hashes and regular-file source archive are `/tmp/agfs-feature-clients-production-r2-20261022.json`, `/tmp/agfs-feature-clients-all-files-r2-20261022.json`, and `/tmp/agfs-client-settled-source-r2-20261022.tar`. All prior recovery and R1 artifacts remain preserved. All 11 manifest/lock/workspace hashes remain unchanged. No installs, shared full builds, output dependency links, commits or remote actions occurred during R2 remediation. This handoff is ready for a new independent R3 review; it does not claim that R3 has passed.

## Owned file inventory

- Production TS SDK: `packages/sdk/src/index.ts`, new `automation-core.ts`, `inventory.ts`, `lines.ts`, `automation.ts`, internal `workflow-state.ts`.
- Production CLI: `packages/cli/src/index.ts`, `src/lib/client.ts`, new `src/commands/automation.ts`, `src/lib/automation-io.ts`, `src/lib/transfer-jobs.ts`.
- Production Python: `packages/python-sdk/agfs_sdk/__init__.py`, new `automation.py`.
- New tests: `packages/sdk/src/automation.test.ts`, `review-regressions.test.ts`; `packages/cli/src/lib/automation.test.ts`, `automation-adversarial.test.ts`, `review-regressions.test.ts`; `packages/python-sdk/tests/test_automation.py`. Updated existing SDK fixtures: `packages/sdk/src/stream-memory.test.ts`, `stream-performance.test.ts`.
- Documentation: `packages/sdk/README.md`, `packages/cli/README.md`, `packages/python-sdk/README.md`, this report.

Exactly **25 owned files** are changed/new: **13 production**, **eight test files**, **four documentation files**. Other agents own every server/browser change. Source hashes below identify the settled R2 production snapshot, independently of shared-checkout changes.

## Settled production SHA-256

| File | SHA-256 |
| --- | --- |
| `packages/sdk/src/index.ts` | `b16aa4af2eafd9d423dfc84516708808e65d3cd6b2d6d96713f771f20ad4b17a` |
| `packages/sdk/src/automation-core.ts` | `68e779c08fdf53d8db927773abb00d8a124fdc169adfe4874bae83b037786279` |
| `packages/sdk/src/inventory.ts` | `43612df275a7e277617e79b0467072b2326e74f638ee7180820f42d09bb41de5` |
| `packages/sdk/src/lines.ts` | `d295ca89663021370578fdb787b8216e887867dbf0c919ecaef7ce5969384d39` |
| `packages/sdk/src/automation.ts` | `f9cfad12f5e838662d9d07d69bbe087e617c305bd19991572b90f4d6e488fbdd` |
| `packages/sdk/src/workflow-state.ts` | `93f4dfa1a52f97a754ff5e0911f137056f855ce94c40bbd327de992755ae0025` |
| `packages/cli/src/index.ts` | `50e5d32f6914a5f1b2905927c0f06d41be4b507791cd43a549926f569f659962` |
| `packages/cli/src/lib/client.ts` | `da7a4b28800a08896de73241e0f853d6d8836ff9ac8ee681c8988b0713296007` |
| `packages/cli/src/commands/automation.ts` | `04d701c3c9a767051117c05ead35d57ccd8c583f56d81730ff070f372f8be23f` |
| `packages/cli/src/lib/automation-io.ts` | `cdef3959cf32e1b10739b0a9a09e1df1d52524da1775570053bd0f98a1566d1f` |
| `packages/cli/src/lib/transfer-jobs.ts` | `3cb3ff3a3668724c49966d09f0e8d037144eb65428213893357541bbd315d48a` |
| `packages/python-sdk/agfs_sdk/__init__.py` | `c969868bbd71df3561b9de32c5ab4a1d07eb7993070481f87690506331f96788` |
| `packages/python-sdk/agfs_sdk/automation.py` | `6050263c52eae91ee6fb0836444f2b4b2977c5e589bbd7bce9173e65f5f4bcca` |
