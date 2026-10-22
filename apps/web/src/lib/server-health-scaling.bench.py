"""Read-work scaling regression for health evaluation (#43).

Run: python3 apps/web/src/lib/server-health-scaling.bench.py
Uses migrated in-memory SQLite only. Extracts the current tagged production SQL;
mirrors its bounded source merge, and compares every evaluated owner's aggregates
with the previous per-owner reads. Actual JS merge/alert writes are covered by
server-expansion.test.ts. Counts SQL VM instructions, not latency/billing. Alert
mutation work is excluded from both sides. No production data/services accessed.
"""
from collections import Counter
from pathlib import Path
import json
import re
import sqlite3

ROOT = Path(__file__).resolve().parents[4]
SOURCE = (ROOT / "apps/web/src/lib/operations.ts").read_text()
QUERIES = {
    name: re.sub(r"\$\{[^}]+\}", "?", query)
    for name, query in re.findall(r"sql`/\* health-([a-z-]+) \*/(.*?)`", SOURCE, re.S)
}
assert len(QUERIES) == 6, "Production health SQL changed; update this benchmark"
SOURCES = ["metrics", "indexing", "alerts", "webhooks"]
SINCE = 90


def fixture(kind, size, job_count=1, dispersed=False):
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    for migration in sorted((ROOT / "packages/db/src/migrations").glob("*.sql")):
        db.executescript(migration.read_text())
    if kind == "balanced":
        db.executemany("INSERT INTO operation_metrics VALUES(?,100,'api',10,1,0,200)",
                       [(f"owner-{i:06d}",) for i in range(size)])
    elif kind == "skewed":
        # One recent owner followed by a large old-only suffix. Independently,
        # jobs and alerts supply many earlier owners across multiple pages.
        db.execute("INSERT INTO operation_metrics VALUES('active-000000',100,'api',10,0,0,200)")
        db.executemany("INSERT INTO operation_metrics VALUES(?,0,'api',10,0,0,200)",
                       [(f"zz-old-{i:06d}",) for i in range(size * 20)])
        for i in range(size):
            owner = f"active-{i:06d}"
            db.execute("INSERT INTO user(id,email) VALUES(?,?)", (owner, owner + "@example.test"))
            db.execute("INSERT INTO entries(id,owner_id,path,name,kind) VALUES(?,?,'/file','file','file')", (owner, owner))
            db.execute("INSERT INTO health_alerts VALUES(?,?,'errors','old',1,NULL)", (owner, owner))
    elif kind in ("empty_jobs", "sparse_jobs"):
        owners = [f"zz-files-{i:06d}" for i in range(job_count if dispersed else 1)]
        db.executemany("INSERT INTO user(id,email) VALUES(?,?)", [(owner, owner + "@example.test") for owner in owners])
        db.executemany("INSERT INTO entries(id,owner_id,path,name,kind) VALUES(?,?,?,'file','file')",
                       [(f"file-{i:06d}", owners[i % len(owners)], f"/{i:06d}") for i in range(size)])
        db.execute("DELETE FROM index_jobs")
        if kind == "sparse_jobs":
            db.executemany("INSERT INTO index_jobs(entry_id) VALUES(?)", [(f"file-{i:06d}",) for i in range(size - job_count, size)])
        db.executemany("INSERT INTO health_alerts VALUES(?,?,'errors','old',1,NULL)",
                       [(f"alert-{i:06d}", f"active-{i:06d}") for i in range(301)])
    else:
        raise AssertionError(kind)
    db.commit()
    return db


def measure(db, execute):
    steps = 0

    def step():
        nonlocal steps
        steps += 1
        return 0

    db.set_progress_handler(step, 1)
    try:
        result = execute()
    finally:
        db.set_progress_handler(None, 0)
    return steps, result


def previous(db):
    # Frozen pre-expansion candidate and four per-owner read statements.
    # These fixtures have no webhook-only owners, so the known omission does
    # not distort the cost/equivalence comparison.
    owners = db.execute("""SELECT owner_id FROM operation_metrics WHERE minute>=?
      UNION SELECT e.owner_id FROM index_jobs j JOIN index_job_status s ON s.entry_id=j.entry_id
        JOIN entries e ON e.id=j.entry_id
      UNION SELECT owner_id FROM health_alerts WHERE resolved_at IS NULL""", (SINCE,)).fetchall()
    result = {}
    for (owner,) in owners:
        threshold = db.execute("SELECT * FROM health_thresholds WHERE owner_id=?", (owner,)).fetchone()
        thresholds = threshold[1:] if threshold else (10, 100, 2000)
        metric = db.execute("""SELECT coalesce(sum(requests),0),coalesce(sum(errors),0),coalesce(sum(duration_ms),0)
          FROM operation_metrics WHERE owner_id=? AND minute>=?""", (owner, SINCE)).fetchone()
        jobs = db.execute("""SELECT count(*) FROM index_jobs j JOIN index_job_status s ON s.entry_id=j.entry_id
          JOIN entries e ON e.id=j.entry_id WHERE e.owner_id=?""", (owner,)).fetchone()[0]
        failed = db.execute("""SELECT count(*) FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id
          WHERE w.owner_id=? AND d.status='failed'""", (owner,)).fetchone()[0]
        result[owner] = (*thresholds, *metric, jobs, bool(failed))
    return result


