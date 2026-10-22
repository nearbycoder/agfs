import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred, serverFixture } from "./server-expansion-fixture.test-utils";

const state = vi.hoisted(() => ({ fixture: null as any, get: vi.fn() }));
vi.mock("./bindings", () => ({
  requireResourceBindings: () => ({
    DB: {
      prepare: (query: string) => state.fixture.binding.prepare(query),
      batch: (queries: unknown[]) => state.fixture.binding.batch(queries),
    },
    FILES_BUCKET: { get: state.get },
  }),
}));
import { indexFiles, tagFile } from "./search";
import { deliverWebhooks } from "./webhooks";
import { forEachConcurrent } from "./server-concurrency";

let fixture: ReturnType<typeof serverFixture>;
beforeEach(() => {
  fixture = serverFixture(); state.fixture = fixture;
  state.get.mockReset().mockImplementation(async (key) => ({ size: 10, text: async () => `body ${key}` }));
});
afterEach(() => { fixture.sqlite.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("#44 bounded index prefetch", () => {
  it("overlaps three R2 bodies per wave while keeping per-file D1 writes serial", async () => {
    for (let i = 0; i < 7; i++) fixture.entry(`e${i}`);
    const gates = Array.from({ length: 7 }, () => deferred());
    const started: number[] = []; let active = 0, peak = 0;
    state.get.mockImplementation(async (key: string) => {
      const index = Number(key.slice(1)); started.push(index); peak = Math.max(peak, ++active);
      await gates[index].promise; active--;
      return { size: 10, text: async () => `body ${key}` };
    });
    const pending = indexFiles();
    await vi.waitFor(() => expect(started).toHaveLength(3));
    expect(fixture.batches).toEqual([]);
    gates[2].resolve(); gates[0].resolve(); gates[1].resolve();
    await vi.waitFor(() => expect(started).toHaveLength(6));
    expect(fixture.batches).toEqual([4, 4, 4]);
    gates[5].resolve(); gates[4].resolve(); gates[3].resolve();
    await vi.waitFor(() => expect(started).toHaveLength(7));
    gates[6].resolve();
    expect(await pending).toBe(7); expect(peak).toBe(3);
    expect(fixture.batches).toEqual(Array(7).fill(4));
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM file_search WHERE file_search MATCH 'body'").get()!.n).toBe(7);
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM index_jobs").get()!.n).toBe(0);
  });
  it("keeps a replaced object queued and never publishes stale fetched content", async () => {
    fixture.entry("e");
    state.get.mockImplementationOnce(async () => {
      fixture.sqlite.exec("UPDATE entries SET r2_key='replacement',updated_at=updated_at+1 WHERE id='e'");
      return { size: 10, text: async () => "stale" };
    });
    await indexFiles();
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM index_jobs").get()!.n).toBe(1);
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM file_search").get()!.n).toBe(0);
    await indexFiles();
    expect(fixture.sqlite.prepare("SELECT content FROM search_documents").get()!.content).toBe("body replacement");
  });
  it("retries failed reads, indexes successful wave peers, and propagates targeted failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fixture.entry("bad"); fixture.entry("good");
    state.get.mockImplementation(async (key) => { if (key === "bad") throw new Error("unavailable"); return { size: 10, text: async () => "good" }; });
    expect(await indexFiles()).toBe(2);
    expect(fixture.sqlite.prepare("SELECT entry_id,attempts,last_error FROM index_job_status").all()).toEqual([{ entry_id: "bad", attempts: 1, last_error: "Object could not be indexed" }]);
    expect(fixture.sqlite.prepare("SELECT entry_id FROM file_search").all()).toEqual([{ entry_id: "good" }]);
    fixture.sqlite.exec("UPDATE index_job_status SET next_attempt=0");
    await expect(indexFiles(1, "bad")).rejects.toThrow("unavailable");
  });
  it("caps selection at twenty and cancels oversized object bodies", async () => {
    for (let i = 0; i < 25; i++) fixture.entry(`e${i}`);
    const cancel = vi.fn();
    state.get.mockResolvedValue({ size: 2_000_000, body: { cancel } });
    expect(await indexFiles(10000)).toBe(20);
    expect(cancel).toHaveBeenCalledTimes(20);
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM index_jobs").get()!.n).toBe(5);
  });
  it("bounds expanded invalid UTF-8 before D1 binding and completes the indexing job", async () => {
    fixture.entry("invalid");
    const decoded = new TextDecoder().decode(new Uint8Array(700000).fill(0xff));
    expect(new TextEncoder().encode(decoded).length).toBe(2100000);
    fixture.sqlite.exec("UPDATE entries SET size=700000 WHERE id='invalid'");
    state.get.mockResolvedValue({ size: 700000, text: async () => decoded });
    await indexFiles(1, "invalid");
    const saved = fixture.sqlite.prepare("SELECT content,content_verified FROM search_documents").get()!;
    expect(new TextEncoder().encode(saved.content as string).length).toBe(1048575);
    expect(saved.content).toBe("\ufffd".repeat(349525));
    expect(saved.content_verified).toBe(1);
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM index_jobs").get()!.n).toBe(0);
    expect(fixture.calls.flatMap((call) => call.params).filter((value) => typeof value === "string").every((value) => Buffer.byteLength(value as string) <= 1048576)).toBe(true);
  });
  it.each(["a".repeat(1048576), "😀".repeat(262144)])("preserves valid text at the full 1 MiB limit %#", async (content) => {
    fixture.entry("valid"); fixture.sqlite.exec("UPDATE entries SET size=1048576 WHERE id='valid'");
    state.get.mockResolvedValue({ size: 1048576, text: async () => content });
    await indexFiles();
    expect(fixture.sqlite.prepare("SELECT content FROM search_documents").get()!.content).toBe(content);
  });
});

describe("#45 reuse verified immutable indexed content", () => {
  it("reindexes names and tags with zero R2 reads and without returning document text to the Worker", async () => {
    fixture.entry("e"); await indexFiles(); state.get.mockClear(); fixture.reset();
    fixture.sqlite.exec("UPDATE entries SET name='renamed' WHERE id='e'");
    await tagFile({ authSource: "session", user: { id: "alice", email: "alice@example.test", name: "Alice" } }, "/e", ["release"]);
    await indexFiles();
    expect(state.get).not.toHaveBeenCalled();
    expect(fixture.sqlite.prepare("SELECT name,content,tags FROM file_search").all()).toEqual([{ name: "renamed", content: "body e", tags: '["release"]' }]);
    const selection = fixture.calls.find((call) => call.query.includes("AS reusable"))!;
    expect(fixture.sqlite.prepare(selection.query).columns().map((column) => column.name)).not.toContain("content");
  });
  it("refetches replacement keys and unverified legacy or tag-only placeholders", async () => {
    fixture.entry("e");
    fixture.sqlite.exec("INSERT INTO search_documents(entry_id,object_key,content,indexed_at) VALUES('e','e','legacy',1)");
    await indexFiles(); expect(state.get).toHaveBeenCalledTimes(1);
    fixture.sqlite.exec("UPDATE entries SET r2_key='new' WHERE id='e'");
    await indexFiles(); expect(state.get).toHaveBeenLastCalledWith("new");
    fixture.sqlite.exec("UPDATE search_documents SET indexed_at=0,content='placeholder'; INSERT INTO index_jobs VALUES('e')");
    await indexFiles(); expect(state.get).toHaveBeenCalledTimes(3);
  });
  it("does not permanently reuse an empty index from a missing object", async () => {
    fixture.entry("e"); state.get.mockResolvedValueOnce(null);
    await indexFiles();
    expect(fixture.sqlite.prepare("SELECT content_verified FROM search_documents").get()!.content_verified).toBe(0);
    fixture.sqlite.exec("INSERT INTO index_jobs VALUES('e')");
    await indexFiles();
    expect(state.get).toHaveBeenCalledTimes(2);
    expect(fixture.sqlite.prepare("SELECT content FROM search_documents").get()!.content).toBe("body e");
  });
  it("does not reuse content when the file is no longer eligible for text indexing", async () => {
    fixture.entry("e"); await indexFiles();
    fixture.sqlite.exec("UPDATE entries SET size=2000000 WHERE id='e'");
    await indexFiles();
    expect(fixture.sqlite.prepare("SELECT content,content_verified FROM search_documents").get()).toEqual({ content: "", content_verified: 0 });
  });
});

describe("#47 bounded webhook delivery", () => {
  function seed(count: number) {
    fixture.sqlite.exec("INSERT INTO webhooks(id,owner_id,url,path_prefix,events,secret,created_at) VALUES('hook','alice','https://hooks.agfs.dev','/','[\"*\"]','test-secret',1)");
    const insert = fixture.sqlite.prepare("INSERT INTO webhook_deliveries(id,webhook_id,event_id,payload,next_attempt,created_at) VALUES(?,'hook',?,'{}',0,1)");
    for (let i = 0; i < count; i++) insert.run(`d${i}`, `event${i}`);
  }
  it("overlaps three deliveries, joins completion, and cancels every response body", async () => {
    seed(7);
    const gates = Array.from({ length: 7 }, () => deferred());
    const cancel = vi.fn(); const started: number[] = []; let active = 0, peak = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const index = Number(init.headers["x-agfs-event-id"].slice(5)); started.push(index); peak = Math.max(peak, ++active);
      expect(init.redirect).toBe("manual"); expect(init.signal).toBeInstanceOf(AbortSignal);
      await gates[index].promise; active--;
      return { status: 200, ok: true, body: { cancel } };
    }));
    let settled = false;
    const pending = deliverWebhooks().then((value) => { settled = true; return value; });
    await vi.waitFor(() => expect(started).toHaveLength(3));
    gates[0].resolve(); await vi.waitFor(() => expect(started).toHaveLength(4));
    expect(settled).toBe(false);
    gates.forEach((gate) => gate.resolve());
    expect(await pending).toBe(7); expect(peak).toBe(3); expect(cancel).toHaveBeenCalledTimes(7);
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM webhook_deliveries WHERE status='delivered' AND attempts=1").get()!.n).toBe(7);
  });
  it("rechecks enabled state after claiming and skips a concurrently claimed row", async () => {
    seed(2); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    fixture.beforeStatement = (query, params) => {
      if (!query.startsWith("UPDATE webhook_deliveries SET status='sending'")) return;
      if (params[1] === "d0") fixture.sqlite.exec("UPDATE webhook_deliveries SET next_attempt=9007199254740991 WHERE id='d0'");
      else fixture.sqlite.exec("UPDATE webhooks SET enabled=0");
    };
    await deliverWebhooks(); expect(fetch).not.toHaveBeenCalled();
    expect(fixture.sqlite.prepare("SELECT attempts FROM webhook_deliveries WHERE id='d0'").get()!.attempts).toBe(0);
  });
  it("preserves retry and exhaustion state and signs with live rotated secrets", async () => {
    seed(2);
    fixture.sqlite.exec("UPDATE webhook_deliveries SET attempts=7 WHERE id='d1'; UPDATE webhooks SET previous_secret='previous',previous_secret_until=9007199254740991");
    const fetch = vi.fn(async (_url, init) => {
      expect(init.headers["x-agfs-signature"].match(/v1=/g)).toHaveLength(2);
      return new Response("busy", { status: 503 });
    });
    vi.stubGlobal("fetch", fetch); await deliverWebhooks();
    expect(fixture.sqlite.prepare("SELECT status,attempts,last_status FROM webhook_deliveries ORDER BY id").all()).toEqual([
      { status: "pending", attempts: 1, last_status: 503 }, { status: "failed", attempts: 8, last_status: 503 },
    ]);
  });
  it("always cancels a fetched body when the post-fetch database write fails", async () => {
    seed(7);
    let open = 0, peak = 0;
    const cancel = vi.fn(() => { open--; });
    vi.stubGlobal("fetch", vi.fn(async () => {
      peak = Math.max(peak, ++open);
      return new Response(new ReadableStream({ cancel }), { status: 200 });
    }));
    fixture.beforeStatement = (query) => {
      if (query.startsWith("UPDATE webhooks SET last_used_at=")) throw new Error("D1 temporarily unavailable");
    };
    expect(await deliverWebhooks()).toBe(7);
    expect(cancel).toHaveBeenCalledTimes(7); expect(open).toBe(0); expect(peak).toBeLessThanOrEqual(3);
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM webhook_deliveries WHERE status='pending' AND attempts=1 AND last_error='Delivery failed or timed out'").get()!.n).toBe(7);
  });
  it("cancels responses and joins peers even if final delivery-state persistence fails", async () => {
    seed(7); const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ cancel }), { status: 200 })));
    fixture.beforeStatement = (query) => {
      if (query.startsWith("UPDATE webhook_deliveries SET status=") && !query.startsWith("UPDATE webhook_deliveries SET status='sending'"))
        throw new Error("finalization failed");
    };
    await expect(deliverWebhooks()).rejects.toThrow("finalization failed");
    expect(cancel).toHaveBeenCalledTimes(3);
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM webhook_deliveries WHERE attempts=0").get()!.n).toBe(4);
  });
});

describe("server worker lifetime", () => {
  it("stops scheduling after the first fatal error and waits for active peers", async () => {
    const first = deferred(), second = deferred(), started: number[] = [];
    let settled = false;
    const pending = forEachConcurrent([0, 1, 2, 3, 4], 2, async (item) => {
      started.push(item); await (item === 0 ? first.promise : second.promise);
    }).catch((error) => { settled = true; return error; });
    const error = new Error("first"); first.reject(error);
    await vi.waitFor(() => expect(started).toEqual([0, 1]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false); second.resolve();
    expect(await pending).toBe(error); expect(started).toEqual([0, 1]);
  });
});
