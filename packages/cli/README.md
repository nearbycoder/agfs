# AGFS CLI transfer and sync behavior

`agfs sync <local> <remote> --concurrency 3` and `agfs watch <local> <remote> --concurrency 3` use the selected 1–8 limit for local content hashes, remote folder listings, initial content comparisons, and file mutations. Local and remote discovery overlap, so there can be up to that many local hash operations and remote reads simultaneously. Each file upload still uses the existing sequential resumable protocol. Folder downloads retain their separate existing `--concurrency` limit (default four).

Sync compiles ignore patterns once per cycle and always hashes local contents; it does not trust timestamps or cache content hashes across watch cycles. Initial same-name files with different byte sizes immediately conflict without downloading remote content. Equal-size candidates still receive full SHA-256 comparisons. No file mutations begin until planning and conflict checks succeed. Initial comparisons remain conditional on the listed ETag.

Unchanged entries reuse the current cycle's content hashes and are saved in one atomic checkpoint instead of being reread and causing one full checkpoint rewrite per file. Simultaneous completed mutations can share a checkpoint, but each caller waits for a snapshot containing its own update. Pre-mutation and pre-replacement local-content guards, conditional remote writes, live remote-absence checks before deletion, namespace ownership checks, symlink refusals and the exclusive sync lock remain active. Downloaded bytes are hashed during their existing atomic write, avoiding a separate read of the installed file. The next watch cycle still detects later local edits.

Cancellation stops further scheduled work and pending client requests; active operations are drained before exit. Discovery retains metadata proportional to the visited files/folders and each directory listing; the concurrency limit bounds active I/O, not the total size of a sync tree. POSIX remote filenames containing colons or DEL retain their prior behavior; Windows names containing colons are refused to prevent drive/alternate-stream interpretation. Remote names must match their listed parent paths.

Noninteractive progress updates now only record byte counts and render once at completion. Interactive streams with unknown totals refresh at most every 50 ms. Complete CLI upload parts reuse their newly allocated read buffers without an extra copy; short reads retain their exact length and the existing upload protocol rejects a size mismatch.

## Automation commands

Run `agfs --help` and `agfs <command> --help` for the complete options. Automation commands emit JSON or one JSON value per line on stdout. `--json-errors` emits one structured error on stderr. `--max-requests` (default 100) bounds transport attempts, including retries, and `--timeout-ms` (default 30000) bounds the operation lifetime. These options apply to the new automation commands; they do not change existing sync/watch defaults. Ctrl+C cancels the active automation scope.

```sh
agfs inventory capture /reports --out ./before.json --max-entries 1000
agfs inventory diff ./before.json ./after.json
agfs --max-requests 200 --timeout-ms 120000 export ./before.json ./backup --max-bytes 1073741824
agfs bundle upload ./bundle.json ./artifacts --dry-run
agfs --json-errors bundle upload ./bundle.json ./artifacts
agfs lines /reports/job.log --max-line-bytes 65536
agfs records /reports/items.jsonl --max-records 1000
agfs text publish ./status.txt /reports/status.txt
agfs json patch /reports/config.json ./patch.json
agfs changes /reports --since 0 --max-pages 20
agfs draft stage ./draft.json
```

Protected local-file operations currently require **Linux with `/proc/self/fd` and `O_NOFOLLOW`**. Inventory capture, export and bundle upload check this before network requests. Their checkpoint and staging files use descriptor-anchored traversal, private staging directories and inode validation. Checkpoints use atomic rename; export content uses atomic create-only hard-link installation, preserving even a destination created during download/install. Exports therefore also require filesystem hard-link support; a filesystem denial fails safely without replacement. They refuse symlink parents/destinations, traversal, special files and reserved `.agfs-*` relative paths. Checkpoint replacement does not truncate other hard links. Cleanup unlinks only the owned staged inode and preserves a detected foreign replacement and its parent entry. Missing platform support returns category `unsupported_platform`, exit **9**, with an alternative. Permission/filesystem errors preserve the underlying failure. These protections do not isolate mutually hostile processes with the same UID or provide fsync durability.

`inventory diff` is portable and offline; it reads bounded regular JSON files without protected writes. Pure remote `lines`, `records` and `changes` commands are portable when no local checkpoint input is selected. New commands reading a protected local checkpoint/document currently require Linux too; use the portable SDK APIs with application-owned input on other platforms. Existing CLI commands keep their prior platform behavior.

An inventory is a deterministic, scope-bound metadata observation, not an atomic namespace snapshot. Capture visits at most 1,000 folders and 10,000 observed entries by default (depth 16), with a 2 MiB limit per listing response. Set a smaller depth deliberately for a partial inventory. No file contents are downloaded. Diff emits `added`, `removed`, `changed` and `unchanged` rows and refuses mismatched account/workspace/origin/root scopes.

