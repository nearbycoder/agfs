import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { serverFixture, deferred } from "./server-expansion-fixture.test-utils";
const state = vi.hoisted(() => ({ fixture: null as any, get: vi.fn(), sendBatch: vi.fn() }));
vi.mock("./bindings", () => ({
  requireResourceBindings: () => ({ DB: { prepare: (q: string) => state.fixture.binding.prepare(q), batch: (q: unknown[]) => state.fixture.binding.batch(q) }, FILES_BUCKET: { get: state.get } }),
  getBindings: () => ({ BACKGROUND_QUEUE: { sendBatch: state.sendBatch } }),
}));
import { dispatchBackground, consumeBackground } from "./background";
import { evaluateHealth, health } from "./operations";
import { indexFiles } from "./search";
import { deliverWebhooks } from "./webhooks";
let fixture: ReturnType<typeof serverFixture>, at: number;
beforeEach(() => {
  fixture = serverFixture(); state.fixture = fixture; at = Date.now() + 1000;
  vi.spyOn(Date, "now").mockImplementation(() => at);
  state.get.mockReset().mockResolvedValue({ size: 10, text: async () => "hello text" });
  state.sendBatch.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { fixture.sqlite.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const auth = { authSource: "session", user: { id: "alice", email: "alice@example.test", name: "Alice" } } as const;
function hook(id = "hook", owner = "alice") {
  fixture.sqlite.prepare("INSERT INTO webhooks(id,owner_id,url,path_prefix,events,secret,created_at) VALUES(?,?,'https://hooks.example.com','/','[\"*\"]','secret',1)").run(id, owner);
}
function delivery(id: string, status = "pending", webhook = "hook") {
  fixture.sqlite.prepare("INSERT INTO webhook_deliveries(id,webhook_id,event_id,payload,status,next_attempt,created_at) VALUES(?,?,?,'{}',?,0,1)").run(id, webhook, id, status);
}
function message(body: object, dead = false) {
  const ack = vi.fn(), retry = vi.fn();
  return { ack, retry, batch: { queue: dead ? "background-dead" : "background", messages: [{ body, ack, retry }] } as any };
}
function projection() {
  const actual = fixture.sqlite.prepare("SELECT kind,id,owner_id FROM resource_work ORDER BY kind,id").all();
  const expected = fixture.sqlite.prepare("SELECT 'index' AS kind,j.entry_id AS id,e.owner_id FROM index_jobs j JOIN entries e ON e.id=j.entry_id UNION ALL SELECT 'webhook',d.id,w.owner_id FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id WHERE d.status IN ('pending','sending') ORDER BY kind,id").all();
  expect(actual).toEqual(expected);
  const counts = fixture.sqlite.prepare("SELECT e.owner_id,count(*) AS pending,sum(s.attempts>0) AS failed FROM index_job_status s JOIN entries e ON e.id=s.entry_id GROUP BY e.owner_id ORDER BY e.owner_id").all();
  expect(fixture.sqlite.prepare("SELECT * FROM resource_index_counts WHERE pending>0 ORDER BY owner_id").all()).toEqual(counts);
  const hooks = fixture.sqlite.prepare("SELECT w.owner_id,d.status,count(*) AS count FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id GROUP BY w.owner_id,d.status ORDER BY w.owner_id,d.status").all();
  expect(fixture.sqlite.prepare("SELECT * FROM resource_webhook_counts WHERE count>0 ORDER BY owner_id,status").all()).toEqual(hooks);
  expect(fixture.sqlite.prepare("SELECT * FROM resource_index_counts WHERE pending<0 OR failed<0").all()).toEqual([]);
  expect(fixture.sqlite.prepare("SELECT * FROM resource_webhook_counts WHERE count<0").all()).toEqual([]);
}

describe("migration projection and old-worker compatibility", () => {
  it("maintains source truth through statuses, retries, owner transfers and cascades", () => {
    fixture.entry("file"); hook(); delivery("pending"); delivery("failed", "failed"); projection();
    fixture.sqlite.exec("UPDATE index_job_status SET attempts=3,next_attempt=123; UPDATE entries SET owner_id='bob' WHERE id='file'; UPDATE webhooks SET owner_id='bob' WHERE id='hook'"); projection();
    fixture.sqlite.exec("UPDATE webhook_deliveries SET status='sending',attempts=1,next_attempt=123 WHERE id='pending'; UPDATE webhook_deliveries SET status='pending',attempts=0,next_attempt=0 WHERE id='failed'"); projection();
    fixture.sqlite.exec("UPDATE webhook_deliveries SET status='delivered' WHERE id='pending'; DELETE FROM entries WHERE id='file'"); projection();
    fixture.sqlite.exec("DELETE FROM webhooks WHERE id='hook'"); projection();
  });
  it("handles 1,000 deterministic source mutations and keeps old positional inserts valid", () => {
    hook();
    for (let i = 0; i < 100; i++) { fixture.entry(`e${i}`); delivery(`d${i}`); }
    for (let i = 0; i < 1000; i++) {
      const n = i * 37 % 100;
      switch (i % 5) {
        case 0: fixture.sqlite.prepare("UPDATE entries SET owner_id=CASE owner_id WHEN 'alice' THEN 'bob' ELSE 'alice' END WHERE id=?").run(`e${n}`); break;
        case 1: fixture.sqlite.prepare("UPDATE index_job_status SET attempts=attempts+1,next_attempt=? WHERE entry_id=?").run(i, `e${n}`); break;
        case 2: fixture.sqlite.prepare("UPDATE webhook_deliveries SET status=CASE status WHEN 'pending' THEN 'failed' ELSE 'pending' END,attempts=attempts+1,next_attempt=? WHERE id=?").run(i, `d${n}`); break;
        case 3: fixture.sqlite.prepare("DELETE FROM index_jobs WHERE entry_id=?").run(`e${n}`); break;
        case 4: fixture.sqlite.prepare("INSERT OR IGNORE INTO index_jobs VALUES(?)").run(`e${n}`); break;
      }
      if (i % 25 === 0) projection();
    }
    fixture.sqlite.exec("INSERT INTO queue_failures VALUES('e1','index',1,'legacy'); INSERT INTO queue_outbox VALUES('e1','index',1,NULL)"); projection();
  });
  it("allocates exact generations across deletion/recreation and refuses unsafe integers atomically", () => {
    fixture.entry("file");
    const first = fixture.sqlite.prepare("SELECT generation FROM resource_work WHERE id='file'").get()!.generation;
    fixture.sqlite.exec("DELETE FROM index_jobs WHERE entry_id='file'; INSERT INTO index_jobs VALUES('file')");
    expect(fixture.sqlite.prepare("SELECT generation FROM resource_work WHERE id='file'").get()!.generation).toBeGreaterThan(first as number);
    fixture.sqlite.exec("UPDATE resource_generation SET value=9007199254740990");
    fixture.sqlite.exec("UPDATE resource_work SET generation=0 WHERE id='file'");
    const last = fixture.sqlite.prepare("SELECT generation FROM resource_work WHERE id='file'").get()!.generation;
    expect(last).toBe(Number.MAX_SAFE_INTEGER); expect(JSON.parse(JSON.stringify(last))).toBe(last);
    expect(() => fixture.sqlite.exec("UPDATE entries SET etag='unsafe' WHERE id='file'")).toThrow(/CHECK constraint/);
    expect(fixture.sqlite.prepare("SELECT etag FROM entries WHERE id='file'").get()!.etag).toBe("etag");
    expect(fixture.sqlite.prepare("SELECT generation FROM resource_work WHERE id='file'").get()!.generation).toBe(last);
  });
  it("backfills existing jobs with distinct generations and accepts subsequent old-worker writes", () => {
    const old = serverFixture("0017_index_job_owners.sql");
    try {
      old.entry("existing");
      old.sqlite.exec("INSERT INTO webhooks(id,owner_id,url,path_prefix,events,secret,created_at) VALUES('hook','alice','https://hooks.example.com','/','[]','local-test',1); INSERT INTO webhook_deliveries(id,webhook_id,event_id,payload,status,next_attempt,created_at) VALUES('delivery','hook','event','{}','pending',0,1)");
      old.sqlite.exec(readFileSync(new URL("../../../../packages/db/src/migrations/0018_resource_controls.sql", import.meta.url), "utf8"));
      const generations = old.sqlite.prepare("SELECT generation FROM resource_work UNION ALL SELECT revision FROM resource_health_queue").all().map((r) => r.generation as number);
      expect(new Set(generations).size).toBe(generations.length); expect(generations.every((n) => n > 0 && Number.isSafeInteger(n))).toBe(true);
      old.sqlite.exec("DELETE FROM index_jobs WHERE entry_id='existing'; INSERT INTO index_jobs VALUES('existing'); INSERT INTO queue_outbox VALUES('existing','index',1,NULL)");
      expect(old.sqlite.prepare("SELECT generation FROM resource_work WHERE id='existing'").get()!.generation).toBeGreaterThan(Math.max(...generations));
      old.sqlite.exec("DELETE FROM entries WHERE id='existing'; DELETE FROM webhooks WHERE id='hook'");
      expect(old.sqlite.prepare("SELECT * FROM resource_work").all()).toEqual([]);
      expect(old.sqlite.prepare("SELECT value FROM resource_generation").get()!.value).toBeGreaterThan(Math.max(...generations));
    } finally { old.sqlite.close(); }
  });
});

describe("bounded background dispatch", () => {
  it("does only indexed reads and no writes/messages on idle turns", async () => {
    const idle = await dispatchBackground();
    expect(idle).toEqual({ examined: 0, dispatched: 0 }); expect(fixture.trips).toBe(2);
    expect(fixture.calls.every((r) => /^SELECT/.test(r.query))).toBe(true); expect(state.sendBatch).not.toHaveBeenCalled();
  });
  it("scopes a mutation to its owner without rebuilding global candidates", async () => {
    for (let i = 0; i < 200; i++) fixture.entry(`b${i}`, `/b${i}`, "bob");
    fixture.entry("mine"); fixture.reset();
    expect(await dispatchBackground("alice")).toMatchObject({ dispatched: 1 });
    expect(state.sendBatch.mock.calls[0][0]).toMatchObject([{ body: { id: "mine", kind: "index" } }]);
    expect(fixture.calls.every((r) => !/INSERT INTO queue_outbox|FROM index_jobs|FROM index_job_status/.test(r.query))).toBe(true);
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM resource_work WHERE owner_id='bob' AND due_at<=?").get(at)!.n).toBe(200);
  });
  it("advances across paused/noisy work fairly and resumes without losing jobs", async () => {
    fixture.sqlite.exec("INSERT INTO resource_policies(owner_id,indexing_paused) VALUES('alice',1)");
    for (let i = 0; i < 125; i++) fixture.entry(`a${String(i).padStart(3, "0")}`);
    for (let i = 0; i < 60; i++) fixture.entry(`z${String(i).padStart(3, "0")}`, `/z${i}`, "bob");
    const examined = [], sent = new Set<string>();
    state.sendBatch.mockImplementation(async (messages) => messages.forEach((m: any) => sent.add(m.body.id)));
    for (let i = 0; i < 4; i++) examined.push((await dispatchBackground()).examined);
    expect(Math.max(...examined)).toBe(50); expect(sent.size).toBe(60); expect([...sent].every((id) => id.startsWith("z"))).toBe(true);
    fixture.sqlite.exec("UPDATE resource_policies SET indexing_paused=0 WHERE owner_id='alice'");
    for (let i = 0; i < 3; i++) await dispatchBackground();
    expect(sent.size).toBe(185);
  });
  it("recovers ambiguous sends and rejects stale generations after requeue", async () => {
    fixture.entry("file");
    state.sendBatch.mockRejectedValueOnce(new Error("ambiguous send"));
    await expect(dispatchBackground()).rejects.toThrow("ambiguous send");
    const old = state.sendBatch.mock.calls[0][0][0].body;
    expect((await dispatchBackground()).dispatched).toBe(0);
    fixture.sqlite.exec("UPDATE entries SET etag='new' WHERE id='file'");
    const current = fixture.sqlite.prepare("SELECT generation FROM resource_work").get()!.generation;
    expect(current).not.toBe(old.generation);
    const stale = message(old, true); await consumeBackground(stale.batch);
    expect(stale.ack).toHaveBeenCalledOnce(); expect(fixture.sqlite.prepare("SELECT last_error FROM index_job_status").get()!.last_error).toBeNull();
    await dispatchBackground(); expect(state.sendBatch).toHaveBeenCalledTimes(2);
    const work = state.sendBatch.mock.calls[1][0][0].body;
    const currentMessage = message(work); await consumeBackground(currentMessage.batch);
    expect(currentMessage.ack).toHaveBeenCalledOnce(); expect(fixture.sqlite.prepare("SELECT 1 FROM resource_work").get()).toBeUndefined();
    const duplicate = message(work); await consumeBackground(duplicate.batch);
    expect(duplicate.ack).toHaveBeenCalledOnce(); expect(state.get).toHaveBeenCalledOnce();
  });
  it("recovers a failed send after its lease without a new mutation", async () => {
    fixture.entry("file"); state.sendBatch.mockRejectedValueOnce(new Error("send"));
    await expect(dispatchBackground()).rejects.toThrow("send");
    at += 60001; expect((await dispatchBackground()).dispatched).toBe(1);
  });
  it("ignores delayed duplicates and dead letters after completed work is recreated", async () => {
    fixture.entry("file"); await dispatchBackground();
    const old = state.sendBatch.mock.calls[0][0][0].body;
    await consumeBackground(message(old).batch);
    fixture.sqlite.exec("INSERT INTO index_jobs VALUES('file')");
    const current = fixture.sqlite.prepare("SELECT generation FROM resource_work WHERE id='file'").get()!.generation;
    expect(current).not.toBe(old.generation);
    await consumeBackground(message(old).batch); await consumeBackground(message(old, true).batch);
    expect(fixture.sqlite.prepare("SELECT generation FROM resource_work WHERE id='file'").get()!.generation).toBe(current);
    expect(fixture.sqlite.prepare("SELECT attempts FROM index_job_status WHERE entry_id='file'").get()!.attempts).toBe(0);
    expect(state.get).toHaveBeenCalledOnce();
  });
  it("keeps newer source work when an old or legacy index read finishes late", async () => {
    for (const legacy of [false, true]) {
      const id = legacy ? "legacy" : "modern"; fixture.entry(id);
      const generation = fixture.sqlite.prepare("SELECT generation FROM resource_work WHERE id=?").get(id)!.generation;
      const gate = deferred<string>(); state.get.mockResolvedValueOnce({ size: 10, text: () => gate.promise });
      const task = consumeBackground(message({ id, kind: "index", ...(legacy ? {} : { generation }) }).batch);
      await vi.waitFor(() => expect(state.get).toHaveBeenCalledTimes(legacy ? 2 : 1));
      fixture.sqlite.prepare("DELETE FROM index_jobs WHERE entry_id=?").run(id);
      fixture.sqlite.prepare("INSERT INTO index_jobs VALUES(?)").run(id);
      gate.resolve("old content"); await task;
      expect(fixture.sqlite.prepare("SELECT 1 FROM index_jobs WHERE entry_id=?").get(id)).toBeDefined();
      expect(fixture.sqlite.prepare("SELECT 1 FROM search_documents WHERE entry_id=?").get(id)).toBeUndefined();
    }
  });
  it("wraps a frozen dispatch cycle even while newer work continuously arrives", async () => {
    fixture.sqlite.exec("INSERT INTO resource_policies(owner_id,indexing_paused) VALUES('alice',1)");
    for (let i = 0; i < 100; i++) fixture.entry(`a${i}`);
    for (let i = 0; i < 100; i++) fixture.entry(`z${i}`, `/z${i}`, "bob");
    const sent = new Set<string>();
    state.sendBatch.mockImplementation(async (messages) => {
      for (const { body } of messages) { sent.add(body.id); fixture.sqlite.prepare("DELETE FROM index_jobs WHERE entry_id=?").run(body.id); }
    });
    await dispatchBackground();
    fixture.sqlite.exec("UPDATE resource_policies SET indexing_paused=0");
    for (let turn = 0; turn < 7; turn++) {
      at += 1000;
      for (let i = 0; i < 50; i++) {
        const id = `new${turn}_${i}`; fixture.entry(id, `/${id}`, "bob");
        fixture.sqlite.prepare("UPDATE index_job_status SET next_attempt=? WHERE entry_id=?").run(at, id);
      }
      expect((await dispatchBackground()).examined).toBeLessThanOrEqual(50);
    }
    expect([...sent].filter((id) => id.startsWith("a"))).toHaveLength(100);
  });
  it("accepts old work messages but never lets old dead letters retire current work", async () => {
    fixture.entry("file");
    const dead = message({ id: "file", kind: "index" }, true); await consumeBackground(dead.batch);
    expect(fixture.sqlite.prepare("SELECT attempts,next_attempt FROM index_job_status").get()).toEqual({ attempts: 0, next_attempt: 0 });
    const legacy = message({ id: "file", kind: "index" }); await consumeBackground(legacy.batch);
    expect(legacy.ack).toHaveBeenCalledOnce(); expect(fixture.sqlite.prepare("SELECT 1 FROM index_jobs").get()).toBeUndefined();
  });
  it("joins concurrent dispatches and claims each selected source only once", async () => {
    fixture.entry("file"); const gate = deferred();
    state.sendBatch.mockImplementation(() => gate.promise);
    const first = dispatchBackground();
    await vi.waitFor(() => expect(state.sendBatch).toHaveBeenCalledOnce());
    expect((await dispatchBackground()).dispatched).toBe(0);
    gate.resolve(); await first; expect(state.sendBatch).toHaveBeenCalledOnce();
  });
  it("pauses webhook delivery at the live fetch boundary, then resumes", async () => {
    hook(); delivery("delivery");
    const fetch = vi.fn().mockResolvedValue(new Response("ok")); vi.stubGlobal("fetch", fetch);
    fixture.beforeStatement = (q) => {
      if (q.startsWith("SELECT * FROM webhooks")) { fixture.beforeStatement = () => {}; fixture.sqlite.exec("INSERT INTO resource_policies(owner_id,webhooks_paused) VALUES('alice',1)"); }
    };
    await deliverWebhooks("delivery"); expect(fetch).not.toHaveBeenCalled();
    fixture.sqlite.exec("UPDATE resource_policies SET webhooks_paused=0"); at += 60001;
    await deliverWebhooks("delivery"); expect(fetch).toHaveBeenCalledOnce(); projection();
  });
  it("does not finalize a newer webhook retry when an older HTTP response arrives", async () => {
    hook(); delivery("delivery");
    const started = deferred(), finish = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(async () => { started.resolve(); return finish.promise; }));
    const pending = deliverWebhooks("delivery"); await started.promise;
    const old = fixture.sqlite.prepare("SELECT generation FROM resource_work WHERE id='delivery'").get()!.generation;
    fixture.sqlite.exec("UPDATE webhook_deliveries SET status='failed' WHERE id='delivery'; UPDATE webhook_deliveries SET status='pending',attempts=0,next_attempt=0 WHERE id='delivery'");
    expect(fixture.sqlite.prepare("SELECT generation FROM resource_work WHERE id='delivery'").get()!.generation).toBeGreaterThan(old as number);
    finish.resolve(new Response("ok")); await pending;
    expect(fixture.sqlite.prepare("SELECT status,attempts FROM webhook_deliveries WHERE id='delivery'").get()).toEqual({ status: "pending", attempts: 0 });
    await consumeBackground(message({ id: "delivery", kind: "webhook", generation: old }, true).batch);
    expect(fixture.sqlite.prepare("SELECT status FROM webhook_deliveries WHERE id='delivery'").get()!.status).toBe("pending");
  });
});

describe("durable health turns", () => {
  it("uses one indexed read and zero writes when quiet", async () => {
    expect(await evaluateHealth()).toEqual({ evaluated: 0 });
    expect(fixture.trips).toBe(1); expect(fixture.calls[0].query).toMatch(/^SELECT/);
  });
  it("bounds a turn to 100 owners and eventually processes every owner", async () => {
    for (let i = 0; i < 301; i++) fixture.sqlite.prepare("INSERT INTO operation_metrics VALUES(?,?,'api',10,10,0,50000)").run(`owner${String(i).padStart(3, "0")}`, Math.floor(at / 60000));
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await evaluateHealth()).evaluated);
    expect(results).toEqual([100, 100, 100, 1]);
    expect(fixture.sqlite.prepare("SELECT count(DISTINCT owner_id) AS n FROM health_alerts").get()!.n).toBe(301);
    expect(Math.max(...fixture.calls.map((r) => r.params.length))).toBeLessThanOrEqual(4);
  });
  it("never clears a dirty revision that changes during evaluation", async () => {
    fixture.sqlite.prepare("INSERT INTO operation_metrics VALUES('alice',?,'api',10,0,0,100)").run(Math.floor(at / 60000));
    fixture.beforeStatement = (q) => {
      if (q.startsWith("INSERT INTO health_alerts")) { fixture.beforeStatement = () => {}; fixture.sqlite.exec("UPDATE operation_metrics SET errors=10 WHERE owner_id='alice'"); }
    };
    await evaluateHealth();
    expect(fixture.sqlite.prepare("SELECT 1 FROM resource_health_queue WHERE owner_id='alice'").get()).toBeDefined();
    at += 2; await evaluateHealth();
    expect(fixture.sqlite.prepare("SELECT kind FROM health_alerts WHERE resolved_at IS NULL").get()!.kind).toBe("errors");
  });
  it("does not acknowledge recreated dirty state with an older revision", async () => {
    fixture.sqlite.prepare("INSERT INTO operation_metrics VALUES('alice',?,'api',10,0,0,100)").run(Math.floor(at / 60000));
    const first = fixture.sqlite.prepare("SELECT revision FROM resource_health_queue WHERE owner_id='alice'").get()!.revision;
    fixture.beforeStatement = (q) => {
      if (q.startsWith("INSERT INTO health_alerts")) {
        fixture.beforeStatement = () => {};
        fixture.sqlite.exec("DELETE FROM resource_health_queue WHERE owner_id='alice'; UPDATE operation_metrics SET errors=10 WHERE owner_id='alice'");
      }
    };
    await evaluateHealth();
    expect(fixture.sqlite.prepare("SELECT revision FROM resource_health_queue WHERE owner_id='alice'").get()!.revision).toBeGreaterThan(first as number);
    at += 2; await evaluateHealth();
    expect(fixture.sqlite.prepare("SELECT kind FROM health_alerts WHERE resolved_at IS NULL").get()!.kind).toBe("errors");
  });
  it("reschedules both owners when recent metrics move", async () => {
    fixture.sqlite.prepare("INSERT INTO operation_metrics VALUES('alice',?,'api',10,10,0,100)").run(Math.floor(at / 60000));
    await evaluateHealth(); at += 2; await evaluateHealth();
    fixture.sqlite.exec("UPDATE operation_metrics SET owner_id='bob'");
    await evaluateHealth();
    expect(fixture.sqlite.prepare("SELECT owner_id FROM health_alerts WHERE resolved_at IS NULL").all()).toEqual([{ owner_id: "bob" }]);
  });
  it("resolves metrics by their original 10-minute evaluation window without traffic", async () => {
    fixture.sqlite.prepare("INSERT INTO operation_metrics VALUES('alice',?,'api',10,10,0,50000)").run(Math.floor(at / 60000));
    await evaluateHealth(); at += 2; await evaluateHealth();
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM health_alerts WHERE resolved_at IS NULL").get()!.n).toBe(2);
    at += 11 * 60000;
    await evaluateHealth(); at += 2; await evaluateHealth();
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM health_alerts WHERE resolved_at IS NULL").get()!.n).toBe(0);
    fixture.reset(); await evaluateHealth(); expect(fixture.calls.every((r) => /^SELECT/.test(r.query))).toBe(true);
    at += 60 * 60000; expect((await health(auth)).metrics).toEqual([]);
  });
  it("reschedules source changes and resolves deleted webhook/index conditions", async () => {
    fixture.entry("file"); hook(); delivery("failed", "failed");
    fixture.sqlite.exec("INSERT INTO health_thresholds VALUES('alice',10,1,2000)");
    await evaluateHealth(); at += 2; await evaluateHealth();
    expect(fixture.sqlite.prepare("SELECT kind FROM health_alerts WHERE resolved_at IS NULL ORDER BY kind").all()).toEqual([{ kind: "indexing" }, { kind: "webhooks" }]);
    fixture.sqlite.exec("DELETE FROM entries WHERE id='file'; DELETE FROM webhooks WHERE id='hook'");
    await evaluateHealth();
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM health_alerts WHERE resolved_at IS NULL").get()!.n).toBe(0);
  });
});
