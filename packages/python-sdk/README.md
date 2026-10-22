# agfs-sdk

Official Python client for AGFS, using only the Python 3.10+ standard library.

Install from this repository: `python -m pip install ./packages/python-sdk`.

```python
import os
from agfs_sdk import AgfsClient

agfs = AgfsClient(os.environ['AGFS_TOKEN'])
agfs.mkdir('/reports')
entry = agfs.upload_file('report.txt', '/reports/report.txt',
                         content_type='text/plain', if_match=None)
agfs.upload_file('report.txt', entry['path'], if_match=entry['etag'])
for result in agfs.search_all(q='release', path='/reports'):
    print(result['path'])
with agfs.download(entry['path']) as response:
    while chunk := response.read(1024 * 1024):
        # Stream into your chosen destination.
        print(len(chunk))
```

`if_match=None` means create only; an ETag means replace only that version. Omitting it writes unconditionally. Uploads use resumable 8 MiB parts and bounded memory. Retry `upload_file` with the same source to resume. Every part is hashed before reusing a previously uploaded part. `on_progress(bytes)` is optional.

`start_run`, `complete_run`, `create_draft`, `change_draft`, `apply_draft`, `tags`, and `search_all` cover common agent workflows. `json('/platform/...', method, body)` exposes all API endpoints. A person approves drafts in the web interface before an agent can apply them.

The token selects the workspace; the optional `workspace` argument asserts that namespace. GET, HEAD, and PUT retry transient failures with bounded backoff; POST retries only with an explicit `idempotency_key` on `json`. Redirects are rejected. HTTP is allowed only for localhost development. Use the context manager returned by `download` to close the response.

Interactive login and refresh are available through `agfs_sdk.oauth`:

```python
import webbrowser
from pathlib import Path
from agfs_sdk.oauth import OAuthSession, FileCredentialStore

session = OAuthSession.login(
    webbrowser.open,
    store=FileCredentialStore(Path.home() / '.config/agfs-sdk/credentials.json'),
)
client = AgfsClient(session.token)
```

Login uses PKCE and a loopback callback. The optional credential directory must be private (0700); files use 0600. Refresh is serialized within a session and persists rotated tokens. Use one session per store/process. DPoP signing belongs to the calling application. Do not publish tokens in notebooks or source code.

`upload_file(..., prefetch=True)` now overlaps preparation of the next part with the current network PUT using one read/hash worker. Network requests, token callbacks and progress callbacks stay sequential on the calling thread. At most two 8 MiB chunks are retained; set `prefetch=False` to retain one and serialize preparation. Failure waits for the read worker before closing the source and never completes the upload. Fingerprint bytes/hash are reused for the first part, and validated resume metadata is indexed once; every reused part still receives local SHA-256 verification. Source files must remain unchanged during an upload. Empty upload capabilities stay on the configured client origin when the service advertises a canonical hostname alias.

`download_file(remote_path, local_path, *, if_match=None, chunk_size=262144, on_progress=None) -> Path` streams to a file inside a private staging directory and atomically replaces the destination after verifying `Content-Length` when supplied. It returns the absolute destination path. It uses one reusable buffer; `chunk_size` is an integer from 4096 to 8388608 bytes. `on_progress` receives cumulative bytes written. Response/read/callback failures preserve the previous destination and remove the temporary file. No whole-file content is retained.

```python
saved = agfs.download_file('/reports/stream.bin', 'downloads/stream.bin',
                           if_match=entry['etag'], chunk_size=262144)
```

This disk API currently requires POSIX directory-descriptor and no-follow support; unsupported platforms raise `NotImplementedError` without writing a file. Paths containing `..` are rejected before absolute-path normalization; this includes `link/../file`. Parent directories are created with private permissions. Traversal, staging and replacement are anchored to directory descriptors; symlink parents/destinations and special files are refused, and existing hard links are replaced without truncating their targets. Before creating content, the opened staging directory must belong to the effective user and grant no group/other permissions. The staged source must still be the same regular inode written by this call before rename. Cleanup preserves preexisting content when O_EXCL creation fails and substituted parent-directory entries. After successful creation, cleanup may remove a replacement at the staging content name. These private-directory checks do not isolate a process from another process with the same UID or full user authority. It is atomic visibility, not an fsync durability guarantee or a multi-file transaction. The existing portable `download()` streaming response remains available on all supported Python platforms. A response without `Content-Length` is read until EOF; the API cannot detect a short remote body without an advertised length.

## Automation helpers

These portable, standard-library-only functions are exported from `agfs_sdk`. They are shared capabilities with the TypeScript/CLI workflows, not extra language-specific features.

