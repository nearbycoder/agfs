"""Reproducible local SQL work for the resource-control scheduler.

Runs SQL extracted from production TS against migrated in-memory SQLite. The
Python driver mirrors the bounded scheduling algorithm; the real JS is exercised
by server-feature-expansion-background.test.ts. Counts ALL dispatcher/health SQL,
batch round trips, returned rows, SQLite total_changes (including trigger/FTS
writes), and VM instructions. Returned rows are NOT D1 rows_read, VM instructions
are NOT CPU time, and local storage pages are NOT billed storage. Queue sends are
simulated. Source completion is a separate, explicitly counted deletion; R2/index
body work is measured by the real-JS memory/op test. No account data/network.
"""
from pathlib import Path
import json
import re
import sqlite3
import time

ROOT = Path(__file__).resolve().parents[4]
# Control SQL and driver clocks together; fixture construction time is excluded.
CLOCK = [1800000000000]
BG = (ROOT / "apps/web/src/lib/resource-controls-background.ts").read_text()
HEALTH = (ROOT / "apps/web/src/lib/resource-controls-scheduler.ts").read_text()
RETENTION = (ROOT / "apps/web/src/lib/resource-controls-retention.ts").read_text()
RESOURCES = (ROOT / "apps/web/src/lib/resource-controls.ts").read_text()


def template(source, prefix):
    found = [q for q in re.findall(r"sql`(.*?)`", source, re.S) if q.startswith(prefix)]
    assert len(found) == 1, (prefix, len(found))
    return found[0]


def compile_sql(source, values):
    params = []
    def replace(match):
        expression = match.group(1)
        assert expression in values, expression
        params.append(values[expression])
        return "?"
    return re.sub(r"\$\{(.*?)\}", replace, source), params


QUERIES = {
    "failure_page": template(RESOURCES, "SELECT id,kind,path,created_at AS createdAt"),
    "expiry": template(RETENTION, "WITH same_expiry"),
    "bg_state": template(BG, "SELECT cursor FROM resource_scheduler"),
    "bg_page": template(BG, "SELECT id,kind,owner_id,due_at,generation FROM resource_work\n      WHERE due_at"),
    "bg_policy": template(BG, "SELECT indexing_paused,webhooks_paused"),
    "bg_owner": template(BG, "SELECT id,kind,owner_id,due_at,generation FROM resource_work\n        WHERE owner_id"),
    "bg_claim": template(BG, "UPDATE resource_work SET due_at"),
    "bg_cursor": template(BG, "INSERT INTO resource_scheduler"),
    "bg_progress": template(BG, "INSERT INTO resource_owner_progress"),
    "health_page": template(HEALTH, "SELECT owner_id,revision FROM resource_health_queue"),
    "health_claim": template(HEALTH, "UPDATE resource_health_queue SET due_at=${at + 60000}"),
    "health_metrics": template(HEALTH, "/* health-owner-evaluation */"),
    "health_alert": template(HEALTH, "INSERT INTO health_alerts"),
    "health_resolve": template(HEALTH, "UPDATE health_alerts"),
    "health_schedule": template(HEALTH, "UPDATE resource_health_queue SET due_at=(SELECT"),
    "health_done": template(HEALTH, "DELETE FROM resource_health_queue"),
    "health_dirty": template(HEALTH, "UPDATE resource_health_queue SET due_at=max"),
    "health_progress": template(HEALTH, "INSERT INTO resource_owner_progress"),
}