def current(db):
    counts = Counter()
    plans = {}

    def query(name, params):
        counts[name] += 1
        # Collect plans separately below; EXPLAIN must not affect VM counts.
        plans.setdefault(name, params)
        return db.execute(QUERIES[name], params).fetchall()

    availability = query("source-availability", (SINCE,))[0]
    sources = [{"name": name, "after": "", "owners": [], "position": 0, "exhausted": not available}
               for name, available in zip(SOURCES, availability)]
    result = {}
    peak = 0
    while True:
        selected = []
        while len(selected) < 100:
            for source in sources:
                if source["exhausted"] or source["position"] < len(source["owners"]):
                    continue
                params = (source["after"], SINCE) if source["name"] == "metrics" else (source["after"],)
                source["owners"] = [row[0] for row in query("source-" + source["name"], params)]
                source["position"] = 0
                source["exhausted"] = len(source["owners"]) < 100
                if source["owners"]:
                    source["after"] = source["owners"][-1]
            peak = max(peak, sum(len(source["owners"]) for source in sources))
            heads = [source for source in sources if source["position"] < len(source["owners"])]
            if not heads:
                break
            owner = min(source["owners"][source["position"]] for source in heads)
            for source in heads:
                if source["owners"][source["position"]] == owner:
                    source["position"] += 1
            selected.append(owner)
        if not selected:
            break
        for owner, error, backlog, latency, metric, jobs, failed in query("owner-evaluation", (SINCE, json.dumps(selected))):
            assert owner not in result, "Each owner must be evaluated once"
            result[owner] = (error, backlog, latency, *json.loads(metric), jobs, bool(failed))
    return result, dict(counts), peak, plans


results = []
cases = [("balanced", (1000, 5000), 0, False), ("skewed", (500, 2500), 0, False),
         ("empty_jobs", (10000, 50000), 1, False), ("sparse_jobs", (10000, 50000), 1, False)]
cases += [("sparse_jobs", (50000, 100000), jobs, dispersed)
          for jobs in (101, 1000) for dispersed in (False, True)]
for analyzed in (False, True):
    for kind, sizes, job_count, dispersed in cases:
        pair = []
        for size in sizes:
            db = fixture(kind, size, job_count, dispersed)
            if analyzed:
                db.execute("ANALYZE")
            before_steps, before = measure(db, lambda: previous(db))
            after_steps, (after, counts, peak, plan_params) = measure(db, lambda: current(db))
            assert after == before, "Owner signals/thresholds changed"
            assert peak <= 400
            if kind == "skewed":
                assert counts["source-metrics"] == 1, "Exhausted old-metric suffix was rescanned"
            if kind == "empty_jobs":
                assert "source-indexing" not in counts, "Empty jobs must skip the entries source"
            plans = {name: [row[3] for row in db.execute("EXPLAIN QUERY PLAN " + QUERIES[name], params)]
                     for name, params in plan_params.items()}
            evaluation_plan = "\n".join(plans["owner-evaluation"])
            assert "sqlite_autoindex_operation_metrics_1 (owner_id=? AND minute>?)" in evaluation_plan
            assert "webhooks_owner_enabled_idx (owner_id=?)" in evaluation_plan
            assert "sqlite_autoindex_webhook_deliveries_2 (webhook_id=?)" in evaluation_plan
            assert "index_job_owners_owner_entry_idx (owner_id=?)" in evaluation_plan
            assert "entries" not in evaluation_plan
            if "source-indexing" in plans:
                assert "index_job_owners_owner_entry_idx (owner_id>?)" in "\n".join(plans["source-indexing"])
                assert "entries" not in "\n".join(plans["source-indexing"])
            result = {"fixture": kind, "size": size, "jobs": db.execute("SELECT count(*) FROM index_jobs").fetchone()[0], "dispersed": dispersed,
                      "analyzed": analyzed, "evaluated_owners": len(after),
                      "baseline_read_vm": before_steps, "current_read_vm": after_steps,
                      "read_queries": counts, "peak_buffered_candidates": peak}
            if size == sizes[-1] and analyzed:
                result["plans"] = plans
            results.append(result)
            pair.append(after_steps)
            db.close()
        # Five times the rows/owners should remain near five times the read work,
        # not the quadratic ~25x from global scans repeated on every owner page.
        assert pair[1] <= pair[0] * 5.2, (kind, pair)
        if kind in ("empty_jobs", "sparse_jobs"):
            assert pair[1] <= pair[0] * 1.02, "Unused entries should not affect health reads"

print(json.dumps({"sqlite": sqlite3.sqlite_version, "measurement": "read-only SQL VM instructions", "results": results}, indent=2))
