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
