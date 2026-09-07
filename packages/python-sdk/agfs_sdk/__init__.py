"""AGFS client: standard-library only, bounded-memory uploads, explicit conditional writes."""
from __future__ import annotations
import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Iterator

_UNSET = object()
class AgfsError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

class AgfsClient:
    def __init__(self, token: str, base_url: str = 'https://agfs.dev', workspace: str | None = None, retries: int = 2):
        base = urllib.parse.urlsplit(base_url)
        if base.username or base.password or base.query or base.fragment or base.path not in ('', '/') or not (base.scheme == 'https' or base.scheme == 'http' and base.hostname in ('localhost', '127.0.0.1', '::1')):
            raise ValueError('Use an HTTPS origin (HTTP is allowed for local development)')
        self.base_url = base_url.rstrip('/')
        self.token, self.workspace, self.retries = token, workspace, min(5, max(0, retries))
        self._opener = urllib.request.build_opener(_NoRedirect)

    def request(self, path: str, method: str = 'GET', body: bytes | None = None, headers: dict | None = None, *, authenticated: bool = True):
        if not path.startswith('/api/v1/') or urllib.parse.urlsplit(urllib.parse.urljoin(self.base_url, path)).netloc != urllib.parse.urlsplit(self.base_url).netloc:
            raise ValueError('Invalid AGFS API path')
        request_headers = dict(headers or {})
        if authenticated:
            request_headers['Authorization'] = 'Bearer ' + (self.token() if callable(self.token) else self.token)
            if self.workspace:
                request_headers['X-AGFS-Workspace'] = self.workspace
        retries = self.retries if method in ('GET', 'HEAD', 'PUT') or 'Idempotency-Key' in request_headers else 0
        for attempt in range(retries + 1):
            try:
                return self._opener.open(urllib.request.Request(self.base_url + path, data=body, headers=request_headers, method=method), timeout=30)
            except urllib.error.HTTPError as error:
                with error:
                    if attempt < retries and error.code in (429, 502, 503, 504):
                        try:
                            retry = float(error.headers.get('Retry-After', 0))
                        except ValueError:
                            retry = 0
                        time.sleep(min(10, max(.25 * 2 ** attempt, retry)))
                        continue
                    try:
                        message = json.loads(error.read(16384)).get('error', str(error))
                    except (ValueError, AttributeError):
                        message = str(error)
                    raise AgfsError(error.code, message) from error
            except urllib.error.URLError:
                if attempt >= retries:
                    raise
                time.sleep(.25 * 2 ** attempt)

    def json(self, path: str, method: str = 'GET', body: Any = _UNSET, *, idempotency_key=None):
        with self.request('/api/v1' + path, method, None if body is _UNSET else json.dumps(body).encode(), {**({} if body is _UNSET else {'Content-Type': 'application/json'}), **({'Idempotency-Key':idempotency_key} if idempotency_key else {})}) as response:
            return json.load(response)

    def list(self, path: str = '/'):
        return self.json('/fs/list?' + urllib.parse.urlencode({'path': path}))

    def mkdir(self, path: str):
        return self.json('/fs/mkdir', 'POST', {'path': path})

    def download(self, path: str, if_match: str | None = None):
        """Return a context-managed streaming response. Caller closes it."""
        return self.request('/api/v1/fs/download?' + urllib.parse.urlencode({'path': path}), headers={'If-Match': if_match} if if_match else {})

    def read_text(self, path: str, if_match: str | None = None) -> str:
        with self.download(path, if_match) as response:
            return response.read().decode('utf-8')

    def search(self, **filters):
        return self.json('/platform/search?' + urllib.parse.urlencode({k: v for k, v in filters.items() if v is not None}))

    def search_all(self, **filters) -> Iterator[dict]:
        cursor = None
        while True:
            page = self.search(**{**filters, 'cursor': cursor})
            yield from page['results']
            next_cursor = page.get('nextCursor')
            if next_cursor is None:return
            if next_cursor == cursor:raise ValueError('Invalid pagination cursor')
            cursor = next_cursor

    def pages(self, resource):
        if resource not in ('runs','drafts','snapshots'):raise ValueError('Unknown resource')
        cursor=None
        while True:
            page=self.json('/platform/'+resource+('?' + urllib.parse.urlencode({'cursor':cursor}) if cursor else ''))
            yield from page[resource]
            if not page.get('nextCursor'):return
            if cursor==page['nextCursor']:raise ValueError('Invalid cursor')
            cursor=page['nextCursor']

    def tags(self, path: str, tags: list[str]):
        return self.json('/platform/tags', 'PUT', {'path': path, 'tags': tags})

    def start_run(self, name: str, path: str, inputs: list[str] | None = None, metadata: dict | None = None):
        return self.json('/platform/runs', 'POST', {'name': name, 'path': path, 'inputs': inputs or [], 'metadata': metadata or {}})

    def complete_run(self, run_id: str):
        return self.json('/platform/runs/' + urllib.parse.quote(run_id, safe='') + '/complete', 'POST', {})

    def create_draft(self, name: str, path: str):
        return self.json('/platform/drafts', 'POST', {'name': name, 'path': path})

    def change_draft(self, draft_id: str, path: str, content: str | None = None, operation: str = 'write'):
        return self.json('/platform/drafts/' + urllib.parse.quote(draft_id, safe='') + '/changes', 'PUT', {'path': path, 'operation': operation, 'content': content or ''})

    def apply_draft(self, draft_id: str):
        return self.json('/platform/drafts/' + urllib.parse.quote(draft_id, safe='') + '/apply', 'POST', {})

    def upload_file(self, local_path: str | Path, remote_path: str, *, content_type: str = 'application/octet-stream', if_match=_UNSET, on_progress=None):
        """if_match=None creates only; an ETag overwrites that version; omitting it writes unconditionally."""
        condition = {} if if_match is _UNSET else {'ifMatch': if_match}
        with open(local_path, 'rb') as file:
            file.seek(0, 2)
            size = file.tell()
            file.seek(0)
            if not size:
                intent = self.json('/fs/upload-intents', 'POST', {'path': remote_path, 'contentType': content_type, 'size': 0, **condition})
                target = urllib.parse.urlsplit(intent['url'])
                if target.scheme + '://' + target.netloc != self.base_url:
                    raise ValueError('Unexpected upload origin')
                with self.request(target.path + ('?' + target.query if target.query else ''), 'PUT', b'', intent['headers'], authenticated=False) as response:
                    etag = response.headers.get('ETag', 'uploaded')
                return self.json('/fs/uploads/' + intent['uploadId'] + '/commit', 'POST', {'etag': etag})['entry']
            first = file.read(min(size, 8388608))
            state = self.json('/fs/resumable', 'POST', {'path': remote_path, 'contentType': content_type, 'size': size, 'fingerprint': str(size) + ':' + hashlib.sha256(first).hexdigest(), **condition})
            upload_id = state['uploadId']
            if state['partSize'] != 8388608 or not upload_id.startswith('upl_') or not upload_id.replace('_', '').replace('-', '').isalnum():
                raise ValueError('Invalid upload response')
            if state['status'] != 'completing':
                for number, start in enumerate(range(0, size, state['partSize']), 1):
                    file.seek(start)
                    chunk = file.read(min(state['partSize'], size - start))
                    if len(chunk) != min(state['partSize'], size - start):
                        raise ValueError('Local file changed during upload')
                    digest = hashlib.sha256(chunk).hexdigest()
                    if not any(p['partNumber'] == number and p['digest'] == digest for p in state['parts']):
                        with self.request(f'/api/v1/fs/resumable/{upload_id}/parts/{number}', 'PUT', chunk):
                            pass
                    if on_progress:
                        on_progress(start + len(chunk))
            return self.json(f'/fs/resumable/{upload_id}/complete', 'POST', {})['entry']
