"""Local fixture integration only; invoked by feature-expansion-clients-smoke.mjs."""
import sys

if sys.flags.optimize:
    raise SystemExit("Feature integration refuses optimized Python; assertions must remain enabled")

import hashlib
import hmac
import json
import os
import time
from urllib.parse import urlsplit

from agfs_sdk import (AgfsClient, WorkflowError, diagnose_error, read_lines,
                      read_json_lines, stage_draft, verify_webhook, with_run)

base = os.environ["AGFS_BASE_URL"]
assert urlsplit(base).scheme == "http" and urlsplit(base).hostname in ("localhost", "127.0.0.1")
assert os.environ.get("AGFS_TEST_STATE"), "Disposable integration state is required"
root = os.environ["AGFS_FEATURE_ROOT"]
cases = []


class ObservedClient(AgfsClient):
    def __init__(self):
        super().__init__(os.environ["AGFS_TOKEN"], base_url=base, retries=0)
        self.calls = []

    def request(self, path, method="GET", body=None, headers=None, **options):
        self.calls.append((method, path))
        return super().request(path, method, body, headers, **options)


client = ObservedClient()
lines = read_lines(client, root + "/lines.txt")
first = next(lines)
lines.close()
assert first["text"] == "雪🌱"
assert first["checkpoint"]["offset"] == len("雪🌱\r\n".encode())
tail = list(read_lines(client, root + "/lines.txt", checkpoint=first["checkpoint"]))
assert [row["text"] for row in tail] == ["second", "final\r"]
assert tail[-1]["line"] == 3
assert len(client.calls) == 4
cases.append("UTF-8 resume against real range GET")

malformed = dict(first["checkpoint"])
del malformed["offset"]
before = len(client.calls)
try:
    list(read_lines(client, root + "/lines.txt", checkpoint=malformed))
    raise AssertionError("Incomplete checkpoint was accepted")
except (TypeError, ValueError):
    pass
assert len(client.calls) == before
cases.append("Incomplete checkpoint refuses before transport")

records = list(read_json_lines(client, root + "/records.jsonl"))
assert [row["value"]["id"] for row in records] == [1, 2]
assert records[0]["value"]["name"] == "雪"
cases.append("JSONL actual Worker byte decoding")

try:
    client.json("/platform/runs/missing-fixture-run")
    raise AssertionError("Missing run was accepted")
except Exception as error:
    diagnostic = diagnose_error(error)
    assert diagnostic["category"] == "not_found"
    assert diagnostic["exitCode"] == 4
    assert os.environ["AGFS_TOKEN"] not in json.dumps(diagnostic)
cases.append("Structured missing-resource diagnosis excludes credentials")

stamp, secret, body = str(int(time.time())), "synthetic-python-hmac", '{"text":"雪"}'.encode()
signature = hmac.new(secret.encode(), stamp.encode() + b"." + body, hashlib.sha256).hexdigest()
headers = {"timestamp": stamp, "signature": "v1=" + "0" * 64 + ",v1=" + signature}
assert verify_webhook(secret, body, **headers)
assert not verify_webhook(secret, body + b" ", **headers)
assert not verify_webhook(secret, body, **headers, now_seconds=int(stamp) + 301)
cases.append("Offline rotating HMAC exact bytes and replay bound")

batch = {"name": "Python human review", "path": root, "changes": [
    {"path": root + "/python-staged.txt", "operation": "write", "content": "human review required"}
]}
before = len(client.calls)
try:
    stage_draft(client, {**batch, "changes": batch["changes"] + [{"path": "/outside", "operation": "write", "content": "no"}]})
    raise AssertionError("Invalid draft was accepted")
except (TypeError, ValueError):
    pass
assert len(client.calls) == before
staged = stage_draft(client, batch)
assert staged["completed"] == 1 and len(client.calls) == before + 2
assert not any("/apply" in path or "/review" in path for _, path in client.calls)
assert not any(entry["path"] == root + "/python-staged.txt" for entry in client.list(root)["entries"])
cases.append("Draft prevalidation and unapplied staging")

invocations = []
before = len(client.calls)
result = with_run(client, "Python managed run", root + "/tree", lambda run: invocations.append(run["id"]) or "done")
assert result["value"] == "done" and invocations == [result["id"]]
assert len(client.calls) == before + 2
cases.append("Managed run invokes once and completes")


def interrupted(run):
    raise KeyboardInterrupt("synthetic local interruption")


try:
    with_run(client, "Python interruption", root, interrupted)
    raise AssertionError("Interrupted run was reported successful")
except WorkflowError as error:
    diagnostic = diagnose_error(error)
    assert diagnostic["category"] == "cancelled" and diagnostic["exitCode"] == 130
    assert diagnostic["resourceId"]
    assert isinstance(error.__cause__, KeyboardInterrupt)
cases.append("Interrupted run preserves recovery ID and original cause")

print(json.dumps({"suite": "Feature Python integration", "passed": len(cases), "cases": cases,
                  "requests": len(client.calls)}, ensure_ascii=False))
