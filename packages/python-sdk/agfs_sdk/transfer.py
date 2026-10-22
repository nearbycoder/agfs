"""Bounded transfer primitives. No network credentials or cached authorization live here."""
from __future__ import annotations
import concurrent.futures
import hashlib
import errno
import os
from pathlib import Path
import secrets
import stat

PART_SIZE = 8388608


def prepared_parts(file, size, first, first_digest, prefetch):
    """One optional read/hash worker; at most current and next part are retained."""
    def prepare(start):
        file.seek(start)
        chunk = file.read(min(PART_SIZE, size - start))
        if len(chunk) != min(PART_SIZE, size - start):
            raise ValueError('Local file changed during upload')
        return chunk, hashlib.sha256(chunk).hexdigest()

    pool = concurrent.futures.ThreadPoolExecutor(max_workers=1) if prefetch and size > PART_SIZE else None
    pending = None
    try:
        current = (first, first_digest)
        first = None
        for start in range(0, size, PART_SIZE):
            next_start = start + PART_SIZE
            if pool and next_start < size:
                pending = pool.submit(prepare, next_start)
            yield start // PART_SIZE + 1, current[0], current[1]
            current = None
            if next_start < size:
                current = pending.result() if pending is not None else prepare(next_start)
                pending = None
    finally:
        if pending is not None:
            pending.cancel()
        if pool is not None:
            pool.shutdown(wait=True, cancel_futures=True)


def resume_parts(state, size):
    count = (size + PART_SIZE - 1) // PART_SIZE
    upload_id = state.get('uploadId')
    import re
    if (state.get('partSize') != PART_SIZE or not isinstance(upload_id, str)
            or not re.fullmatch(r'upl_[\w-]+', upload_id, flags=re.ASCII)
            or state.get('status') not in ('pending', 'completing')
            or not isinstance(state.get('parts'), list) or len(state['parts']) > count):
        raise ValueError('Invalid upload response')
    completed = {}
    for part in state['parts']:
        if not isinstance(part, dict):
            raise ValueError('Invalid upload response')
        number, digest = part.get('partNumber'), part.get('digest')
        if (type(number) is not int or not 1 <= number <= count or number in completed
                or not isinstance(digest, str) or not re.fullmatch('[a-f0-9]{64}', digest)):
            raise ValueError('Invalid upload response')
        completed[number] = digest
    return completed


def atomic_download(response, destination, chunk_size, on_progress):
    """Anchor traversal/staging/rename to descriptors, refusing symlinks and '..'."""
    destination = Path(destination)
    if '..' in destination.parts:
        raise ValueError('Download destination must not contain parent segments')
    if not hasattr(os, 'O_NOFOLLOW') or os.open not in os.supports_dir_fd:
        raise NotImplementedError('Atomic download requires no-follow directory descriptors')
    destination = Path(os.path.abspath(destination))
    if not destination.name:
        raise ValueError('Download destination must name a file')
    directory = os.open(destination.anchor, os.O_RDONLY | os.O_DIRECTORY)
    temporary = None
    staging = None
    staging_identity = None
    staging_trusted = False
    content_created = False
    try:
        for name in destination.parts[1:-1]:
            try:
                os.mkdir(name, mode=0o700, dir_fd=directory)
            except FileExistsError:
                pass
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child

        def check_destination():
            try:
                existing = os.stat(destination.name, dir_fd=directory, follow_symlinks=False)
            except FileNotFoundError:
                return
            if not stat.S_ISREG(existing.st_mode):
                raise ValueError('Download destination is not a regular file')

        check_destination()
        length = response.headers.get('Content-Length')
        expected = None
        if length is not None:
            try:
                expected = int(length)
            except (ValueError, TypeError):
                raise ValueError('Invalid download size')
            if expected < 0:
                raise ValueError('Invalid download size')
        name = '.agfs-download-' + secrets.token_hex(16)
        os.mkdir(name, mode=0o700, dir_fd=directory)
        temporary = name
        staging = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
        staging_identity = os.fstat(staging)
        if (not stat.S_ISDIR(staging_identity.st_mode) or staging_identity.st_uid != os.geteuid()
                or staging_identity.st_mode & 0o077):
            raise ValueError('Download staging directory is not private')
        staging_trusted = True
        descriptor = os.open('content', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=staging)
        content_created = True
        total = 0
        with os.fdopen(descriptor, 'wb') as file:
            original = os.fstat(file.fileno())
            buffer = bytearray(chunk_size)
            while True:
                count = response.readinto(buffer)
                if type(count) is not int or not 0 <= count <= len(buffer):
                    raise ValueError('Invalid download read')
                if not count:
                    break
                total += count
                if expected is not None and total > expected:
                    raise ValueError('Download size mismatch')
                file.write(memoryview(buffer)[:count])
                if on_progress:
                    on_progress(total)
            if expected is not None and total != expected:
                raise ValueError('Download size mismatch')
            file.flush()
            # The rename source must still name the exact regular inode we wrote.
            # Keep the descriptor open through replacement to prevent inode reuse.
            staged = os.stat('content', dir_fd=staging, follow_symlinks=False)
            if (not stat.S_ISREG(staged.st_mode) or staged.st_dev != original.st_dev
                    or staged.st_ino != original.st_ino or staged.st_size != total):
                raise ValueError('Download staging file changed')
            check_destination()
            os.replace('content', destination.name, src_dir_fd=staging, dst_dir_fd=directory)
            content_created = False
        return destination
    finally:
        try:
            if staging is not None:
                try:
                    if content_created:
                        os.unlink('content', dir_fd=staging)
                except FileNotFoundError:
                    pass
                finally:
                    os.close(staging)
        finally:
            try:
                if temporary is not None and staging_trusted:
                    try:
                        current = os.stat(temporary, dir_fd=directory, follow_symlinks=False)
                    except FileNotFoundError:
                        current = None
                    # Never clean up a substituted parent-directory entry.
                    if (current is not None and current.st_dev == staging_identity.st_dev
                            and current.st_ino == staging_identity.st_ino):
                        try:
                            os.rmdir(temporary, dir_fd=directory)
                        except OSError as error:
                            # A raced O_EXCL entry belongs to someone else; leave
                            # it intact and preserve the original creation error.
                            if error.errno not in (errno.ENOTEMPTY, errno.EEXIST, errno.ENOENT):
                                raise
            finally:
                os.close(directory)
