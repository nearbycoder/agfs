import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from agfs_sdk import AgfsClient
from agfs_sdk.transfer import PART_SIZE, prepared_parts, resume_parts


class Response(io.BytesIO):
    def __init__(self, value=b'', length=None):
        super().__init__(value)
        self.headers = {} if length is None else {'Content-Length': str(length)}
        self.buffers = []

    def readinto(self, buffer):
        self.buffers.append(id(buffer))
        return super().readinto(buffer)


class TransferTests(unittest.TestCase):
    def test_download_reuses_buffer_with_exact_bytes_and_conditional_header(self):
        content = bytes(range(256)) * 4096
        response = Response(content, len(content))
        client = AgfsClient('secret')
        received = []
        client.download = lambda path, if_match: (received.append((path, if_match)) or response)
        progress = []
        with tempfile.TemporaryDirectory() as root:
            destination = Path(root) / 'nested' / 'result'
            self.assertEqual(client.download_file('/file', destination, if_match='version', chunk_size=4096, on_progress=progress.append), destination)
            self.assertEqual(destination.read_bytes(), content)
            self.assertEqual(received, [('/file', 'version')])
            self.assertEqual(len(set(response.buffers)), 1)
            self.assertEqual(len(response.buffers), len(content) // 4096 + 1)
            self.assertEqual(progress[-1], len(content))
            self.assertEqual(list(destination.parent.iterdir()), [destination])
            self.assertTrue(response.closed)

    def test_download_failures_preserve_destination_and_remove_temporary_files(self):
        for content, length in [(b'short', 10), (b'too long', 1), (b'', -1), (b'', 'bad')]:
            with self.subTest(length=length), tempfile.TemporaryDirectory() as root:
                destination = Path(root) / 'result'
                destination.write_bytes(b'original')
                client = AgfsClient('secret')
                response = Response(content, length)
                client.download = lambda *args: response
                with self.assertRaises(ValueError):
                    client.download_file('/file', destination)
                self.assertEqual(destination.read_bytes(), b'original')
                self.assertEqual(list(Path(root).iterdir()), [destination])
                self.assertTrue(response.closed)

    def test_download_error_and_callback_failure_are_atomic(self):
        for callback in (False, True):
            with self.subTest(callback=callback), tempfile.TemporaryDirectory() as root:
                destination = Path(root) / 'result'
                destination.write_bytes(b'original')
                response = Response(b'new')
                if not callback:
                    response.readinto = lambda _: (_ for _ in ()).throw(OSError('read failure'))
                client = AgfsClient('secret')
                client.download = lambda *args: response
                def progress(_):
                    raise OSError('callback failure')
                with self.assertRaises(OSError):
                    client.download_file('/file', destination, on_progress=progress if callback else None)
                self.assertEqual(destination.read_bytes(), b'original')
                self.assertEqual(list(Path(root).iterdir()), [destination])

    def test_symlink_parents_and_destinations_cannot_escape_and_hardlinks_are_not_truncated(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            outside = directory / 'outside'
            outside.mkdir()
            victim = outside / 'victim'
            victim.write_bytes(b'original')
            (directory / 'parent').symlink_to(outside, target_is_directory=True)
            (directory / 'link').symlink_to(victim)
            client = AgfsClient('secret')
            client.download = lambda *args: Response(b'new', 3)
            for destination in (directory / 'parent' / 'victim', directory / 'link'):
                with self.assertRaises((ValueError, OSError)):
                    client.download_file('/file', destination)
                self.assertEqual(victim.read_bytes(), b'original')
            os.link(victim, directory / 'hardlink')
            client.download_file('/file', directory / 'hardlink')
            self.assertEqual(victim.read_bytes(), b'original')
            self.assertEqual((directory / 'hardlink').read_bytes(), b'new')

    def test_destination_swap_is_rejected_before_replace(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            victim, destination = directory / 'victim', directory / 'result'
            victim.write_bytes(b'original')
            def progress(_):
                destination.symlink_to(victim)
            client = AgfsClient('secret')
            client.download = lambda *args: Response(b'new', 3)
            with self.assertRaises(ValueError):
                client.download_file('/file', destination, on_progress=progress)
            self.assertEqual(victim.read_bytes(), b'original')
            self.assertFalse(any(p.name.startswith('.agfs-download-') for p in directory.iterdir()))

    def test_parent_segments_are_rejected_before_normalization_without_overwriting_either_target(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            parent, outside = root / 'parent', root / 'outside'
            parent.mkdir()
            (outside / 'nested').mkdir(parents=True)
            (parent / 'link').symlink_to(outside / 'nested', target_is_directory=True)
            (parent / 'file').write_bytes(b'parent original')
            (outside / 'file').write_bytes(b'outside original')
            client = AgfsClient('secret')
            client.download = lambda *args: Response(b'new', 3)
            for requested in [parent / 'link' / '..' / 'file', parent / '..' / 'parent' / 'file']:
                with self.subTest(requested=requested):
                    with self.assertRaisesRegex(ValueError, 'parent segments'):
                        client.download_file('/file', requested)
                    self.assertEqual((parent / 'file').read_bytes(), b'parent original')
                    self.assertEqual((outside / 'file').read_bytes(), b'outside original')
                    self.assertFalse(list(root.rglob('.agfs-download-*')))

    def test_staging_file_substitution_preserves_old_destination_and_unrelated_file(self):
        for replacement in ['symlink', 'regular']:
            with self.subTest(replacement=replacement), tempfile.TemporaryDirectory() as root:
                root = Path(root)
                destination, other = root / 'download', root / 'other'
                destination.write_bytes(b'old download')
                other.write_bytes(b'unrelated original')
                def progress(_):
                    stage = next(root.glob('.agfs-download-*'))
                    self.assertTrue(stage.is_dir())
                    self.assertEqual(stage.stat().st_mode & 0o077, 0)
                    content = stage / 'content'
                    content.unlink()
                    if replacement == 'symlink':
                        content.symlink_to(other)
                    else:
                        content.write_bytes(b'bad')
                client = AgfsClient('secret')
                client.download = lambda *args: Response(b'new', 3)
                with self.assertRaisesRegex(ValueError, 'staging file changed'):
                    client.download_file('/file', destination, on_progress=progress)
                self.assertFalse(destination.is_symlink())
                self.assertEqual(destination.read_bytes(), b'old download')
                self.assertEqual(other.read_bytes(), b'unrelated original')
                self.assertFalse(list(root.glob('.agfs-download-*')))

    def test_staging_directory_descriptor_survives_parent_entry_substitution(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            destination, outside = root / 'download', root / 'outside'
            destination.write_bytes(b'old download')
            outside.mkdir()
            (outside / 'content').write_bytes(b'unrelated')
            def progress(_):
                stage = next(root.glob('.agfs-download-*'))
                stage.rename(root / 'moved-private-stage')
                stage.symlink_to(outside, target_is_directory=True)
            client = AgfsClient('secret')
            client.download = lambda *args: Response(b'new', 3)
            client.download_file('/file', destination, on_progress=progress)
            self.assertEqual(destination.read_bytes(), b'new')
            self.assertFalse(destination.is_symlink())
            self.assertEqual((outside / 'content').read_bytes(), b'unrelated')
            self.assertEqual(list((root / 'moved-private-stage').iterdir()), [])

    def test_permissive_staging_directory_swap_is_rejected_before_content_creation(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            destination = root / 'download'
            destination.write_bytes(b'old')
            original_open = os.open
            def raced_open(name, flags, *args, **kwargs):
                if isinstance(name, str) and name.startswith('.agfs-download-'):
                    (root / name).rename(root / 'original-private-stage')
                    (root / name).mkdir()
                    (root / name).chmod(0o777)
                return original_open(name, flags, *args, **kwargs)
            client = AgfsClient('secret')
            client.download = lambda *args: Response(b'new', 3)
            with patch('agfs_sdk.transfer.os.open', raced_open), patch('agfs_sdk.transfer.os.supports_dir_fd', os.supports_dir_fd | {raced_open}):
                with self.assertRaisesRegex(ValueError, 'not private'):
                    client.download_file('/file', destination)
            stage = next(root.glob('.agfs-download-*'))
            self.assertEqual(list(stage.iterdir()), [])
            self.assertEqual(destination.read_bytes(), b'old')

    def test_foreign_staging_owner_is_rejected_before_content_creation(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            destination = root / 'download'
            destination.write_bytes(b'old')
            original_fstat = os.fstat
            def foreign_fstat(fd):
                import stat
                from types import SimpleNamespace
                info = original_fstat(fd)
                if stat.S_ISDIR(info.st_mode):
                    return SimpleNamespace(st_mode=info.st_mode, st_uid=info.st_uid + 1,
                                           st_ino=info.st_ino, st_dev=info.st_dev)
                return info
            client = AgfsClient('secret')
            client.download = lambda *args: Response(b'new', 3)
            with patch('agfs_sdk.transfer.os.fstat', foreign_fstat):
                with self.assertRaisesRegex(ValueError, 'not private'):
                    client.download_file('/file', destination)
            stage = next(root.glob('.agfs-download-*'))
            self.assertEqual(list(stage.iterdir()), [])
            self.assertEqual(destination.read_bytes(), b'old')

    def test_exclusive_creation_failure_does_not_unlink_a_preexisting_staging_entry(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            destination = root / 'download'
            destination.write_bytes(b'old')
            original_open = os.open
            def raced_open(name, flags, *args, **kwargs):
                if name == 'content':
                    fd = original_open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=kwargs['dir_fd'])
                    os.write(fd, b'preexisting')
                    os.close(fd)
                return original_open(name, flags, *args, **kwargs)
            client = AgfsClient('secret')
            client.download = lambda *args: Response(b'new', 3)
            with patch('agfs_sdk.transfer.os.open', raced_open), patch('agfs_sdk.transfer.os.supports_dir_fd', os.supports_dir_fd | {raced_open}):
                with self.assertRaises(FileExistsError):
                    client.download_file('/file', destination)
            self.assertEqual(next(root.glob('.agfs-download-*/content')).read_bytes(), b'preexisting')
            self.assertEqual(destination.read_bytes(), b'old')

    def test_chunk_limits_fail_before_request(self):
        client = AgfsClient('secret')
        client.download = lambda *args: self.fail('network must not run')
        for size in [0, 4095, 8388609, 4096.5, True]:
            with self.assertRaises(ValueError):
                client.download_file('/file', 'unused', chunk_size=size)

    def upload_fixture(self, parts=None, status='pending'):
        client = AgfsClient('secret', retries=0)
        calls, sent = [], []
        def json_request(path, method, body):
            calls.append((path, body))
            if path == '/fs/resumable':
                return {'uploadId': 'upl_test', 'status': status, 'partSize': PART_SIZE, 'parts': parts or []}
            return {'entry': {'path': '/file'}}
        client.json = json_request
        client.request = lambda path, method, body: (sent.append((path, body)) or Response())
        return client, calls, sent

    def test_python_resume_reads_hashes_each_part_once_and_skips_verified_puts(self):
        content = b'a' * PART_SIZE + b'changed'
        parts = [{'partNumber': 1, 'digest': hashlib.sha256(content[:PART_SIZE]).hexdigest()},
                 {'partNumber': 2, 'digest': hashlib.sha256(b'oldpart').hexdigest()}]
        client, calls, sent = self.upload_fixture(parts)
        class File(io.BytesIO):
            def __init__(self, data):
                super().__init__(data)
                self.reads = []
            def read(self, count=-1):
                self.reads.append((self.tell(), count))
                return super().read(count)
        file = File(content)
        progress = []
        with patch('builtins.open', return_value=file), patch('agfs_sdk.hashlib.sha256', wraps=hashlib.sha256) as sha:
            client.upload_file('unused', '/file', if_match=None, on_progress=progress.append)
            self.assertEqual(sha.call_count, 2)
        self.assertEqual(file.reads, [(0, PART_SIZE), (PART_SIZE, 7)])
        self.assertEqual(progress, [PART_SIZE, PART_SIZE + 7])
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0][1], b'changed')
        self.assertIsNone(calls[0][1]['ifMatch'])
        self.assertTrue(calls[-1][0].endswith('/complete'))

    def test_prefetch_overlaps_next_read_with_current_put_but_transport_stays_on_caller(self):
        ready = threading.Event()
        caller = threading.get_ident()
        class File(io.BytesIO):
            def read(self, count=-1):
                chunk = super().read(count)
                if self.tell() > PART_SIZE:
                    ready.set()
                return chunk
        client, calls, _ = self.upload_fixture()
        sent = []
        def request(path, method, body):
            self.assertEqual(threading.get_ident(), caller)
            if not sent:
                self.assertTrue(ready.wait(2), 'next read must overlap first PUT')
            sent.append(body)
            return Response()
        client.request = request
        with patch('builtins.open', return_value=File(b'a' * PART_SIZE + b'b')):
            client.upload_file('unused', '/file')
        self.assertEqual([len(b) for b in sent], [PART_SIZE, 1])

    def test_prefetch_is_optional_and_does_not_read_ahead_without_it(self):
        file = io.BytesIO(b'a' * (PART_SIZE + 1))
        first = file.read(PART_SIZE)
        parts = prepared_parts(file, PART_SIZE + 1, first, hashlib.sha256(first).hexdigest(), False)
        self.assertEqual(next(parts)[0], 1)
        self.assertEqual(file.tell(), PART_SIZE)
        self.assertEqual(next(parts)[0], 2)
        parts.close()

    def test_failure_waits_for_active_read_before_closing_file_and_never_completes(self):
        started, release = threading.Event(), threading.Event()
        class File(io.BytesIO):
            def read(self, count=-1):
                if self.tell() >= PART_SIZE:
                    started.set()
                    release.wait(5)
                return super().read(count)
        file = File(b'a' * (PART_SIZE + 1))
        client, calls, _ = self.upload_fixture()
        failures = []
        def request(*args):
            self.assertTrue(started.wait(2))
            raise OSError('PUT failed')
        client.request = request
        def upload():
            try:
                with patch('builtins.open', return_value=file):
                    client.upload_file('unused', '/file')
            except BaseException as error:
                failures.append(error)
        worker = threading.Thread(target=upload)
        worker.start()
        self.assertTrue(started.wait(2))
        self.assertFalse(file.closed)
        release.set()
        worker.join(3)
        self.assertFalse(worker.is_alive())
        self.assertTrue(file.closed)
        self.assertEqual(str(failures[0]), 'PUT failed')
        self.assertFalse(any(p.endswith('/complete') for p, _ in calls))

    def test_bad_resume_metadata_fails_before_parts_or_completion(self):
        digest = 'a' * 64
        for parts in [[{'partNumber': 1, 'digest': digest}] * 2,
                      [{'partNumber': 0, 'digest': digest}], [{'partNumber': True, 'digest': digest}],
                      [{'partNumber': 1, 'digest': 'bad'}], [None]]:
            client, calls, sent = self.upload_fixture(parts)
            with patch('builtins.open', return_value=io.BytesIO(b'abc')):
                with self.assertRaises(ValueError):
                    client.upload_file('unused', '/file')
            self.assertEqual(sent, [])
            self.assertFalse(any(p.endswith('/complete') for p, _ in calls))

    def test_resume_index_performs_one_metadata_read_per_part(self):
        class Part(dict):
            calls = 0
            def get(self, key, default=None):
                Part.calls += 1
                return super().get(key, default)
        state = {'uploadId': 'upl_test', 'status': 'pending', 'partSize': PART_SIZE,
                 'parts': [Part(partNumber=i, digest='a' * 64) for i in range(1, 1001)]}
        completed = resume_parts(state, PART_SIZE * 1000)
        self.assertEqual(Part.calls, 2000)
        for i in range(1, 1001):
            self.assertEqual(completed.get(i), 'a' * 64)
        self.assertEqual(Part.calls, 2000)

    def test_empty_upload_uses_configured_origin_for_alias_and_foreign_advertised_urls(self):
        for advertised in ['http://localhost:8787', 'https://agfs.dev', 'https://evil.example']:
            client = AgfsClient('secret', 'http://127.0.0.1:8787')
            def json_request(path, method, body):
                if path == '/fs/upload-intents':
                    return {'uploadId': 'upl_empty', 'url': advertised + '/api/v1/fs/uploads/upl_empty/blob', 'headers': {'Authorization': 'Upload cap'}}
                return {'entry': {'path': '/file'}}
            client.json = json_request
            requests = []
            def request(path, method, body, headers, authenticated):
                requests.append((path, authenticated, headers))
                return Response()
            client.request = request
            with patch('builtins.open', return_value=io.BytesIO()):
                client.upload_file('unused', '/file')
            self.assertEqual(requests, [('/api/v1/fs/uploads/upl_empty/blob', False, {'Authorization': 'Upload cap'})])

    def test_empty_upload_rejects_malformed_capabilities(self):
        for url in ['https://agfs.dev/other', 'https://u:p@agfs.dev/api/v1/fs/uploads/upl_empty/blob',
                    'https://agfs.dev/api/v1/fs/uploads/upl_empty/blob?token=x']:
            client = AgfsClient('secret')
            client.json = lambda *args: {'uploadId': 'upl_empty', 'url': url, 'headers': {}}
            with patch('builtins.open', return_value=io.BytesIO()):
                with self.assertRaises(ValueError):
                    client.upload_file('unused', '/file')

if __name__ == '__main__':
    unittest.main()
