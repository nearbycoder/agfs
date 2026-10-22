"""Offline cleanup evidence: run real TS to capture SQL, then replay exact SQL.

No remote calls. VM instructions and SQLite total_changes are local operation
proxies, NOT Worker CPU, D1 billed rows, or account cost. Process CPU includes the
VM instrumentation callback. Full-turn counts include guards/cursors/triggers,
FK cascades, final GC reference checks, and simulated R2 failures/operations.
Default invocation generates fresh real-JS traces in a temporary directory.
--trace-prefix reuses traces from AGFS_CLEANUP_BENCH=<prefix> vitest run of the
server-feature-expansion-cleanup.test.ts suite (including its SQLite backups).
"""
from pathlib import Path
import argparse
import hashlib
import itertools
import json
import os
import sqlite3
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[4]


def database(backup=None):
    db = sqlite3.connect(":memory:", isolation_level=None)
    if backup:
        source = sqlite3.connect(backup)
        source.backup(db)
        source.close()
    else:
        for p in sorted((ROOT / "packages/db/src/migrations").glob("*.sql")):
            db.executescript(p.read_text())
    db.execute("PRAGMA foreign_keys=ON")
    return db


def measure(db, trace, statement_details=False):
    result = dict(statements=0, round_trips=0, returned_rows=0,
                  sqlite_changes_including_triggers=0, vm_instructions=0,
                  local_process_cpu_ns=0)
    details = []
    before = db.total_changes
    started = time.process_time_ns()
    def step():
        result["vm_instructions"] += 1
        return 0
    db.set_progress_handler(step, 1)
    try:
        for _, group in itertools.groupby(trace, key=lambda row: row["trip"]):
            queries = list(group)
            result["round_trips"] += 1
            if len(queries) > 1:
                db.execute("BEGIN")
            for row in queries:
                vm_before, changes_before = result["vm_instructions"], db.total_changes
                returned = len(db.execute(row["query"], row["params"]).fetchall())
                result["returned_rows"] += returned
                result["statements"] += 1
                if statement_details:
                    details.append(dict(query=row["query"], vm_instructions=result["vm_instructions"] - vm_before,
                                        sqlite_changes_including_triggers=db.total_changes - changes_before, returned_rows=returned))
            if len(queries) > 1:
                db.execute("COMMIT")
    finally:
        db.set_progress_handler(None, 0)
    result["sqlite_changes_including_triggers"] = db.total_changes - before
    result["local_process_cpu_ns"] = time.process_time_ns() - started
    if statement_details:
        result["statement_details"] = details
    return result


def plan(db, row):
    return [r[3] for r in db.execute("EXPLAIN QUERY PLAN " + row["query"], row["params"])]


