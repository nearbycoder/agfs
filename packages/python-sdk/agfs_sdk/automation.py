"""Bounded automation helpers. These helpers never start background polling."""
from __future__ import annotations
import hashlib
import hmac
import json
import math
import re
import time
import urllib.parse


class ResourceLimitError(Exception):
    pass


class WorkflowError(Exception):
    def __init__(self, message, resource_id, completed, cause, resources=None):
        super().__init__(message)
        self.resource_id, self.completed, self.__cause__ = resource_id, completed, cause
        self.resources = list(resources or [])


def _integer(value, name, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f'{name} must be an integer from {minimum} to {maximum}')
    return value


def _path(value):
    if not isinstance(value, str) or len(value) > 4096 or not value.startswith('/') or re.search(r'[\\\x00-\x1f]', value) or value != '/' and any(p in ('', '.', '..') for p in value.split('/')[1:]):
        raise ValueError('Use a canonical absolute remote path without traversal')
    return value


def diagnose_error(error):
    """Classify finite cause chains iteratively, retaining acknowledged resources."""
    seen, resources, workflow = set(), {}, None
    current, result = error, _diagnostic(error)
    def remember(record):
        if type(record) is not dict:
            return
        resource_id, completed = record.get('resourceId'), record.get('completed')
        if not isinstance(resource_id, str) or not resource_id or type(completed) is not int or completed < 0:
            return
        prior = resources.get(resource_id, {})
        kind = record.get('kind', prior.get('kind'))
        resources[resource_id] = {'resourceId': resource_id, 'completed': max(completed, prior.get('completed', 0)),
                                  **({'kind': kind} if kind in ('draft', 'run') else {})}
    while isinstance(current, BaseException) and id(current) not in seen:
        seen.add(id(current))
        candidate = _diagnostic(current)
        if candidate['category'] != 'failure':
            result = candidate
        if isinstance(current, (WorkflowError, SystemExit)):
            resource_id, completed = getattr(current, 'resource_id', None), getattr(current, 'completed', None)
            if isinstance(resource_id, str) and type(completed) is int and completed >= 0:
                if workflow is None:
                    workflow = {'message': str(current), 'resourceId': resource_id, 'completed': completed}
                remember({'resourceId': resource_id, 'completed': completed})
            records = getattr(current, 'resources', None)
            if isinstance(records, list):
                for record in records:
                    remember(record)
        # A cancellation/termination's caller-owned cause must not override it.
        if not isinstance(current, WorkflowError) and candidate['category'] != 'failure':
            break
        current = current.__cause__
    return {**result, **(workflow or {}), **({'resources': list(resources.values())} if resources else {})}


def _diagnostic(error):
    status = getattr(error, 'status', None)
    category = ('budget' if isinstance(error, ResourceLimitError) else 'cancelled' if isinstance(error, KeyboardInterrupt)
                else 'terminated' if isinstance(error, SystemExit) else 'timeout' if isinstance(error, TimeoutError) else 'authorization' if status in (401, 403)
                else 'not_found' if status == 404 else 'conflict' if status in (409, 412)
                else 'checkpoint_expired' if status == 410 else 'rate_limited' if status == 429
                else 'service' if isinstance(status, int) and status >= 500
                else 'invalid_input' if isinstance(error, (TypeError, ValueError)) or status == 400 else 'failure')
    exit_code = (error.code if isinstance(error.code, int) else 0 if error.code is None else 1) if isinstance(error, SystemExit) else None
    return {'category': category, 'message': str(error), **({'status': status} if status is not None else {}),
            'retryable': category in ('timeout', 'rate_limited', 'service'),
            'exitCode': exit_code if exit_code is not None else {'budget': 8, 'cancelled': 130, 'timeout': 124, 'authorization': 3, 'not_found': 4,
                         'conflict': 5, 'checkpoint_expired': 6, 'rate_limited': 7, 'service': 7, 'invalid_input': 2}.get(category, 1)}


def _retain_exit(error, kind, resource_id, completed):
    """Keep native SystemExit propagation/code while annotating confirmed recovery."""
    resources = getattr(error, 'resources', [])
    error.resources = [*(resources if isinstance(resources, list) else []),
                       {'kind': kind, 'resourceId': resource_id, 'completed': completed}]
    error.resource_id, error.completed = resource_id, completed


