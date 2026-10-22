"""Synthetic SQLite VM-work evidence for additional server improvements 46/48/51/54.

Run: python3 apps/web/src/lib/server-expansion.bench.py
All migrations and fixtures run in memory. No app/Cloudflare data is accessed.
Each comparison executes identical SQL with and without ONLY its new index(es).
VM instructions are not D1 billed rows, database latency, or production speedups.
"""
from pathlib import Path
import json
import sqlite3

root = Path(__file__).resolve().parents[4]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
for migration in sorted((root / "packages/db/src/migrations").glob("*.sql")):
    db.executescript(migration.read_text())
db.execute("INSERT INTO user(id,email) VALUES('alice','alice@example.test'),('bob','bob@example.test')")
db.execute("INSERT INTO entries(id,owner_id,path,name,kind) VALUES('mine','alice','/file','file','file'),('other','bob','/file','file','file')")

count = 10000
# Retention fixtures contain ten expired records among 9,990 live records.
for i in range(count):
    at = 0 if i < 10 else 9000000000000
    tenant = f"fixture-owner-{i // 10}"
    db.execute("INSERT OR IGNORE INTO user(id,email) VALUES(?,?)", (tenant, f"{tenant}@example.test"))
    db.execute("INSERT INTO object_pins VALUES('alice',?,?,?)", (f"run-{i}", f"key-{i}", at))
    db.execute("INSERT INTO change_log(owner_id,path,operation,created_at) VALUES('alice',?,'delete',?)", (f"/{i}", at))
    db.execute("INSERT INTO operation_metrics(owner_id,minute,route) VALUES(?,?,'api')", (f"owner-{i}", at))
    db.execute("INSERT INTO queue_outbox VALUES(?,'index',?,NULL)", (f"queue-{i}", at))
    db.execute("INSERT INTO activity(id,owner_id,action,actor,created_at) VALUES(?,'alice','file.read','Alice',?)", (f"event-{i}", at))
    owner, entry = ("alice", "mine") if i < 10 else ("bob", "other")
    db.execute("INSERT INTO share_links(id,owner_id,entry_id,token_hash,prefix,expires_at) VALUES(?,?,?,?,'share',9000000000000)", (f"share-{i}", owner, entry, f"hash-{i}"))
    db.execute("INSERT INTO share_link_views(id,share_id) VALUES(?,?)", (f"view-{i}", f"share-{i}"))
    db.execute("""INSERT INTO uploads(id,owner_id,path,content_type,size,object_key,expires_at,multipart_id,fingerprint)
      VALUES(?,?,?,'text/plain',10,?,9000000000000,'multipart',?)""",
      (f"upload-{i}", "alice" if i == count - 1 else tenant, f"/upload-{i}", f"object-{i}", f"fingerprint-{i}"))
    db.execute("""INSERT INTO webhooks(id,owner_id,url,path_prefix,events,secret,created_at)
      VALUES(?,?,'https://hooks.agfs.dev','/','["*"]','test-secret',1)""", (f"hook-{i}", "alice" if i < 10 else tenant))
    db.execute("""INSERT INTO webhook_deliveries(id,webhook_id,event_id,payload,next_attempt,created_at)
      VALUES(?,'hook-0',?,'{}',0,?)""", (f"delivery-{i}", f"delivery-event-{i}", at))
    # Keep historical fixture insertion out of the webhook fanout path.
    db.execute("UPDATE webhooks SET enabled=0 WHERE id=?", (f"hook-{i}",))
db.execute("UPDATE webhooks SET enabled=1")
db.commit()


def measure(query, params=()):
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
    return {"vm_instructions": steps, "returned_rows": len(result), "plan": plan}, sorted(result)


def compare(query, params, indexes):
    definitions = [db.execute("SELECT sql FROM sqlite_master WHERE name=?", (name,)).fetchone()[0] for name in indexes]
    after, after_result = measure(query, params)
    for name in indexes:
        db.execute(f"DROP INDEX {name}")
    # A comment forces recompilation rather than Python sqlite3's statement cache.
    before, before_result = measure(query + " -- before", params)
    assert before_result == after_result
    for definition in definitions:
        db.execute(definition)
    assert after["vm_instructions"] < before["vm_instructions"]
    return {"before": before, "after": after}


result = {
    "sqlite": sqlite3.sqlite_version,
    "fixture_rows_per_workload": count,
    "#46_share_lifecycle": {
        "owner_listing": compare("SELECT s.id,e.path FROM share_links s JOIN entries e ON e.id=s.entry_id WHERE s.owner_id=?", ("alice",), ["share_links_owner_idx"]),
        "entry_revocation_lookup": compare("SELECT id FROM share_links WHERE entry_id=?", ("mine",), ["share_links_entry_idx"]),
        "view_cascade_lookup": compare("SELECT id FROM share_link_views WHERE share_id=?", ("share-0",), ["share_link_views_share_idx"]),
    },
    "#48_upload_resume": compare("""SELECT * FROM uploads WHERE owner_id=? AND path=? AND fingerprint=?
      AND size=10 AND content_type='text/plain' AND condition_mode='any' AND expected_etag IS NULL
      AND status IN ('pending','completing') AND expires_at>1 AND multipart_id IS NOT NULL LIMIT 1""",
      ("alice", "/upload-9999", "fingerprint-9999"), ["uploads_resume_idx"]),
    "#51_retention_sweeps": {},
}
for table, column, index in [
    ("object_pins", "expires_at", "object_pins_expiry_idx"),
    ("change_log", "created_at", "change_log_expiry_idx"),
    ("operation_metrics", "minute", "operation_metrics_minute_idx"),
    ("queue_outbox", "created_at", "queue_outbox_created_idx"),
    ("webhook_deliveries", "created_at", "webhook_deliveries_created_idx"),
    ("activity", "created_at", "activity_created_idx"),
]:
    result["#51_retention_sweeps"][table] = compare(f"SELECT rowid FROM {table} WHERE {column}<? LIMIT 1000", (1,), [index])


def fanout():
    db.execute("SAVEPOINT fanout")
    cost, _ = measure("INSERT INTO activity(id,owner_id,action,actor,path,created_at) VALUES('fanout','alice','file.read','Alice','/file',1)")
    events = db.execute("SELECT webhook_id,event_id FROM webhook_deliveries WHERE event_id='fanout' ORDER BY webhook_id").fetchall()
    db.execute("ROLLBACK TO fanout")
    db.execute("RELEASE fanout")
    return cost, events


after, events = fanout()
db.execute("DROP INDEX webhooks_owner_enabled_idx")
before, old_events = fanout()
assert events == old_events and len(events) == 10
assert after["vm_instructions"] < before["vm_instructions"]
result["#54_webhook_activity_fanout"] = {"delivered_events": len(events), "before": before, "after": after}
print(json.dumps(result, indent=2))
db.close()