def one(rows, predicate):
    found = [r for r in rows if predicate(r["query"])]
    assert len(found) == 1, len(found)
    return found[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--trace-prefix", type=Path)
    args = parser.parse_args()
    prefix = args.trace_prefix
    if not prefix:
        prefix = Path(tempfile.mkdtemp(prefix="agfs-cleanup-evidence-")) / "turn"
        env = dict(os.environ, AGFS_CLEANUP_BENCH=str(prefix))
        with prefix.with_suffix(".log").open("w") as log:
            subprocess.run(["npm", "exec", "--yes", "--package=pnpm@10.34.7", "--", "pnpm", "--filter", "@agfs/web", "test", "src/lib/server-feature-expansion-cleanup.test.ts"], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
    full = json.loads(prefix.with_suffix(".json").read_text())
    results = []
    idle = json.loads(Path(str(prefix) + "-idle.json").read_text())
    db = database(Path(str(prefix) + "-idle.sqlite"))
    for name in ("initialTrace", "idleTrace"):
        cost = measure(db, idle[name])
        assert cost["sqlite_changes_including_triggers"] == 0
        results.append(dict(case="empty_hourly" if name == "initialTrace" else "empty_minute_continuation", **cost, r2_operations=0, queue_sends=0))
    db.close()
    db = database(prefix.with_suffix(".sqlite"))
    full_cost = measure(db, full["trace"])
    assert full_cost["sqlite_changes_including_triggers"] == full["changes"] == 1830
    assert full_cost["statements"] == full["statements"] == 137
    assert full_cost["round_trips"] == full["roundTrips"] == 44
    results.append(dict(case="all_19_phases_full_turn", **full_cost, r2_aborts=5,
                        r2_delete_batches=1, r2_delete_keys=100, queue_sends=0,
                        r2_body_read_bytes=0, selected_parents=387,
                        source_retirements=662, metadata_updates=30,
                        sampled_node_memory=full["sampledNodeMemory"],
                        maximum_sql_bindings=full["maxSqlBindings"], maximum_string_binding_bytes=full["maxStringBindingBytes"],
                        plans=[dict(query=r["query"], plan=plan(db, r)) for r in full["trace"] if r["query"].startswith(("SELECT", "WITH"))]))
    results.append(dict(case="all_phases_second_turn", **measure(db, full["continuation"])))
    db.close()

    # R3: a bounded candidate SELECT does not ensure bounded retirement. Use
    # actual SQL with selected rowids AFTER recent committed parents or an
    # expired pending backlog. Report mutation costs without/with statistics.
    upload_costs = {}
    for task in ("committed", "uploads"):
        for count in (1000, 100000):
            for analyzed in (False, True):
                upload_prefix = Path(str(prefix) + f"-{task}-{count}-{'analyzed' if analyzed else 'raw'}")
                data = json.loads(upload_prefix.with_suffix(".json").read_text())
                db = database(upload_prefix.with_suffix(".sqlite"))
                mutations = [r for r in data["trace"] if "t.rowid" in r["query"]]
                plans = [dict(query=r["query"], plan=plan(db, r)) for r in mutations]
                assert len(plans) == (10 if task == "committed" else 20)
                for p in plans:
                    assert "SEARCH t USING INDEX sqlite_autoindex_uploads_1 (id=?)" in p["plan"], p
                    assert not any("uploads_expiry_idx" in step for step in p["plan"]), p
                cost = measure(db, data["trace"], statement_details=True)
                assert cost["statements"] == (15 if task == "committed" else 25) and cost["round_trips"] == 3
                assert cost["sqlite_changes_including_triggers"] == data["changes"] == (23 if task == "committed" else 48)
                assert db.execute("SELECT count(*) FROM uploads").fetchone()[0] == count
                assert db.execute("SELECT count(*) FROM upload_parts").fetchone()[0] == count
                assert not db.execute("PRAGMA foreign_key_check").fetchall()
                parent_vm = sum(r["vm_instructions"] for r in cost["statement_details"] if r["query"].startswith("DELETE FROM uploads"))
                upload_costs[task, count, analyzed] = (cost["vm_instructions"], parent_vm)
                results.append(dict(case="upload_retirement", task=task, unrelated_parents=count, unrelated_parts=count,
                                    analyzed=analyzed, selected_rowids="after unrelated rows",
                                    unrelated_state="recent committed" if task == "committed" else "expired pending backlog", **cost,
                                    parent_delete_vm=parent_vm, mutation_plans=plans,
                                    r2_operations=0, queue_sends=0))
                db.close()
        for analyzed in (False, True):
            small, large = upload_costs[task, 1000, analyzed], upload_costs[task, 100000, analyzed]
            assert all(b <= a + 100 for a, b in zip(small, large)), (small, large)

    # R4/R5: statistics describe one or ten rows, then the table grows without
    # ANALYZE. Childless repros isolate parent access; childful fixtures mix
    # statuses and also expose an IN-list scan on the child DELETE itself.
    stale_costs = {}
    inherited_fk_observations = []
    for task, statistics_from in itertools.product(("uploads", "committed"), (1, 10)):
        for children in (False, True):
            for count in (1000, 100000):
                stale_prefix = Path(str(prefix) + f"-stale-{statistics_from}-{task}-{count}-{'children' if children else 'parents'}")
                data = json.loads(stale_prefix.with_suffix(".json").read_text())
                db = database(stale_prefix.with_suffix(".sqlite"))
                mutations = [r for r in data["trace"] if "t.rowid" in r["query"]]
                plans = [dict(query=r["query"], plan=plan(db, r)) for r in mutations]
                for p in plans:
                    assert "SEARCH t USING INDEX sqlite_autoindex_uploads_1 (id=?)" in p["plan"], p
                    assert not any(step.startswith(("SCAN t", "SCAN upload_parts")) for step in p["plan"]), p
                    if p["query"].startswith("DELETE FROM upload_parts"):
                        assert any("(upload_id=? AND part_number<?)" in step for step in p["plan"]), p
                cost = measure(db, data["trace"], statement_details=True)
                assert cost["statements"] == (15 if task == "committed" else 25) and cost["round_trips"] == 3
                assert cost["sqlite_changes_including_triggers"] == data["changes"] == (23 if task == "committed" else 48)
                assert db.execute("SELECT count(*) FROM uploads").fetchone()[0] == count
                assert db.execute("SELECT count(*) FROM upload_parts").fetchone()[0] == (count if children else 0)
                assert not db.execute("PRAGMA foreign_key_check").fetchall()
                parent_vm = sum(r["vm_instructions"] for r in cost["statement_details"] if r["query"].startswith("DELETE FROM uploads"))
                stale_costs[task, statistics_from, children, count] = cost
                observation = dict(case="inherited_fk_stale_child_statistics" if statistics_from == 1 and children else "stale_statistics_upload_retirement", task=task, unrelated_parents=count,
                                    unrelated_parts=count if children else 0, statistics_from_parents=statistics_from,
                                    unrelated_statuses="mixed" if children else "same task status",
                                    **cost, parent_delete_vm=parent_vm, mutation_plans=plans,
                                    r2_operations=0, queue_sends=0)
                if statistics_from == 1 and children:
                    # Preserved known limitation: SQLite's implicit FK cascade
                    # can scan unrelated parts even though explicit parent and
                    # child SQL use point/range seeks. Do not call this bounded.
                    observation["limit"] = "Implicit upload_parts FK cascade can scan under one-row child statistics; inherited before this delta."
                    inherited_fk_observations.append(observation)
                else:
                    results.append(observation)
                db.close()
            small, large = stale_costs[task, statistics_from, children, 1000], stale_costs[task, statistics_from, children, 100000]
            if statistics_from == 1 and children:
                explicit = lambda cost: cost["vm_instructions"] - sum(r["vm_instructions"] for r in cost["statement_details"] if r["query"].startswith("DELETE FROM uploads"))
                assert explicit(large) <= explicit(small) + 100, (task, children, small, large)
                for observation in inherited_fk_observations:
                    if observation["task"] == task:
                        observation["whole_turn_scale_bound_pass"] = large["vm_instructions"] <= small["vm_instructions"] + 100
            else:
                assert large["vm_instructions"] <= small["vm_instructions"] + 100, (task, children, small, large)
            for key in ("statements", "round_trips", "sqlite_changes_including_triggers"):
                assert small[key] == large[key]

    # Inspect every live-parent alias access emitted by all 19 tasks, then scale
    # the six parent families with FK/projection work using complete mutation
    # batches. Data below only adds FK-valid unrelated fixtures; SQL is unchanged.
    db = database(prefix.with_suffix(".sqlite"))
    parent_access = [dict(query=r["query"], plan=plan(db, r)) for r in full["trace"] if "t.rowid" in r["query"]]
    for p in parent_access:
        if "INDEXED BY sqlite_autoindex_uploads_1" in p["query"]:
            assert "SEARCH t USING INDEX sqlite_autoindex_uploads_1 (id=?)" in p["plan"], p
        else:
            assert any(step.startswith("SEARCH t USING INTEGER PRIMARY KEY (") for step in p["plan"]), p
    db.close()
    batches = [list(g) for _, g in itertools.groupby(full["trace"], key=lambda r: r["trip"])]
    batches = [g for g in batches if g[0]["query"].startswith("INSERT INTO resource_cleanup_guard")]
    mutation_costs = {}
    for task, idx, table, column in [
        ("uploads", 0, "uploads", "expires_at"), ("expired_backlog", 0, "uploads", "expires_at"),
        ("snapshots", 3, "snapshots", "expires_at"),
        ("alerts", 11, "health_alerts", "resolved_at"), ("deliveries", 12, "webhook_deliveries", "created_at"),
        ("shares", 17, "share_links", "expires_at"), ("committed", 18, "uploads", "committed_at"),
    ]:
        for count in (1000, 100000):
            db = database(prefix.with_suffix(".sqlite"))
            db.row_factory = sqlite3.Row
            sample = dict(db.execute("SELECT * FROM " + table + (" WHERE status='committed'" if task == "committed" else "") + " LIMIT 1").fetchone())
            db.row_factory = None
            columns = list(sample)
            if table == "uploads":
                sample["status"] = "committed" if task == "committed" else "pending"
            def rows():
                for i in range(count):
                    row = dict(sample)
                    for key in {"id", "token_hash", "event_id", "object_key", "kind"} & row.keys():
                        row[key] = "unrelated" + str(i)
                    row[column] = 1 if task == "expired_backlog" else full["at"] + 10**9
                    yield [row[key] for key in columns]
            db.execute("BEGIN")
            db.executemany("INSERT INTO " + table + "(" + ",".join(columns) + ") VALUES(" + ",".join("?" for _ in columns) + ")", rows())
            for child_table, query in {
                "uploads": "INSERT INTO upload_parts VALUES(?,1,'digest','etag',1)",
                "snapshots": "INSERT INTO snapshot_entries VALUES(?,'/child','{}')",
                "share_links": "INSERT INTO share_link_views(id,share_id) VALUES(?,?)",
                "health_alerts": "INSERT INTO resource_alert_state(alert_id) VALUES(?)",
            }.items():
                if table == child_table:
                    db.executemany(query, (("unrelated" + str(i),) * query.count("?") for i in range(count)))
            db.execute("COMMIT")
            assert not db.execute("PRAGMA foreign_key_check").fetchall()
            for analyzed in (False, True):
                if analyzed:
                    db.execute("ANALYZE")
                # Replay a full transactional batch on a fresh copy for each
                # planner variant, keeping all FK/trigger/state mutations.
                probe = database()
                db.backup(probe)
                # Compile the diagnostic plans before instrumentation, as in
                # the dedicated upload cases. Otherwise opening an analyzed
                # backup also counts lazy statistics loading in the first SQL.
                plans = [dict(query=r["query"], plan=plan(probe, r)) for r in batches[idx]]
                cost = measure(probe, batches[idx])
                assert not probe.execute("PRAGMA foreign_key_check").fetchall()
                mutation_costs[task, count, analyzed] = cost
                results.append(dict(case="parent_mutation_batch", task=task, unrelated_parents=count,
                                    unrelated_children=0 if table == "webhook_deliveries" else count,
                                    analyzed=analyzed, **cost, plans=plans))
                probe.close()
            db.close()
        for analyzed in (False, True):
            small, large = mutation_costs[task, 1000, analyzed], mutation_costs[task, 100000, analyzed]
            assert large["vm_instructions"] <= small["vm_instructions"] * 1.02 + 20, (task, analyzed, small, large)
            for key in ("statements", "round_trips", "sqlite_changes_including_triggers"):
                assert small[key] == large[key], (task, key, small, large)

    for count in (100, 1000):
        pin_prefix = Path(str(prefix) + f"-pins-{count}")
        data = json.loads(pin_prefix.with_suffix(".json").read_text())
        db = database(pin_prefix.with_suffix(".sqlite"))
        costs = [measure(db, trace) for trace in data["turns"]]
        assert db.execute("SELECT count(*) FROM object_pins").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM resource_object_gc").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM resource_cleanup").fetchone()[0] == 0
        results.append(dict(case="pin_full_convergence", pins=count, turns=len(costs),
                            costs_by_turn=costs,
                            totals={k: sum(c[k] for c in costs) for k in costs[0]},
                            r2_delete_batches=len(data["deleteCalls"]), r2_delete_key_attempts=sum(data["deleteCalls"]),
                            r2_failed_batches=1, r2_aborts=0, queue_sends=0))
        db.close()

    first = one(full["trace"], lambda q: q.startswith("SELECT CAST(rowid") and "FROM object_pins " in q)
    late = one(full["continuation"], lambda q: q.startswith("WITH equal_expiry") and "FROM object_pins " in q)
    expiry_costs = {}
    for count in (1000, 100000):
        for analyzed in (False, True):
            db = database()
            with db:
                db.execute("BEGIN")
                db.executemany("INSERT INTO object_pins VALUES(?,?,?,?)",
                               (("alice" if i % 2 else "bob", f"p{i}", f"k{i}", 1) for i in range(count)))
                db.executemany("INSERT INTO object_pins VALUES('unrelated',?,?,?)",
                               ((f"future{i}", f"future{i}", full["at"] + 10000) for i in range(count)))
                db.execute("COMMIT")
            if analyzed:
                db.execute("ANALYZE")
            for position in ("first", "late", "end", "late_next_expiry"):
                row = dict(first if position == "first" else late)
                row["params"] = list(row["params"])
                if position != "first":
                    row["params"][1] = str(count if position == "end" else count - 25)
                if position == "late_next_expiry":
                    db.execute("UPDATE object_pins SET expires_at=2 WHERE rowid>? AND rowid<=?", (count - 25, count))
                cost = measure(db, [row])
                expected = 0 if position == "end" else 25
                assert cost["returned_rows"] == expected, (position, cost)
                assert cost["sqlite_changes_including_triggers"] == 0
                expiry_costs[count, analyzed, position] = cost["vm_instructions"]
                results.append(dict(case="expiry_index_page", expired=count, unrelated_future_pins=count,
                                    analyzed=analyzed, position=position, **cost, plan=plan(db, row)))
            db.close()
    for analyzed in (False, True):
        for position in ("first", "late", "end", "late_next_expiry"):
            assert expiry_costs[100000, analyzed, position] <= expiry_costs[1000, analyzed, position] + 100

    # Actual child/guard/delete SQL from the full turn, with huge unrelated
    # child collections. This catches a hidden cascade or pre-LIMIT join scan.
    child = one(full["trace"], lambda q: q.startswith("DELETE FROM snapshot_entries"))
    parent = one(full["trace"], lambda q: q.startswith("DELETE FROM snapshots"))
    for count in (1000, 100000):
        db = database(prefix.with_suffix(".sqlite"))
        db.execute("INSERT INTO snapshots VALUES('unrelated','alice','s','/',0,1,'alice')")
        db.execute("BEGIN")
        db.executemany("INSERT INTO snapshot_entries VALUES('unrelated',?,'{}')", ((f"/{i}",) for i in range(count)))
        db.execute("COMMIT")
        db.execute("ANALYZE")
        before = db.execute("SELECT count(*) FROM snapshot_entries").fetchone()[0]
        cost = measure(db, [child, parent])
        assert before - db.execute("SELECT count(*) FROM snapshot_entries").fetchone()[0] == 25
        results.append(dict(case="bounded_snapshot_child_retirement", unrelated_children=count,
                            **cost, child_plan=plan(db, child), parent_plan=plan(db, parent)))
        db.close()
    files = ["apps/web/src/lib/cleanup.ts", "apps/web/src/lib/resource-controls-cleanup.ts", "apps/web/src/lib/garbage.ts", "apps/web/src/lib/server-feature-expansion-cleanup.test.ts", "packages/db/src/migrations/0018_resource_controls.sql"]
    print(json.dumps(dict(scope="Local actual-SQL replay; not D1 billing or Worker CPU", trace_prefix=str(prefix),
                          sqlite_version=sqlite3.sqlite_version, parent_mutation_access_plans=parent_access,
                          inherited_fk_observations=inherited_fk_observations,
                          source_sha256={p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in files},
                          d1_rows_read=None, d1_rows_written=None,
                          note="D1 counters require D1 execution; returned rows, SQLite changes and VM cannot substitute for them. Index page writes/storage are not included in total_changes.",
                          results=results), indent=2))


if __name__ == "__main__":
    main()