def verify_webhook(secret, raw_body, *, timestamp, signature, now_seconds=None, tolerance_seconds=300, max_bytes=1048576):
    """Verify exact bytes and either of up to two v1 signatures during key rotation.

    This does not deduplicate deliveries. Persist event IDs in the consuming application.
    """
    _integer(max_bytes, 'max_bytes', 1, 8388608)
    _integer(tolerance_seconds, 'tolerance_seconds', 0, 3600)
    now = int(time.time()) if now_seconds is None else _integer(now_seconds, 'now_seconds', 0, 2**53 - 1)
    if not isinstance(secret, str) or not secret or len(secret) > 4096 or not isinstance(raw_body, bytes) or len(raw_body) > max_bytes:
        return False
    if not isinstance(timestamp, str) or not re.fullmatch(r'[0-9]{1,16}', timestamp) or not isinstance(signature, str) or len(signature) > 160:
        return False
    if int(timestamp) > 2**53 - 1 or abs(now - int(timestamp)) > tolerance_seconds:
        return False
    signatures = signature.split(',')
    if len(signatures) > 2 or any(not re.fullmatch(r'v1=[0-9a-f]{64}', item) for item in signatures):
        return False
    expected = hmac.new(secret.encode(), timestamp.encode() + b'.' + raw_body, hashlib.sha256).hexdigest()
    valid = False
    for item in signatures:
        valid |= hmac.compare_digest(expected, item[3:])
    return valid


