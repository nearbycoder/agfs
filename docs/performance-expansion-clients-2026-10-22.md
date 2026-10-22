# Client performance expansion — October 22, 2026

Scope: SDK, CLI and Python SDK only. Baseline: `/tmp/agfs-plus50-baseline-20261022` (the completed dependency refresh, original twenty improvements and reviewed security fixes). No commits, deployment, publication, full builds or live fixtures belong to this subtask.

## Concrete candidate plan (written before implementation)

These sixteen rows are implementation candidates, not claims of completion. Evidence and any rejected candidates will be recorded below. Existing TypeScript multipart concurrency, fingerprint reuse, indexed resume checks, and CLI parallel folder downloads are excluded from the count.

| Global # | New behavior | Baseline cost / planned evidence |
| --- | --- | --- |
| 55 | Compile CLI sync ignore patterns once per cycle | Pattern compilation repeats for every local/remote/state path; assert one compilation per pattern and identical matching. |
| 56 | Hash independent local sync files with a bounded worker pool | Serial disk reads stall discovery; controlled gates prove the configured bound and failure draining. |
| 57 | Overlap independent local and remote sync discovery | Remote planning currently waits for all local hashes; gates prove both start before either finishes. |
| 58 | List independent remote sync folders concurrently | One awaited request per folder; bounded traversal tests preserve hierarchy, ignored subtrees and path validation. |
| 59 | Reject initial same-name comparisons by unequal byte sizes | Currently downloads remote bytes even when equality is impossible; assert zero content requests for unequal sizes. |
| 60 | Compare initial equal-size sync candidates concurrently | Initial remote SHA comparisons currently serialize; gates prove bounded concurrency and deterministic plans. |
| 61 | Avoid a second whole-file hash for unchanged sync entries | Read-only unchanged entries are hashed again in the mutation loop; assert one scan hash while retaining pre-mutation race guards. |
| 62 | Coalesce sync checkpoint writes and skip per-unchanged-file persistence | Full state is serialized/written once per entry; assert one no-op-cycle checkpoint and bounded awaited writes for changed files. |
| 63 | Compute downloaded sync SHA-256 during the atomic write | Successful downloads are reopened and reread to hash; compare exact digest with no destination reread. |
| 64 | Eliminate invisible progress rendering and throttle unknown-size streams | Non-TTY updates still format bars; unknown-size updates bypass throttling; count renders/clock reads while preserving completion. |
| 65 | Remove the CLI upload adapter's redundant full-part copy | Every complete part slices its newly owned ArrayBuffer; identity tests prove full buffers are reused and short reads remain exact. |
| 66 | Add a bounded lazy SDK mapping iterator | Array-only map retains every input/result; prove bounded source pulls/results, early-stop cleanup, abort and error draining. |
| 67 | Add sequential SDK upload from a nonseekable byte stream | Callers currently stage streams in whole-file buffers or external files; prove multipart-sized buffering, exact size and source cleanup. |
| 68 | Add Python bounded atomic download-to-file | Provide an efficient disk transfer API with reusable read buffer, byte-count verification and atomic replacement; test short/error bodies and unsafe destinations. |
| 69 | Pipeline Python upload preparation behind sequential network PUTs | Hash/read preparation and network waits currently serialize; one read-ahead worker overlaps them without concurrent transport/token callbacks. |
| 70 | Reduce Python resumable verification work | Independently unchanged Python loop rereads/rehashes the fingerprint and linearly scans parts; combine both into one Python work-reduction item, proving N source reads/hashes and N resume lookups with full validation. |

## Constraints

All hashes remain content-based; no mtime trust cache or authorization cache. Live requests retain origin/path/redirect/capability checks and conditional writes. Sync keeps all pre-mutation/local-change checks. Concurrency is finite and bounded, failures drain active work, and checkpoint writes remain atomic. Existing sequential CLI resumable upload and clean-checkout Vitest source alias remain intact. Public additions will be documented with limits and backward-compatible defaults.

## Implemented results: exactly sixteen new improvements (#55–70)

All candidates were implemented. The Python resume changes in row 70 are one combined Python improvement; they do not recount the already-completed TypeScript SDK changes. No security/compatibility fix, dependency change, cosmetic edit or individual changed line is counted.

