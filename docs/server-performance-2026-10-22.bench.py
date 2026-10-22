"""Reproduce SQLite VM-work comparisons; this is not a D1 latency benchmark.

Run from any directory with Python 3: python3 docs/server-performance-2026-10-22.bench.py
Uses the repository migrations and synthetic data in an in-memory database only.
The SQL mirrors path-range.ts and storage-usage.ts; the Vitest suite separately
executes the production-generated SQL and verifies the same query plans.
"""

from pathlib import Path
import json
import sqlite3

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
for migration in sorted((root / "packages/db/src/migrations").glob("*.sql")):
    db.executescript(migration.read_text())
db.execute("INSERT INTO user(id,email) VALUES('alice','alice@example.test')")
db.executemany(
    "INSERT INTO entries(id,owner_id,path,name,kind) VALUES(?,'alice',?,?,'file')",
    ((f"entry-{i}", f"/folder-{i // 10:04d}/file-{i % 10}", f"file-{i % 10}") for i in range(10000)),
)
db.executemany(
    "INSERT INTO object_usage VALUES(?,?,NULL,10)",
    ((f"object-{i}", "alice" if i < 10 else f"owner-{i // 10}") for i in range(10000)),
)
db.executemany(
    "INSERT INTO object_pins VALUES('alice','run',?,9007199254740991)",
    ((f"object-{i}",) for i in range(10)),
)


def measure(query, params):
    steps = 0

    def step():
        nonlocal steps
        steps += 1
        return 0

    plan = [row[3] for row in db.execute("EXPLAIN QUERY PLAN " + query, params)]
    db.set_progress_handler(step, 1)
    try:
        result = db.execute(query, params).fetchall()
    finally:
        db.set_progress_handler(None, 0)
    return {"vm_instructions": steps, "returned_rows": len(result), "plan": plan}, result


old_path = """SELECT path FROM entries WHERE owner_id=?
AND (path=? OR substr(path,1,length(?))=?) ORDER BY path"""
new_path = """SELECT path FROM entries WHERE owner_id=? AND path>=? AND path<?
AND (path=? OR path>=?) ORDER BY path"""
old_path_cost, old_result = measure(old_path, ("alice", "/folder-0500", "/folder-0500/", "/folder-0500/"))
new_path_cost, new_result = measure(new_path, ("alice", "/folder-0500", "/folder-05000", "/folder-0500", "/folder-0500/"))
assert new_result == old_result and len(new_result) == 10

# A separate quota fixture: a small owner with ten live/pinned objects among
# 10,000 global usage records. Keep the physical-object overlaps intentional.
db.execute("DELETE FROM entries")
db.executemany(
    "INSERT INTO entries(id,owner_id,path,name,kind,size,r2_key) VALUES(?,'alice',?,?,'file',10,?)",
    ((f"live-{i}", f"/live-{i}", f"live-{i}", f"object-{i}") for i in range(10)),
)
usage = """SELECT coalesce(sum(bytes),0) FROM (
SELECT r2_key,max(size) AS bytes FROM (
SELECT r2_key,size FROM entries WHERE owner_id=? AND kind='file'
UNION ALL SELECT r2_key,size FROM recovery WHERE owner_id=? AND kind='file'
UNION ALL SELECT u.object_key,u.size FROM object_usage u WHERE u.owner_id=?
AND EXISTS(SELECT 1 FROM object_pins p WHERE p.object_key=u.object_key AND p.expires_at>unixepoch()*1000)
) GROUP BY r2_key)"""
new_usage_cost, new_result = measure(usage, ("alice",) * 3)
db.execute("DROP INDEX object_usage_owner_key_size_idx")
old_usage_cost, old_result = measure(usage, ("alice",) * 3)
assert new_result == old_result == [(100,)]

print(json.dumps({
    "sqlite": sqlite3.sqlite_version,
    "fixture": {"tree_entries": 10000, "selected_subtree_entries": 10, "quota_live_entries": 10, "object_usage_rows": 10000, "selected_owner_usage_rows": 10},
    "subtree": {"before": old_path_cost, "after": new_path_cost},
    "storage_usage": {"before": old_usage_cost, "after": new_usage_cost},
}, indent=2))
db.close()
