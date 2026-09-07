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

The token selects the workspace; the optional `workspace` argument asserts that namespace. GET, HEAD, and PUT retry transient failures with bounded backoff; POST never automatically retries. Redirects are rejected. HTTP is allowed only for localhost development. Use the context manager returned by `download` to close the response.

OAuth applications can pass a current bearer token. Interactive OAuth login, refresh orchestration, and DPoP signing belong to the calling application. Do not publish tokens in shared notebooks or source code.