| # | Implemented behavior | Focused evidence |
| --- | --- | --- |
| 55 | Per-cycle compiled ignore matcher | `sync-performance.test.ts`: 10,000 paths with three patterns perform exactly three RegExp constructions; the prior per-path matcher could construct 30,000 in the worst case. Existing ignore regressions pass. |
| 56 | Bounded lazy local hash pool | Eight files reach exactly three simultaneous reads at concurrency three, perform eight reads total, skip ignored subtrees and reject symlinks. Directory discovery feeds the lazy SDK iterator. |
| 57 | Overlapping local/remote discovery | Independent controlled gates prove both lanes start before either completes. Failure waits for the other lane and preserves the first error. |
| 58 | Bounded concurrent remote listing | Three sibling folders reach exactly two simultaneous requests at concurrency two. An ignored folder is never listed; parent/path mismatches and duplicate remote entries fail before mutations. |
| 59 | Size-based initial conflict pruning | An unequal-size same-name fixture performs zero remote content requests and still raises a conflict without any state/file writes. Equal-size files continue through full conditional SHA-256 comparison. |
| 60 | Bounded parallel initial comparisons | Eight initial equal-size candidates reach exactly three concurrent comparisons and all eight contents are compared. The resulting plan remains ordered. |
| 61 | Eliminate unchanged-file guard rereads | An eight-file unchanged cycle performs its eight discovery hashes and zero additional mutation-loop hashes; the baseline performed sixteen whole-file hashes. The next cycle still reads content again. Mutation guards remain tested. |
| 62 | Coalesced atomic sync checkpoints | Eight unchanged entries produce one full-state write instead of eight. Concurrent updates 1/2 share a write and update 3 arriving during that write receives a second awaited snapshot. The microtask retirement race found by the parent is fixed and has a deterministic regression. |
| 63 | SHA-256 during atomic sync download | A new-file download performs only its two pre-mutation/pre-rename absence guards, with no installed-file reread. Persisted SHA-256 equals the exact written bytes. A local edit before rename preserves the edit and rejects the transfer. |
| 64 | Progress work suppression | 10,000 non-TTY updates do zero clock/render work; one completion line remains. 10,000 same-tick unknown-total TTY updates render once, followed by completion. |
| 65 | Reuse owned CLI upload buffers | The full 8 MiB part returned by the adapter is the identical ArrayBuffer filled by the file reader, eliminating the baseline's extra 8 MiB allocation/copy per complete part. Short-read results contain exactly the returned bytes. |
| 66 | Lazy ordered SDK mapper | A 10,000-item generator is pulled only three times at concurrency three before consumer progress. Early return closes its source, failure drains active callbacks, string iterables work, and cleanup failure cannot replace the original work error. A ready result is yielded while a later source pull waits for consumer acknowledgment. |
| 67 | Nonseekable SDK stream upload | A fragmented 8 MiB + 19 byte stream yields exactly two sequential PUT bodies with byte-for-byte equality. Short/extra/error streams never complete, including a completing resume. Abort cancels/releases the reader. A transient PUT retries the stable owned buffer with just one source read. Reachability/GC tests verify just one live SDK-owned 8 MiB buffer while reading the second part in both pending and completing resumes. |
| 68 | Python bounded atomic disk download | A 1 MiB response read in 4 KiB chunks uses one buffer identity for all 257 read/EOF calls and exact output bytes. Short/long/error bodies, callback failures and destination swaps preserve old content; symlinks cannot redirect writes and hard-link targets are not truncated. Parent segments, staging-inode substitutions and untrusted staging-directory swaps are rejected; an O_EXCL failure preserves the preexisting staging entry. |
| 69 | Python read/hash preparation pipeline | Controlled events prove the next part is prepared during the current PUT, while all transport calls stay on the caller thread. `prefetch=False` proves no read-ahead. Failed PUT waits for active disk reads before source close and never completes. |
| 70 | Python resume verification work reduction | A two-part fixture reads/hashes exactly twice rather than three times, skips the verified first PUT and uploads the changed second part. A 1,000-part metadata fixture reads each part's two fields once and performs zero further metadata scans during digest lookup. Invalid metadata is rejected before any PUT/completion. |

These are deterministic local work counts and concurrency gates, not production bandwidth, billing, or latency claims. No artificial wall-clock benchmark was needed to establish the removed work. Concurrency can be set to one on I/O-constrained systems.

## Public API additions and compatibility

