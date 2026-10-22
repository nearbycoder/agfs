"""Local integration process owner. Linux only; no application imports or network.

The guardian is a child subreaper. Only this single thread reaps its children.
A PID read from its own /proc children list cannot be recycled before we reap
that child. Opening a pidfd while that relationship holds pins its identity;
all later signals use the fd, never a saved PID/PGID or a start-time check.
"""
import ctypes
import errno
import json
import os
import selectors
import signal
import subprocess
import sys
import time
from pathlib import Path


def verify_capabilities():
    """Exercise kernel policy before any workload Popen or ready message.

    The two tiny fork probes execute no command. They exit on their own within
    250ms if a signal is denied, and are reaped before this function returns.
    Failure cleanup never signals a saved number, even if pidfds are unusable.
    """
    if sys.platform != "linux" or not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
        raise RuntimeError("Integration guardian requires Linux pidfds and child subreaping")
    signal.signal(signal.SIGCHLD, signal.SIG_DFL)
    libc = ctypes.CDLL(None, use_errno=True)
    subreaper = ctypes.c_int(0)
    if libc.prctl(36, 1, 0, 0, 0) != 0 or libc.prctl(37, ctypes.byref(subreaper), 0, 0, 0) != 0 or subreaper.value != 1:
        raise RuntimeError("Cannot establish and verify integration child-subreaper ownership")
    children_path = Path(f"/proc/self/task/{os.getpid()}/children")
    if children_path.read_text().split():
        raise RuntimeError("Guardian capability check requires no existing children")
    # Verify syscall availability/policy before even creating an internal probe.
    own_fd = os.pidfd_open(os.getpid())
    try:
        signal.pidfd_send_signal(own_fd, 0)
    finally:
        os.close(own_fd)
    for sig in (signal.SIGTERM, signal.SIGKILL):
        read_fd, write_fd = os.pipe()
        try:
            pid = os.fork()
        except BaseException:
            os.close(read_fd)
            os.close(write_fd)
            raise
        if pid == 0:
            try:
                os.close(read_fd)
                os.close(0)
                os.close(3)
                signal.signal(signal.SIGTERM, lambda *_: os._exit(0))
                os.write(write_fd, b"1")
                os.close(write_fd)
                time.sleep(0.25)
            finally:
                os._exit(90)
        os.close(write_fd)
        pidfd = None
        reaped = False

        def wait_probe():
            nonlocal reaped
            deadline = time.monotonic() + 1
            while time.monotonic() < deadline:
                found, status = os.waitpid(pid, os.WNOHANG)
                if found:
                    reaped = True
                    return os.waitstatus_to_exitcode(status)
                time.sleep(0.005)
            raise RuntimeError("Internal capability probe did not exit; no workload may launch")

        try:
            with selectors.DefaultSelector() as ready:
                ready.register(read_fd, selectors.EVENT_READ)
                if not ready.select(1) or os.read(read_fd, 1) != b"1":
                    raise RuntimeError("Internal capability probe did not become ready")
            if pid not in [int(value) for value in children_path.read_text().split()]:
                raise RuntimeError("Proc did not expose the guardian's unreaped child")
            # The single waiter has not reaped this direct child, reserving its
            # identity until the fd is pinned. No check-then-numeric-signal path.
            pidfd = os.pidfd_open(pid)
            signal.pidfd_send_signal(pidfd, sig)
            expected = 0 if sig == signal.SIGTERM else -signal.SIGKILL
            if wait_probe() != expected:
                raise RuntimeError("Kernel did not deliver the required pidfd signal")
        finally:
            os.close(read_fd)
            if pidfd is not None:
                os.close(pidfd)
            if not reaped:
                wait_probe()  # Bounded self-exit; never a numeric signal fallback.
    if children_path.read_text().split():
        raise RuntimeError("Capability probes left unreaped children")
    return children_path


