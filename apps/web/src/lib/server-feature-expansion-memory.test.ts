import { afterEach, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serverFixture } from "./server-expansion-fixture.test-utils";

// Real indexFiles and real migrated SQLite; R2 bytes are synthetic. Sampling
// Node memory is diagnostic, not a Worker peak or a deterministic memory limit.
const state = vi.hoisted(() => ({ fixture: null as any, get: vi.fn(), batch: null as any }));
vi.mock("./bindings", () => ({ requireResourceBindings: () => ({
  DB: { prepare: (q: string) => state.fixture.binding.prepare(q), batch: (q: unknown[]) => state.batch(q) },
  FILES_BUCKET: { get: state.get },
}) }));
import { indexFiles } from "./search";
afterEach(() => { state.fixture?.sqlite.close(); state.fixture = null; });

it("measures all indexing SQL/R2 operations and samples memory under bounded content policies", async () => {
  const results = [];
  for (const mode of ["content-1MiB", "metadata", "content-128KiB", "invalid-utf8"] as const) {
    const fixture = serverFixture(); state.fixture = fixture;
    const count = 20, limit = mode === "content-128KiB" ? 131072 : 1048576;
    fixture.sqlite.prepare("INSERT INTO resource_policies(owner_id,index_mode,max_text_bytes) VALUES('alice',?,?)")
      .run(mode === "metadata" ? "metadata" : "content", limit);
    for (let i = 0; i < count; i++) fixture.entry(`file${i}`);
    fixture.sqlite.prepare("UPDATE entries SET size=?").run(limit);
    fixture.reset();
    const baseline = process.memoryUsage(); let peakHeap = baseline.heapUsed, peakRss = baseline.rss;
    const sample = () => { const m = process.memoryUsage(); peakHeap = Math.max(peakHeap, m.heapUsed); peakRss = Math.max(peakRss, m.rss); };
    let r2Bytes = 0, inFlight = 0, peakReads = 0, statements = 0, returnedRows = 0;
    state.get.mockReset().mockImplementation(async (key: string) => {
      peakReads = Math.max(peakReads, ++inFlight); r2Bytes += limit;
      return { size: limit, text: async () => {
        const bytes = mode === "invalid-utf8" ? new Uint8Array(limit).fill(255) : new TextEncoder().encode((key + " ").repeat(Math.ceil(limit / (key.length + 1))).slice(0, limit));
        const text = new TextDecoder().decode(bytes);
        sample(); inFlight--; return text;
      } };
    });
    state.batch = async (queries: any[]) => {
      sample();
      const result = await fixture.binding.batch(queries);
      statements += fixture.calls.length; returnedRows += result.reduce((n: number, r: any) => n + r.results.length, 0);
      // Test instrumentation must not retain every text binding across waves.
      fixture.calls.length = 0; sample(); return result;
    };
    const beforeChanges = Number(fixture.sqlite.prepare("SELECT total_changes() AS n").get()!.n);
    const cpu = process.cpuUsage();
    expect(await indexFiles(count)).toBe(count);
    const used = process.cpuUsage(cpu); sample();
    const sizes = fixture.sqlite.prepare("SELECT length(CAST(content AS BLOB)) AS bytes FROM search_documents").all().map((r) => r.bytes as number);
    expect(sizes).toHaveLength(count); expect(Math.max(...sizes)).toBeLessThanOrEqual(limit);
    expect(fixture.sqlite.prepare("SELECT count(*) AS n FROM index_jobs").get()!.n).toBe(0);
    expect(state.get).toHaveBeenCalledTimes(mode === "metadata" ? 0 : count);
    expect(peakReads).toBeLessThanOrEqual(3); expect(fixture.trips).toBe(21); expect(statements).toBe(81);
    results.push({ mode, files: count, policyBytes: limit, r2GetOperations: state.get.mock.calls.length, syntheticR2BytesRead: r2Bytes,
      d1RoundTrips: fixture.trips, sqlStatements: statements, sqlRowsReturned: returnedRows + count,
      changedRowsIncludingTriggers: Number(fixture.sqlite.prepare("SELECT total_changes() AS n").get()!.n) - beforeChanges,
      maximumStoredTextBytes: Math.max(...sizes), peakConcurrentR2Reads: peakReads,
      localProcessCpuMicroseconds: used.user + used.system, baselineHeapBytes: baseline.heapUsed,
      peakSampledHeapBytes: peakHeap, peakSampledRssBytes: peakRss, baselineRssBytes: baseline.rss });
    fixture.sqlite.close(); state.fixture = null;
  }
  const artifact = join(tmpdir(), "agfs-server-feature-memory-20261022.json");
  writeFileSync(artifact, JSON.stringify({ measurement: "Real indexFiles with local SQLite and synthetic R2. Node process memory/CPU includes SQLite, FTS and test runtime. Sampling can miss peaks; no forced GC. SQL returned rows/total_changes are not D1 billed rows_read/rows_written. No Worker memory or billing claim.", results }, null, 2) + "\n");
  console.info(`Resource benchmark artifact: ${artifact}`);
}, 30000);