- TypeScript: `mapConcurrentIterable(items, limit, work, signal?)` and `AgfsClient.uploadStream(path, stream, size, options?)`, where upload options omit concurrency. Existing APIs retain their defaults. Stream upload retains one live SDK-owned multipart buffer; producer-supplied chunks, source queues, runtime/WebCrypto/Fetch buffers and garbage awaiting collection add memory. The producer must bound its own chunk/queue size; this is not an RSS ceiling. The source must terminate at the exact declared length. A fresh stream is required for another upload attempt.
- Python: `AgfsClient.download_file(remote_path, local_path, *, if_match=None, chunk_size=262144, on_progress=None) -> Path` and optional `upload_file(..., prefetch=True)`. Atomic disk downloads require POSIX directory-descriptor/no-follow support; unsupported platforms raise `NotImplementedError`. Existing portable streaming `download()` remains unchanged. Python upload requests and token/progress callbacks remain sequential.
- Python's zero-byte upload capabilities now use the configured origin despite an advertised canonical hostname alias, matching TypeScript/CLI. Malformed IDs/endpoints, userinfo, query strings and fragments remain refused. This compatibility fix is **not counted**.
- POSIX sync filenames containing colon or DEL retain baseline compatibility. Windows colon names are refused to prevent drive/alternate-stream interpretation. Remote entry paths must match their listed parent.

## Review correction

The parent independently reproduced an initial checkpoint coalescer race: an update in the microtask gap between the final generation check and `.finally()` could join a settled writer without being saved. The implementation now retires the active writer synchronously with the generation check, before settling its promise, and has no successor-clobbering `finally`. The exact reproduction now writes `[1, 2]`; both the focused regression and the parent's independent rerun passed. This correction is part of row 62, not an additional improvement.

## Verification record before the independent client review

The initial focused checks passed but did not detect the four later review findings below:

- **26 SDK tests**: `stream-performance.test.ts`, `upload-performance.test.ts`, `client.test.ts`.
- **34 CLI tests**: `sync-performance.test.ts`, `sync-plan.test.ts`, `upload-source.test.ts`, `progress.test.ts`, `client-security.test.ts`, `download.test.ts`.
- **18 Python tests**: 14 new transfer-performance tests and four existing client tests.
- SDK TypeScript `--noEmit`; CLI source TypeScript `--noEmit`; scoped `git diff --check`.
- **36 tests are new** in this allocation (10 SDK, 12 CLI, 14 Python); the remaining focused cases preserve affected existing behavior.

Commands run from the project root:

```sh
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/sdk exec vitest run src/stream-performance.test.ts src/upload-performance.test.ts src/client.test.ts
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/sdk typecheck
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/cli exec vitest run src/lib/sync-performance.test.ts src/lib/sync-plan.test.ts src/lib/upload-source.test.ts src/lib/progress.test.ts src/lib/client-security.test.ts src/lib/download.test.ts
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/cli exec tsc --noEmit -p /tmp/agfs-clients-typecheck-20261022.json
PYTHONPATH=packages/python-sdk python3 -m unittest discover -s packages/python-sdk/tests -p 'test*client.py'
PYTHONPATH=packages/python-sdk python3 -m unittest discover -s packages/python-sdk/tests -p test_transfer_performance.py
```

The temporary CLI typecheck config extends `packages/cli/tsconfig.json`, preserves existing path aliases, adds `@agfs/sdk` pointing at the current SDK source, and sets the repository's Node type root. This avoids generating SDK build outputs during the subtask; the parent owns the normal dependency build and workspace checks. The clean-checkout CLI Vitest source alias was preserved unchanged. No root/config/manifest/contract/server/browser file was changed by this allocation, and no dependency was added.

## Affected files relative to the saved baseline

- SDK: `src/concurrency.ts`, `src/index.ts`, new `src/stream-performance.test.ts`, new `src/stream-memory.test.ts`, `README.md`.
- CLI: `src/commands/sync.ts`; `src/lib/client.ts`, `progress.ts`, `safe-download.ts`, `sync-plan.ts`; new `src/lib/sync-io.ts`, `sync-performance.test.ts`, `upload-source.ts`, `upload-source.test.ts`; new `README.md`.
- Python: `agfs_sdk/__init__.py`, new `agfs_sdk/transfer.py`, new `tests/test_transfer_performance.py`, `README.md`.
- This report: `docs/performance-expansion-clients-2026-10-22.md`.

## Independent client review corrections

The implementation sub-agent reproduced all four introduced findings **before changing source**, using the reviewer's `/tmp/agfs-sdk-review-20261022/edge-cases.test.ts`, `/tmp/agfs-client-review-python-download.py`, and `/tmp/agfs-client-review-stream-retention.mjs`. The temporary tests asserted the faulty behavior, so their success was confirmation of the defects, not a clean review.

