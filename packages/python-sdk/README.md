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