class Meter:
    def __init__(self, db):
        self.db = db
        self.stats = dict(round_trips=0, statements=0, read_statements=0,
                          mutation_statements=0, returned_rows=0,
                          changed_rows_with_triggers=0, vm_instructions=0,
                          queue_batches=0, queue_messages=0, examined=0,
                          evaluated=0, turns=0, source_completions=0, local_process_cpu_ns=0)
        self.plans = {}

    def run(self, name, values=None, trip=True):
        query, params = compile_sql(QUERIES[name], values or {})
        return self.raw(query, params, trip, name)

    def raw(self, query, params=(), trip=True, name=None):
        before = self.db.total_changes
        started = time.process_time_ns()
        def step():
            self.stats["vm_instructions"] += 1
            return 0
        if name and name not in self.plans:
            self.plans[name] = [r[3] for r in self.db.execute("EXPLAIN QUERY PLAN " + query, params)]
        self.db.set_progress_handler(step, 1)
        try:
            result = [dict(r) for r in self.db.execute(query, params)]
        finally:
            self.db.set_progress_handler(None, 0)
        self.stats["local_process_cpu_ns"] += time.process_time_ns() - started
        self.stats["round_trips"] += int(trip)
        self.stats["statements"] += 1
        self.stats["read_statements" if name == "expiry" or re.match(r"\s*(SELECT|/\*)", query) else "mutation_statements"] += 1
        self.stats["returned_rows"] += len(result)
        self.stats["changed_rows_with_triggers"] += self.db.total_changes - before
        return result

    def batch(self, calls):
        self.stats["round_trips"] += 1
        self.db.execute("BEGIN")
        try:
            result = [self.run(name, values, False) for name, values in calls]
            self.db.execute("COMMIT")
            return result
        except BaseException:
            self.db.execute("ROLLBACK")
            raise

    def dispatch(self, at, owner=None, complete=False, fail=False):
        CLOCK[0] = at
        values = {"at": at, "at + 60000": at + 60000,
                  "ownerId": owner, "ownerId ?? null": owner}
        candidates = []
        position = [-1, "", "", at]
        if owner:
            policy = self.run("bg_policy", values)
            policy = policy[0] if policy else {}
            for kind, paused in [("index", "indexing_paused"), ("webhook", "webhooks_paused")]:
                if not policy.get(paused):
                    candidates += self.run("bg_owner", dict(values, kind=kind))
            candidates = sorted(candidates, key=lambda r: (r["due_at"], r["kind"], r["id"]))[:50]
        else:
            state = self.run("bg_state")
            if state and state[0]["cursor"]:
                position = json.loads(state[0]["cursor"])
            def read(p):
                return self.run("bg_page", {"Math.min(at, p[3] ?? at)": min(at, p[3]),
                                            "p[0]": p[0], "p[1]": p[1], "p[2]": p[2]})
            candidates = read(position)
            if not candidates and state and state[0]["cursor"]:
                position = [-1, "", "", at]
                candidates = read(position)
        if not candidates:
            return []
        assert len(candidates) <= 50
        self.stats["examined"] += len(candidates)
        last = candidates[-1]
        values.update(payload=json.dumps(candidates), cursor=json.dumps([last["due_at"], last["kind"], last["id"], position[3]]))
        calls = [("bg_claim", values)] + ([] if owner else [("bg_cursor", values)])
        claimed = self.batch(calls)[0]
        if not claimed:
            return []
        self.stats["queue_batches"] += 1
        self.stats["queue_messages"] += len(claimed)
        if fail:
            return []  # ambiguous transport: claim/source stay durable
        owners = sorted({r["owner_id"] for r in claimed})
        self.run("bg_progress", dict(values, **{"JSON.stringify(claimed.results)": json.dumps(claimed), "JSON.stringify(owners)": json.dumps(owners)}))
        if complete:
            # Explicitly counted source completion, not a substitute for the
            # real indexer's content/R2/FTS operation measurements.
            ids = [r["id"] for r in claimed if r["kind"] == "index"]
            self.raw("DELETE FROM index_jobs WHERE entry_id IN (SELECT value FROM json_each(?))", (json.dumps(ids),))
            self.stats["source_completions"] += len(ids)
        return claimed

    def health(self, at):
        CLOCK[0] = at
        values = {"at": at, "at + 60000": at + 60000, "at + 1": at + 1, "since": at // 60000 - 10}
        pending = self.run("health_page", values)
        if not pending:
            return []
        assert len(pending) <= 100
        values["JSON.stringify(pending)"] = json.dumps(pending)
        claimed = self.run("health_claim", values)
        values["payload"] = json.dumps(claimed)
        owners = self.run("health_metrics", values)
        self.stats["evaluated"] += len(owners)
        decisions, schedule = [], []
        for owner in owners:
            requests, errors, duration, oldest = json.loads(owner["metrics"])
            schedule.append(dict(owner=owner["owner_id"], revision=owner["revision"], due=None if oldest is None else (oldest + 11) * 60000))
            for kind, active in [("errors", requests >= 10 and errors * 100 / requests >= owner["error_percent"]),
                                 ("latency", requests >= 10 and duration / requests >= owner["latency_ms"]),
                                 ("indexing", owner["jobs"] >= owner["backlog"]), ("webhooks", bool(owner["failed"]))]:
                decisions.append(dict(id=f'{owner["owner_id"]}-{kind}-{at}', owner=owner["owner_id"], kind=kind, active=int(active), message="benchmark"))
        values.update(encoded=json.dumps(decisions), next=json.dumps(schedule))
        self.batch([(name, values) for name in ["health_alert", "health_resolve", "health_schedule", "health_done", "health_dirty", "health_progress"]])
        return owners


def fixture(previous=False):
    CLOCK[0] = 1800000000000
    db = sqlite3.connect(":memory:", isolation_level=None)
    db.create_function("unixepoch", 0, lambda: CLOCK[0] // 1000)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    for migration in sorted((ROOT / "packages/db/src/migrations").glob("*.sql")):
        if previous and migration.name >= "0018":
            break
        db.executescript(migration.read_text())
    db.executescript("INSERT INTO user(id,email) VALUES('alice','alice@example.test'),('bob','bob@example.test')")
    return db


def entries(db, count, owner="bob", prefix="e"):
    db.executemany("INSERT INTO entries(id,owner_id,path,name,kind) VALUES(?,?,?,'file','file')",
                   ((f"{prefix}{i:06d}", owner, f"/{prefix}{i:06d}") for i in range(count)))


def report(label, meter, **extra):
    return dict(case=label, **meter.stats, **extra)


def main():
    at = 1800000001000
    results = []
    failure_vm = {}
    for count in [1000, 100000]:
        db = fixture()
        # Read-plan fixture for the projection itself; source lifecycle and
        # migration backfill are separately exercised with actual source writes.
        db.executemany("INSERT INTO resource_failures VALUES(?,'webhook',?,'/',1,'synthetic error')",
                       ((f"{prefix}{i:06d}", owner) for i in range(count) for prefix, owner in [("a", "alice"), ("b", "bob")]))
        for analyzed in [False, True]:
            if analyzed: db.execute("ANALYZE")
            for page, after_at, after_id in [("first", -1, ""), ("late", 1, f"a{count-61:06d}"), ("end", 1, f"a{count-1:06d}")]:
                meter = Meter(db)
                found = meter.run("failure_page", {"auth.user.id": "alice", "value?.at ?? -1": after_at, 'value?.after ?? ""': after_id})
                assert len(found) == (0 if page == "end" else 51)
                assert meter.stats["changed_rows_with_triggers"] == 0
                failure_vm[count, analyzed, page] = meter.stats["vm_instructions"]
                results.append(report("failure_inbox_bounded_page", meter, owned_projection_rows=count, unrelated_projection_rows=count,
                                      page=page, analyzed=analyzed, plans=meter.plans))
        db.close()
    for analyzed in [False, True]:
        for page in ["first", "late", "end"]:
            assert failure_vm[100000, analyzed, page] <= failure_vm[1000, analyzed, page] + 100
    for enabled in [False, True]:
        db = fixture()
        if not enabled:
            # Unsafe attribution experiment, NOT old production SQL or a rollout
            # option. Existing source-delete point lookups remain in both cases.
            for trigger in ["resource_index_failure_insert", "resource_index_failure_update",
                            "resource_delivery_failure_insert", "resource_delivery_failure_update", "resource_hook_failure_scope"]:
                db.execute("DROP TRIGGER " + trigger)
        entries(db, 1, "alice", "failure")
        db.executescript("INSERT INTO webhooks(id,owner_id,url,path_prefix,events,secret,created_at) VALUES('hook','alice','https://example.com/hook','/','[]','synthetic',1); INSERT INTO webhook_deliveries(id,webhook_id,event_id,payload,attempts,status,next_attempt,created_at) VALUES('delivery','hook','event','{}',7,'pending',0,1)")
        meter = Meter(db); steps = []
        for name, query in [
            ("index_failure", "UPDATE index_job_status SET attempts=1,last_error='failure',next_attempt=1"),
            ("index_failure_refresh", "UPDATE index_job_status SET attempts=2,last_error='new failure'"),
            ("index_retry", "UPDATE index_job_status SET attempts=0,last_error=NULL,next_attempt=0"),
            ("index_failure_again", "UPDATE index_job_status SET attempts=1,last_error='failure',next_attempt=1"),
            ("index_completion", "DELETE FROM index_jobs"),
            ("webhook_failure", "UPDATE webhook_deliveries SET status='failed',attempts=8,last_error='failure'"),
            ("webhook_failure_refresh", "UPDATE webhook_deliveries SET last_error='new failure'"),
            ("webhook_retry", "UPDATE webhook_deliveries SET status='pending',attempts=0,next_attempt=0"),
            ("webhook_failure_again", "UPDATE webhook_deliveries SET status='failed',attempts=8,last_error='failure'"),
            ("webhook_cleanup", "DELETE FROM webhook_deliveries")]:
            previous = meter.stats.copy(); meter.raw(query)
            count = db.execute("SELECT count(*) FROM resource_failures").fetchone()[0]
            assert count <= 1
            steps.append(dict(step=name, **{key: meter.stats[key]-previous[key] for key in meter.stats}, retained_failure_rows=count))
        assert db.execute("SELECT count(*) FROM resource_failures").fetchone()[0] == 0
        results.append(report("failure_lifecycle_source_writes", meter, projection_enabled=enabled,
                              diagnostic_only=not enabled, source_operations=10, steps=steps))
        db.close()
    # Equal expiry is the adversarial case: a tuple with a range on expiry can
    # rewalk all preceding ties. Exercise actual production first/late/end SQL,
    # with interleaved foreign rows, both before and after ANALYZE.
    expiry_vm = {}
    for count in [1000, 100000]:
        db = fixture()
        db.executemany("INSERT INTO object_pins VALUES(?,?,?,?)",
                       ((owner, f"{owner}-pin{i}", f"key{i}", at + 1000)
                        for i in range(count) for owner in ["alice", "bob"]))
        for analyzed in [False, True]:
            if analyzed: db.execute("ANALYZE")
            for page, after_at, after_id in [("first", at - 1, 0), ("late", at + 1000, 2 * (count - 60) - 1), ("end", at + 1000, 2 * count - 1)]:
                meter = Meter(db)
                found = meter.run("expiry", {"auth.user.id": "alice", "afterAt": after_at,
                                            "afterId": after_id, "start": at, "until": at + 86400000,
                                            "Math.max(afterAt, start - 1)": max(after_at, at - 1)})
                assert len(found) == (0 if page == "end" else 51)
                assert meter.stats["changed_rows_with_triggers"] == 0
                expiry_vm[count, analyzed, page] = meter.stats["vm_instructions"]
                results.append(report("expiry_calendar_bounded_page", meter, owned_pins=count, unrelated_pins=count,
                                      page=page, analyzed=analyzed, plans=meter.plans))
        db.close()
    for analyzed in [False, True]:
        for page in ["first", "late", "end"]:
            assert expiry_vm[100000, analyzed, page] <= expiry_vm[1000, analyzed, page] + 100
    db = fixture(); meter = Meter(db)
    meter.dispatch(at); meter.health(at)
    assert meter.stats["changed_rows_with_triggers"] == 0
    results.append(report("empty_idle_dispatch_and_health", meter, plans=meter.plans)); db.close()
    for size in [50000, 100000]:
        db = fixture(); entries(db, size)
        db.execute("DELETE FROM index_jobs"); db.execute("DELETE FROM resource_health_queue")
        entries(db, 1, "alice", "mine")
        db.execute("ANALYZE")
        meter = Meter(db); claimed = meter.dispatch(at, "alice"); evaluated = meter.health(at)
        assert len(claimed) == len(evaluated) == 1
        results.append(report("one_active_owner_among_unrelated_files", meter, unrelated_files=size, plans=meter.plans if size == 50000 else {})); db.close()
    for size in [1000, 100000]:
        db = fixture()
        db.executemany("INSERT INTO resource_health_queue(owner_id,due_at) VALUES(?,0)", ((f"dirty{i:06d}",) for i in range(size)))
        db.execute("ANALYZE")
        meter = Meter(db); assert len(meter.health(at)) == 100
        assert "owner_id=?" in " ".join(meter.plans["health_claim"])
        assert "owner_id=?" in " ".join(meter.plans["health_done"])
        results.append(report("one_health_turn_among_dirty_owners", meter, dirty_owners=size, plans=meter.plans)); db.close()
    for count in [100, 1000]:
        db = fixture()
        db.executemany("INSERT INTO operation_metrics VALUES(?,?,'api',10,5,0,50000)", ((f"owner{i:06d}", at // 60000) for i in range(count)))
        # One noisy owner with all five operation classes in every retained
        # minute; health reads only the latest decision window.
        db.executemany("INSERT INTO operation_metrics VALUES('noisy',?,?,10,5,0,50000)", ((at // 60000 - i, route) for i in range(7 * 1440) for route in ["api", "mcp", "search", "upload", "download"]))
        meter = Meter(db)
        for turn in range((count + 100) // 100):
            meter.health(at + turn * 60000); meter.stats["turns"] += 1
            if turn == 0:
                results.append(report("health_first_bounded_turn", meter, owners=count + 1))
        processed = db.execute("SELECT count(*) FROM resource_owner_progress").fetchone()[0]
        assert processed == count + 1, (processed, count)
        results.append(report("health_initial_full_backlog_convergence", meter, owners=count + 1, noisy_retained_metric_rows=50400))
        decay = Meter(db)
        for turn in range(2 * ((count + 100) // 100) + 2):
            decay.health(at + (30 + turn) * 60000); decay.stats["turns"] += 1
        assert db.execute("SELECT count(*) FROM health_alerts WHERE resolved_at IS NULL").fetchone()[0] == 0
        results.append(report("health_no_traffic_eventual_resolution", decay, owners=count + 1))
        idle = Meter(db); idle.health(at + 60 * 60000)
        assert idle.stats["changed_rows_with_triggers"] == 0
        results.append(report("health_after_convergence_idle", idle, owners=count + 1)); db.close()
    for count in [100, 1000]:
        db = fixture(); entries(db, count, "alice", "a"); entries(db, count, "bob", "z")
        db.execute("INSERT INTO resource_policies(owner_id,indexing_paused) VALUES('alice',1)")
        meter = Meter(db)
        for turn in range(count * 2 // 50):
            meter.dispatch(at + turn * 60000, complete=True); meter.stats["turns"] += 1
        assert db.execute("SELECT count(*) FROM index_jobs").fetchone()[0] == count
        results.append(report("paused_queue_full_cycle", meter, paused=count, ready=count))
        db.execute("UPDATE resource_policies SET indexing_paused=0")
        resumed = Meter(db)
        for turn in range(count // 50):
            resumed.dispatch(at + (100 + turn) * 60000, complete=True); resumed.stats["turns"] += 1
        assert db.execute("SELECT count(*) FROM index_jobs").fetchone()[0] == 0
        results.append(report("resumed_queue_full_convergence", resumed, jobs=count)); db.close()
    db = fixture(); entries(db, 100, "alice", "a"); entries(db, 100, "bob", "z")
    db.execute("INSERT INTO resource_policies(owner_id,indexing_paused) VALUES('alice',1)")
    growing = Meter(db); growing.dispatch(at, complete=True)
    db.execute("UPDATE resource_policies SET indexing_paused=0 WHERE owner_id='alice'")
    first_cycle = set()
    for turn in range(1, 9):
        CLOCK[0] = at + turn * 1000
        entries(db, 50, "bob", f"new{turn}_")
        claimed = growing.dispatch(CLOCK[0], complete=True)
        first_cycle.update(row["id"] for row in claimed if row["id"].startswith("a"))
        growing.stats["turns"] += 1
    assert len(first_cycle) == 100
    results.append(report("continuous_arrivals_resume_fairness", growing, arrivals_per_turn=50, resumed_jobs_completed=100, remaining_jobs=db.execute("SELECT count(*) FROM index_jobs").fetchone()[0])); db.close()
    db = fixture(); entries(db, 1)
    meter = Meter(db); meter.dispatch(at, fail=True); meter.dispatch(at + 60001, complete=True)
    assert db.execute("SELECT count(*) FROM index_jobs").fetchone()[0] == 0
    results.append(report("ambiguous_send_recovery", meter)); db.close()
    writes = []
    for variant in ["through_0017", "through_0018_without_allocator_diagnostic_only", "through_0018_without_cleanup_indexes_diagnostic_only", "through_0018"]:
        previous = variant == "through_0017"
        db = fixture(previous)
        if "without_allocator" in variant:
            # Attribution experiment only, NOT a safe deployable configuration.
            for trigger in ["resource_work_generation_insert", "resource_work_generation_update", "resource_health_generation_insert", "resource_health_generation_update", "resource_gc_generation_insert", "resource_gc_generation_update"]:
                db.execute("DROP TRIGGER " + trigger)
        if "without_cleanup_indexes" in variant:
            # Attribution only: current cleanup SQL explicitly requires these
            # indexes, so removing them is NOT a working deployment option.
            for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'cleanup_%'").fetchall():
                db.execute("DROP INDEX " + name)
        before = db.total_changes
        instructions = [0]
        def step():
            instructions[0] += 1
            return 0
        db.set_progress_handler(step, 1)
        cpu_start = time.process_time_ns()
        entries(db, 1000)
        db.executemany("INSERT INTO operation_metrics VALUES('alice',?,'api',10,0,0,100)", ((at // 60000 - i,) for i in range(1000)))
        cpu = time.process_time_ns() - cpu_start
        db.set_progress_handler(None, 0)
        writes.append(dict(schema=variant, source_inserts=2000, source_sql_statements=2000,
                           vm_instructions= instructions[0], instrumented_local_process_cpu_ns=cpu,
                           changed_rows_with_triggers=db.total_changes - before,
                           sqlite_page_bytes=db.execute("PRAGMA page_count").fetchone()[0] * db.execute("PRAGMA page_size").fetchone()[0]))
        before_gc = db.total_changes
        instructions[0] = 0; db.set_progress_handler(step, 1); cpu_start = time.process_time_ns()
        db.executemany("INSERT INTO object_gc VALUES(?,1)", ((f"gc{i}",) for i in range(1000)))
        db.executemany("UPDATE object_gc SET created_at=2 WHERE r2_key=?", ((f"gc{i}",) for i in range(1000)))
        gc_cpu = time.process_time_ns() - cpu_start; db.set_progress_handler(None, 0)
        writes[-1]["gc_1000_enqueues_and_1000_renewals"] = dict(source_sql_statements=2000, changed_rows_with_triggers=db.total_changes-before_gc,
            vm_instructions=instructions[0], instrumented_local_process_cpu_ns=gc_cpu,
            sqlite_total_page_bytes=db.execute("PRAGMA page_count").fetchone()[0] * db.execute("PRAGMA page_size").fetchone()[0])
        if variant == "through_0018":
            before_policy = db.total_changes; instructions[0] = 0; db.set_progress_handler(step, 1); cpu_start = time.process_time_ns()
            db.execute("INSERT INTO resource_policies(owner_id) VALUES('alice')")
            for i in range(999): db.execute("UPDATE resource_policies SET max_text_bytes=? WHERE owner_id='alice'", (i,))
            policy_cpu = time.process_time_ns() - cpu_start; db.set_progress_handler(None, 0)
            writes[-1]["policy_1_create_and_999_updates"] = dict(source_sql_statements=1000, changed_rows_with_triggers=db.total_changes-before_policy,
                vm_instructions=instructions[0], instrumented_local_process_cpu_ns=policy_cpu,
                policy_rows=db.execute("SELECT count(*) FROM resource_policies").fetchone()[0],
                shared_allocator_rows=db.execute("SELECT count(*) FROM resource_generation").fetchone()[0])
        db.close()
    print(json.dumps(dict(sqlite=sqlite3.sqlite_version, measurement="Local SQLite VM instructions, returned rows, SQL/roundtrip counts, total_changes including triggers, simulated queue sends. local_process_cpu_ns is measured Python/SQLite process CPU including per-instruction instrumentation and first query-plan collection; it is not Worker CPU. Returned rows are not D1 rows_read; changes are not D1 billed rows_written. No billing claims.", results=results, projection_write_and_storage_comparison=writes), indent=2))


if __name__ == "__main__":
    main()