`export` selects only inventory files and pins every GET to its recorded ETag. It defaults to at most 1 GiB total declared content and streams sequentially. `.agfs-export.json` binds the inventory digest, account, workspace and origin. Resume rehashes every completed local file before skipping it; changed or untracked existing files cause a conflict. Missing completed files may be downloaded again. The exclusive `.agfs-export.lock` prevents concurrent jobs. Folder metadata/empty folders are not restored. A crash after file installation but before checkpoint persistence leaves an untracked destination: the next invocation refuses to overwrite it. Inspect and move/remove that specific uncheckpointed file before resuming. Never blindly remove a lock belonging to a running process.

Bundle manifest example:

```json
{
  "version": 1,
  "root": "/reports",
  "files": [
    { "source": "new.txt", "path": "/reports/new.txt", "ifMatch": null, "contentType": "text/plain" },
    { "source": "existing.txt", "path": "/reports/existing.txt", "ifMatch": "observed-etag" }
  ]
}
```

`bundle upload` accepts 1–1,000 explicit regular source files relative to its local root. It does not mirror directories, delete files or create destination folders. Omitted/null conditions mean create-only. It hashes all sources and preflights every destination before uploading sequentially. The default total source limit is 1 GiB (maximum 20 GiB). Dry-run hashes and prints a local plan with **zero network/authentication requests** and no state writes. `.agfs-bundle.json` binds the exact manifest/conditions and source hashes plus origin/account/workspace. Completed entries are skipped only when source hashes and current remote ETags match. Source changes are rechecked before commit, including completing resumes. On a crash after remote commit but before checkpoint persistence, the changed destination conflicts safely: inspect the remote file and checkpoint before starting a new deliberate manifest. Failed conditional uploads are not retried as unconditional writes.

Completing upload sessions must provide matching digests for every source part before any commit/checkpoint certification; missing or mismatched parts conflict without a blind replacement. Destination preflight processes one bounded parent listing at a time and retains only the selected destinations (at most 1,000), discarding unrelated entries before the next parent. Every parent is checked before the first upload. This bounds retained metadata without reducing the normal server work for each parent listing.

`lines`/`records` emit a checkpoint with every accepted line/record. Save the `checkpoint` object (not the entire output row) after processing and supply it using `--checkpoint file.json`. Resume is conditional on the original ETag and verifies the preceding newline byte. Limits throw rather than silently truncate. `changes` similarly emits a checkpoint per complete batch; save it after accepting that batch. An incomplete checkpoint resumes its fixed window; a complete checkpoint starts the next window. A missing `--since`/checkpoint captures the current watermark, and expired history returns exit 6 instead of scanning the whole namespace. There is no polling.

`text publish` avoids uploads for identical bounded UTF-8 content and conditionally creates/replaces changed content. `json patch` applies RFC 7396 once against the observed ETag: null deletes an object member, and top-level null becomes JSON null. Both default to 1 MiB input/output limits. JSON transforms never rerun after a conflict.

Draft manifest example:

```json
{
  "name": "Release notes",
  "path": "/reports",
  "changes": [{ "path": "/reports/release.txt", "operation": "write", "content": "Ready" }]
}
```

All 1–30 changes are validated before creation. Partial staging errors include `resourceId` and `completed` for inspection. The command never approves or applies the draft.

Request-budget, deadline and cancellation failures retain already acknowledged draft IDs and confirmed change counts. Partial change checkpoints are rejected before requests; they never silently capture a newer watermark.

Stable automation exits: **0** success/help, **1** other failure, **2** invalid input, **3** authorization, **4** not found, **5** version/local conflict, **6** expired checkpoint, **7** rate limit/service failure, **8** request/resource budget, **9** unsupported platform, **124** deadline, **130** cancellation. Example stderr: `{"category":"conflict","message":"File changed","status":412,"retryable":false,"exitCode":5}`. The diagnostic format also applies to existing HTTP failures and argument errors when `--json-errors` is selected; existing progress output is otherwise unchanged.

Limits are resource controls, not measured production CPU/RSS/billing claims. Discovery retains bounded metadata, exports use one transport chunk plus a disk write, bundles use sequential 8 MiB upload buffers and bounded hash reads. Local verification deliberately rereads content rather than trusting timestamps. Existing server folder queries still do their normal per-folder work; a client response limit cannot undo a query already executed. Interrupted uploads can retain server-side staged parts until normal cleanup, and committed versions consume the existing retention/quota budget.