def stage_draft(client, batch):
    """Validate every change before creating a draft. Partial failure exposes its ID."""
    if not isinstance(batch, dict) or not isinstance(batch.get('name'), str) or not batch['name'].strip() or len(batch['name']) > 100 or not isinstance(batch.get('changes'), list) or not 1 <= len(batch['changes']) <= 30:
        raise ValueError('Draft requires a name and 1–30 changes')
    root, seen = _path(batch.get('path')), set()
    for change in batch['changes']:
        if not isinstance(change, dict):
            raise ValueError('Invalid draft change')
        path = _path(change.get('path'))
        if path == root or not path.startswith('/' if root == '/' else root + '/') or path in seen or change.get('operation') not in ('write', 'delete'):
            raise ValueError('Invalid or duplicate draft path')
        if change['operation'] == 'write' and not isinstance(change.get('content'), str):
            raise ValueError('Writes require text content')
        if 'content' in change and (not isinstance(change['content'], str) or len(change['content'].encode('utf-16-le')) // 2 > 8192):
            raise ValueError('Draft content exceeds 8192 UTF-16 code units')
        if 'contentType' in change and (not isinstance(change['contentType'], str) or len(change['contentType']) > 255):
            raise ValueError('Invalid content type')
        seen.add(path)
    batch = {'name': batch['name'], 'path': root,
             'changes': [{key: change[key] for key in ('path', 'operation', 'content', 'contentType') if key in change} for change in batch['changes']]}
    draft = client.create_draft(batch['name'], root)
    draft_id, completed = draft.get('id'), 0
    if not isinstance(draft_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', draft_id):
        raise ValueError('Invalid draft identifier')
    try:
        for change in batch['changes']:
            client.json('/platform/drafts/' + draft_id + '/changes', 'PUT', {key: change[key] for key in ('path', 'operation', 'content', 'contentType') if key in change})
            completed += 1
    except SystemExit as error:
        _retain_exit(error, 'draft', draft_id, completed)
        raise
    except (Exception, KeyboardInterrupt) as error:
        raise WorkflowError(f'Draft {draft_id} staged {completed}/{len(batch["changes"])} changes; inspect before retrying', draft_id, completed, error,
                            [{'kind': 'draft', 'resourceId': draft_id, 'completed': completed}]) from error
    return {'id': draft_id, 'completed': completed}


def with_run(client, name, path, work, *, inputs=None, metadata=None):
    """Invoke work exactly once. A failing callback leaves its run open for inspection."""
    run = client.start_run(name, _path(path), inputs=inputs, metadata=metadata)
    run_id = run.get('id')
    if not isinstance(run_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', run_id):
        raise ValueError('Invalid run identifier')
    try:
        value = work({'id': run_id})
        client.complete_run(run_id)
        return {'id': run_id, 'value': value}
    except SystemExit as error:
        _retain_exit(error, 'run', run_id, 0)
        raise
    except (Exception, KeyboardInterrupt) as error:
        raise WorkflowError(f'Run {run_id} was not confirmed complete; inspect before retrying', run_id, 0, error,
                            [{'kind': 'run', 'resourceId': run_id, 'completed': 0}]) from error


def read_lines(client, path, *, checkpoint=None, max_bytes=8388608, max_line_bytes=65536, max_lines=100000):
    """Yield strict UTF-8 lines and ETag-bound byte checkpoints; closing cancels reading."""
    _path(path)
    _integer(max_bytes, 'max_bytes', 1, 1024**3)
    _integer(max_line_bytes, 'max_line_bytes', 1, 1048576)
    _integer(max_lines, 'max_lines', 1, 1000000)
    cp, offset, line = None, 0, 0
    if checkpoint is not None:
        fields = ('version', 'origin', 'path', 'etag', 'offset', 'line')
        if type(checkpoint) is not dict or any(field not in checkpoint for field in fields):
            raise ValueError('Incomplete line checkpoint')
        cp = {field: checkpoint[field] for field in fields}
        if type(cp['version']) is not int or cp['version'] != 1 or type(cp['origin']) is not str or cp['origin'] != client.base_url or type(cp['path']) is not str or cp['path'] != path or type(cp['etag']) is not str or not cp['etag'] or len(cp['etag']) > 256 or re.search(r'[\x00-\x1f\x7f]', cp['etag']):
            raise ValueError('Line checkpoint belongs to another origin or path')
        offset, line = _integer(cp['offset'], 'offset', 0, 20 * 1024**3), _integer(cp['line'], 'line', 0, 2**53 - 1)
        if (offset == 0) != (line == 0) or line > offset:
            raise ValueError('Inconsistent line checkpoint offset and line')
    parent = path.rsplit('/', 1)[0] or '/'
    with client.request('/api/v1/fs/list?' + urllib.parse.urlencode({'path': parent})) as response:
        listing = response.read(2097153)
    if len(listing) > 2097152:
        raise ResourceLimitError('Folder listing exceeds 2 MiB')
    result = json.loads(listing)
    if result.get('path') != parent or not isinstance(result.get('entries'), list) or len(result['entries']) > 10000:
        raise ValueError('Invalid folder listing')
    matches = [item for item in result['entries'] if item.get('path') == path]
    if len(matches) != 1:
        raise ValueError('File missing or duplicated in listing')
    entry = matches[0]
    if entry.get('kind') != 'file' or not isinstance(entry.get('etag'), str) or not entry['etag']:
        raise ValueError('Invalid file metadata')
    size = _integer(entry.get('size'), 'size', 0, 20 * 1024**3)
    if checkpoint is not None and entry['etag'] != cp['etag']:
        from . import AgfsError
        raise AgfsError(412, 'Line checkpoint file version changed')
    if offset > size:
        raise ValueError('Line checkpoint exceeds file size')
    if offset == size:
        return
    start, end, etag = offset, min(size, offset + max_bytes) - 1, entry['etag']
    range_start = max(0, start - 1)  # Verify that a resumed record starts after LF.
    with client.request('/api/v1/fs/download?' + urllib.parse.urlencode({'path': path}), headers={'Range': f'bytes={range_start}-{end}', 'If-Match': etag}) as response:
        if response.status != 206 or response.headers.get('Content-Range') != f'bytes {range_start}-{end}/{size}' or response.headers.get('ETag', '').strip('"') != etag or response.headers.get('Content-Encoding'):
            raise ValueError('Invalid or changed ranged response')
        pending, consumed, emitted = bytearray(), 0, 0
        prefix = start > 0
        def emit(terminated=True):
            nonlocal line, emitted
            emitted += 1
            if emitted > max_lines:
                raise ResourceLimitError('Line reader exceeds max_lines')
            text = pending.decode('utf-8')
            if line == 0 and start == 0:
                text = text.removeprefix('\ufeff')
            if terminated:
                text = text.removesuffix('\r')
            pending.clear()
            line += 1
            return {'text': text, 'line': line, 'checkpoint': {'version': 1, 'origin': client.base_url, 'path': path, 'etag': etag, 'offset': offset, 'line': line}}
        while True:
            chunk = response.read(65536)
            if not chunk:
                break
            consumed += len(chunk)
            if consumed > end - range_start + 1:
                raise ResourceLimitError('Ranged response exceeds requested bytes')
            if prefix:
                if chunk[0] != 10:
                    raise ValueError('Checkpoint is not a complete line boundary')
                chunk, prefix = chunk[1:], False
            at = 0
            while at < len(chunk):
                newline = chunk.find(b'\n', at)
                stop = len(chunk) if newline < 0 else newline
                if len(pending) + stop - at > max_line_bytes:
                    raise ResourceLimitError('Line exceeds max_line_bytes')
                pending.extend(chunk[at:stop])
                offset += stop - at
                at = stop
                if newline >= 0:
                    offset += 1
                    at += 1
                    yield emit()
        if consumed != end - range_start + 1:
            raise ValueError('Truncated ranged response')
        if end + 1 < size:
            raise ResourceLimitError('Reached max_bytes; resume from the last emitted checkpoint')
        if pending:
            yield emit(False)


def read_json_lines(client, path, *, max_records=10000, validate=None, **options):
    _integer(max_records, 'max_records', 1, 1000000)
    rows = read_lines(client, path, **options)
    def finite_float(value):
        number = float(value)
        if not math.isfinite(number):
            raise ValueError('JSON number is not finite')
        return number
    try:
        for index, row in enumerate(rows, 1):
            if index > max_records:
                raise ResourceLimitError('JSONL reader exceeds max_records')
            try:
                value = json.loads(row['text'], parse_float=finite_float, parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Invalid JSON constant: ' + value)))
                if validate:
                    value = validate(value)
            except (ValueError, TypeError) as error:
                raise ValueError(f'Invalid JSON record at {path}:{row["line"]}') from error
            yield {'value': value, 'line': row['line'], 'checkpoint': row['checkpoint']}
    finally:
        rows.close()