```python
from agfs_sdk import (
    read_lines, read_json_lines, stage_draft, with_run,
    verify_webhook, diagnose_error, WorkflowError,
)

rows = read_lines(agfs, '/reports/job.log', max_bytes=8388608, max_line_bytes=65536)
try:
    for row in rows:
        consume(row['text'])
        save_checkpoint(row['checkpoint'])  # after accepting the complete line
finally:
    rows.close()  # required when stopping early

for row in read_json_lines(agfs, '/reports/data.jsonl', max_records=10000):
    consume(row['value'])

draft = stage_draft(agfs, {
    'name': 'Review notes', 'path': '/reports',
    'changes': [{'path': '/reports/notes.txt', 'operation': 'write', 'content': 'Ready'}],
})
run = with_run(agfs, 'Summarize', '/reports', lambda run: produce_artifacts(run['id']))

valid = verify_webhook(secret, exact_raw_body_bytes,
                       timestamp=timestamp_header, signature=signature_header)
```

`read_lines(..., checkpoint=saved)` resumes at the emitted byte offset with a pinned ETag. Each call performs one bounded parent listing and one byte-range GET; resume requests one extra preceding byte to validate an LF boundary. Strict UTF-8 decoding handles split code points, strips CR only in CRLF, and preserves final unterminated lines. Default limits are 8 MiB requested bytes, 64 KiB per line and 100,000 lines; maxima are 1 GiB, 1 MiB and 1,000,000 respectively. It retains one bounded line plus one 64 KiB read chunk. A changed ETag raises `AgfsError(412, ...)`; ignored/truncated ranges and forged line boundaries fail. Limits raise `ResourceLimitError`; resume from the last accepted checkpoint instead of assuming complete input. Python synchronous HTTP calls retain the client's existing 30-second request timeout; this release does not add a Python cancellation/deadline scope. Explicitly close a generator when ending consumption early.

`read_json_lines` adds JSON validation and exact error line numbers. Blank/malformed/non-finite records fail, JSON null stays `None`, and Python's normal JSON integer/float representation applies. `validate=` can apply an application schema. Default maximum records is 10,000. Save checkpoints only after processing; exactly-once side effects require application-owned atomic processing and checkpoint persistence.

A supplied line/JSONL checkpoint must be a plain `dict` containing `version`, `origin`, `path`, `etag`, `offset`, and `line`. All fields are validated and copied before transport; missing offset or line never defaults to a fresh read. Integer fields reject booleans/floats. Offset and line must be both zero or both positive, with line no greater than byte offset. ETags are nonempty bounded strings without control characters. Omit the checkpoint or pass `None` for a fresh read. Valid EOF checkpoints only revalidate file metadata.

`stage_draft` validates every one of 1–30 unique, path-confined changes before making requests, then creates and stages sequentially. It never approves or applies. Content uses the server's 8,192 UTF-16-code-unit limit. A partial failure raises `WorkflowError` with `resource_id`, `completed`, and the original exception as its cause. Inspect the draft before retrying; it is not a multi-request transaction.

`with_run` invokes the callback exactly once and completes only on success. Callback/completion failure retains the run ID and cause in `WorkflowError`. It never polls or creates a replacement run automatically. A lost completion response can leave a completed run, so inspect before retrying.

After acknowledged creation, `stage_draft` and `with_run` also preserve Ctrl+C as `WorkflowError` with the original `KeyboardInterrupt` in `__cause__`; `diagnose_error` returns `cancelled`/exit 130 and all known IDs and confirmed progress in `resources`. Honor that exit code or re-raise the original interrupt after recording recovery information. No callback or completion is retried. `SystemExit` remains the **same native exception with the same code**, annotated with `resource_id`, `completed`, and `resources`; process termination continues normally. Its diagnostic category is `terminated` with Python's exit-code semantics (`None` → 0, integer unchanged, noninteger → 1). An interrupt before a creation response is acknowledged has no invented recovery ID. Other programming errors keep their original classifications; `GeneratorExit` is not wrapped.

Diagnostics traverse nested causes iteratively with cycle detection, retaining the underlying category/status and every acknowledged resource ID rather than stopping after a fixed number of wrappers. Helpers supply each resource's `kind`; manually constructed `WorkflowError` records may omit it. Duplicate IDs keep the largest confirmed count. Cancellation and termination remain authoritative even if they have another exception as their cause. The traversal makes zero requests and uses memory proportional to the supplied cause chain and distinct recovery records.

`verify_webhook` checks exact raw `bytes`, a bounded timestamp window (default ±300 seconds, maximum 3,600), and one or two comma-separated `v1=` signatures used during key rotation. Every candidate uses `hmac.compare_digest`; no cloud request occurs. Default body limit is 1 MiB (maximum 8 MiB); signature headers over 160 characters fail. Deduplicate event IDs yourself: signatures/timestamps do not prevent replay inside the permitted window. `diagnose_error` provides the same category/status/retryability/exit-code vocabulary as TypeScript, with partial-workflow recovery fields.