def main():
    grace = min(max(int(sys.argv[1]), 0), 30000) / 1000
    kill_wait = min(max(int(sys.argv[2]), 100), 10000) / 1000
    children_path = None
    owned = {}
    command_pid = None
    command_exited = False
    stopping = False
    requested_stop = False
    failed = False
    telemetry_open = True
    buffer = b""
    started = time.monotonic()
    deadline = None
    selector = selectors.DefaultSelector()
    os.set_blocking(0, False)
    os.set_blocking(3, False)
    selector.register(0, selectors.EVENT_READ)

    def send(record):
        nonlocal telemetry_open, requested_stop, failed
        if not telemetry_open:
            return
        try:
            os.write(3, (json.dumps(record, separators=(",", ":")) + "\n").encode())
        except OSError:
            # Missing/backpressured owner must not prevent bounded child cleanup.
            telemetry_open = False
            requested_stop = True
            failed = True

    def request_stop(_signum=None, _frame=None):
        nonlocal requested_stop
        requested_stop = True

    for name in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(name, request_stop)

    def begin_stop():
        nonlocal stopping, deadline
        if not stopping:
            stopping = True
            deadline = time.monotonic() + grace

    def discover():
        # No wait/reap runs between this read and pidfd_open, including handlers.
        for text in children_path.read_text().split():
            pid = int(text)
            if pid not in owned:
                owned[pid] = {"fd": os.pidfd_open(pid), "term": False, "kill": False, "signals": []}

    def reap():
        nonlocal command_exited
        while True:
            try:
                pid, status = os.waitpid(-1, os.WNOHANG)
            except ChildProcessError:
                return
            if pid == 0:
                return
            record = owned.pop(pid, None)
            if record is not None:
                os.close(record["fd"])
            if pid == command_pid and not command_exited:
                command_exited = True
                code = os.waitstatus_to_exitcode(status)
                child.returncode = code  # This single thread owns all reaping.
                send({"type": "exit", "code": code if code >= 0 else None,
                      "signal": signal.Signals(-code).name if code < 0 else None,
                      "terminationSignals": record["signals"] if record else []})
                # Descendants may still hold pipes. Cleanup starts at actual exit.
                begin_stop()

    def signal_children(force):
        discover()
        key, sig = ("kill", signal.SIGKILL) if force else ("term", signal.SIGTERM)
        for record in owned.values():
            if not record[key]:
                try:
                    signal.pidfd_send_signal(record["fd"], sig)
                except ProcessLookupError:
                    pass  # The pinned child exited; reap still establishes closure.
                else:
                    # Evidence is specific to this pinned process and a completed
                    # signal syscall; an attempted signal to an exited child is
                    # not evidence for a wrapper's conventional TERM exit143.
                    record["signals"].append(signal.Signals(sig).name)
                record[key] = True

    try:
        children_path = verify_capabilities()
    except Exception as error:
        send({"type": "failure", "code": "PREREQUISITE", "error": type(error).__name__ + ": " + str(error)[:200]})
        selector.close()
        return 1
    send({"type": "guardian", "pid": os.getpid(), "ready": True})
    try:
        while True:
            reap()
            if requested_stop:
                begin_stop()
            if not command_pid and not stopping and time.monotonic() - started > 2:
                failed = True
                send({"type": "failure", "error": "Guardian startup control deadline exceeded"})
                begin_stop()
            if stopping:
                signal_children(time.monotonic() >= deadline)
                reap()
                if not children_path.read_text().split():
                    send({"type": "stopped", "commandExited": command_exited, "childrenReaped": True})
                    return 1 if failed else 0
                if time.monotonic() >= deadline + kill_wait:
                    send({"type": "failure", "error": "Owned descendants did not exit before guardian deadline"})
                    return 1
            for _, _ in selector.select(0.02):
                data = os.read(0, 65536)
                if not data:
                    selector.unregister(0)
                    begin_stop()
                    break
                buffer += data
                if len(buffer) > 65536:
                    raise ValueError("Guardian control record exceeds its bound")
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    message = json.loads(line)
                    if message.get("type") == "stop":
                        begin_stop()
                    elif message.get("type") == "start" and command_pid is None and not stopping and not requested_stop:
                        try:
                            child = subprocess.Popen([message["command"], *message["args"]], stdin=subprocess.DEVNULL,
                                                     close_fds=True)
                        except OSError as error:
                            failed = True
                            send({"type": "spawn-error", "code": errno.errorcode.get(error.errno, "SPAWN"), "error": error.strerror})
                            begin_stop()
                        else:
                            command_pid = child.pid
                            send({"type": "spawn", "pid": child.pid})
                    elif message.get("type") != "start" or not stopping:
                        raise ValueError("Invalid or repeated guardian control record")
    except Exception as error:
        failed = True
        send({"type": "failure", "error": type(error).__name__ + ": " + str(error)[:200]})
        # Even control/protocol errors retain the same bounded owned-child cleanup.
        begin_stop()
        while time.monotonic() < deadline + kill_wait:
            signal_children(time.monotonic() >= deadline)
            reap()
            if not children_path.read_text().split():
                send({"type": "stopped", "commandExited": command_exited, "childrenReaped": True})
                return 1
            time.sleep(0.02)
        return 1
    finally:
        selector.close()
        for record in owned.values():
            os.close(record["fd"])


if __name__ == "__main__":
    raise SystemExit(main())