1. **Python parent-segment normalization (P2).** `link/../file` was lexically normalized before symlink checks and overwrote a different file than normal filesystem resolution named. Destination paths now reject every `..` segment before normalization. The regression preserves both the lexically selected and filesystem-selected victims.
2. **Python staging substitution (P2).** A progress callback could replace the named staging file with a symlink and have it renamed into the destination. Content now lives inside a private, descriptor-anchored directory; the opened directory must have the effective user's UID and no group/other permissions. The still-open source descriptor's device/inode must match the named regular staging file before rename, and byte size must match written bytes. Tests cover symlink/regular-file substitution, parent staging-entry substitution, a permissive mkdir/open directory swap, a foreign owner, and O_EXCL collision cleanup. Cleanup preserves preexisting content when O_EXCL creation fails and substituted parent-directory entries. After successful creation, cleanup may remove a replacement at the staging content name. This is not a security boundary against processes with the same UID or full user authority.
3. **Lazy mapper consumer-acknowledgment deadlock (P2).** Filling every worker slot awaited a source `next()` that could itself wait for the consumer to receive a ready result. The mapper now races ordered work against its single outstanding source pull and yields ready output immediately. The pending work/results plus reserved source-pull slot remain bounded by the selected limit. Callbacks finish before source-owned resources close; cooperative source `return()` runs before joining a blocked pull. A source that cannot interrupt its own pending I/O still needs application cancellation. Regressions cover consumer acknowledgment, early return with a cooperative blocked pull, source-pull failure, worker draining, ordering, first-error preservation and bounded lookahead.
4. **Completing-resume fingerprint retention (P3).** The completing branch retained the first 8 MiB fingerprint buffer while allocating later stream buffers. It now explicitly releases `first` before the completion hook validates the tail. A V8 reachability/GC regression observes `[false, true]` for the first and second owned part buffers during the second read for both pending and completing resumes. The earlier reproduction observed `[true, true]` only for completing resumes. Producer queues and runtime buffers are outside this SDK-owned live-reference measurement.

These corrections are included in existing rows 66–68 and do not increase the sixteen-improvement count.

After the corrections, **31 SDK tests**, **11 CLI sync-performance tests**, and **20 Python transfer tests** passed, as did SDK and CLI source TypeScript checks. The 11 additional review regressions bring this allocation to **47 new tests** (15 SDK, 12 CLI, 20 Python). The initial affected-behavior tests listed above remain recorded separately. No production source changed after the settled-source signal; subsequent edits only corrected documentation/checksum records.

```sh
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/sdk exec vitest run src/stream-performance.test.ts src/stream-memory.test.ts src/upload-performance.test.ts src/client.test.ts
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/sdk typecheck
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/cli exec vitest run src/lib/sync-performance.test.ts
npm exec --yes --package=pnpm@10.34.7 -- pnpm --filter @agfs/cli exec tsc --noEmit -p /tmp/agfs-clients-typecheck-20261022.json
PYTHONPATH=packages/python-sdk python3 -m unittest discover -s packages/python-sdk/tests -p test_transfer_performance.py -v
```

Fresh independent review and combined/integration verification remain with the parent and are not claimed by this subtask.

## Limits and handoff

Sync discovery still retains metadata proportional to visited entries and directory listings. Parallel local/remote discovery permits both bounded lanes to be active at once. A no-op sync writes one checkpoint; completed mutations can share a write, but serial mutations still each await durable progress. Atomic replacement does not provide fsync durability or a cross-file transaction. Reused upload parts still require local byte verification; source files must remain stable during upload. Ordered lazy mapping may wait behind a slow earlier result, and in-flight callbacks/source iterators need their own cancellation support.

No full build, live fixture, integration run, commit, deployment, or publication was performed by this subtask. The parent has prepared integration coverage for stream upload, early-stop lazy mapping, Python prefetch on/off, atomic Python download, empty alias upload, and a 24-file nested sync, to run after the combined build. Parent integration results must be recorded separately; they are not claimed here.

## Parent completion

Independent follow-up review cleared all four production findings. Its documentation correction is applied here and in the Python README. The parent completed the final workspace build/typechecks, 618 workspace tests, 27 Python tests, the installed-wheel checks, and full integration, including the client scenarios above plus consumer acknowledgment and ambiguous-path rejection. See the [complete verification report](performance-expansion-2026-10-22.md) for final evidence and limits.
