import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { AgfsClient, mapConcurrentIterable } from "./index";
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; };
const collect = async <T>(items: AsyncIterable<T>) => { const result: T[] = []; for await (const item of items) result.push(item); return result; };

it("maps strings and lazy inputs in order with bounded pulls/results and closes on break", async () => {
  expect(await collect(mapConcurrentIterable("abc", 2, async (v) => v.toUpperCase()))).toEqual(["A", "B", "C"]);
  let pulls = 0, closed = false;
  function* input() { try { for (let i = 0; i < 10000; i++) { pulls++; yield i; } } finally { closed = true; } }
  const gate = deferred();
  const work = vi.fn(async (value: number) => { if (!value) await gate.promise; return value; });
  const stream = mapConcurrentIterable(input(), 3, work);
  const next = stream.next();
  await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(3));
  expect(pulls).toBe(3);
  gate.resolve();
  expect((await next).value).toBe(0);
  expect(pulls).toBe(3);
  await stream.return();
  expect(closed).toBe(true);
  expect(work).toHaveBeenCalledTimes(3);
});

it("drains active workers, closes input, and preserves the first failure", async () => {
  const gate = deferred(); const failure = new Error("first"); let closed = false;
  function* input() { try { yield* [0, 1, 2, 3]; } finally { closed = true; throw new Error("cleanup failure"); } }
  const work = vi.fn(async (value: number) => {
    if (value === 0) { await gate.promise; throw new Error("later"); }
    throw failure;
  });
  const done = collect(mapConcurrentIterable(input(), 2, work));
  const rejection = expect(done).rejects.toBe(failure);
  await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(2));
  expect(closed).toBe(false);
  gate.resolve(); await rejection;
  expect(closed).toBe(true);
  expect(work).toHaveBeenCalledTimes(2);
});

it("aborts before source consumption and cleans up after a consumer break", async () => {
  const controller = new AbortController(); controller.abort(new Error("cancel"));
  const next = vi.fn();
  await expect(collect(mapConcurrentIterable({ [Symbol.iterator]: () => ({ next }) }, 2, async () => 1, controller.signal))).rejects.toThrow("cancel");
  expect(next).not.toHaveBeenCalled();
  for (const value of [0, 9, NaN, 1.5])
    await expect(collect(mapConcurrentIterable([], value, async () => 1))).rejects.toThrow("Concurrency");
});

const PART = 8388608;
function clientFixture(status = "pending", parts: unknown[] = []) {
  const bodies: Uint8Array[] = []; const calls: string[] = [];
  const transport = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push(url);
    if (url.endsWith("/fs/resumable")) return Response.json({ uploadId: "upl_stream", partSize: PART, status, parts });
    if (url.includes("/parts/")) { bodies.push(new Uint8Array(init!.body as Uint8Array)); return Response.json({}); }
    if (url.endsWith("/complete")) return Response.json({ entry: { path: "/stream" } });
    if (url.endsWith("/upload-intents")) return Response.json({ uploadId: "upl_empty", url: "https://www.agfs.dev/api/v1/fs/uploads/upl_empty/blob", headers: {} });
    if (url.endsWith("/blob")) return new Response(null);
    if (url.endsWith("/commit")) return Response.json({ entry: { path: "/stream" } });
    throw new Error(url);
  });
  return { client: new AgfsClient({ token: "secret", fetch: transport, retries: 0 }), transport, bodies, calls };
}
function byteStream(chunks: Uint8Array[]) { let index = 0; return new ReadableStream<Uint8Array>({ pull(controller) { if (index < chunks.length) controller.enqueue(chunks[index++]); else controller.close(); } }, { highWaterMark: 0 }); }

it("uploads arbitrarily fragmented streams as bounded sequential parts with exact bytes", async () => {
  const f = clientFixture(); const progress: number[] = [];
  const chunk = new Uint8Array(PART + 19).fill(7); chunk[PART + 18] = 42;
  await f.client.uploadStream("/stream", byteStream([chunk.subarray(0, 2), new Uint8Array(), chunk.subarray(2)]), chunk.length, { onProgress: (bytes) => progress.push(bytes), ifMatch: null });
  expect(f.bodies.map((b) => b.length)).toEqual([PART, 19]);
  expect(Buffer.concat(f.bodies).equals(Buffer.from(chunk))).toBe(true);
  expect(progress).toEqual([PART, PART + 19]);
  const start = JSON.parse(f.transport.mock.calls[0][1]!.body as string);
  expect(start.ifMatch).toBe(null);
});

it.each(["short", "extra", "error"])("never completes a %s stream and releases its reader", async (mode) => {
  const f = clientFixture(); let reads = 0, cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) {
    if (reads++ === 0) controller.enqueue(new Uint8Array(PART));
    else if (mode === "extra") { controller.enqueue(new Uint8Array(2)); controller.close(); }
    else if (mode === "error") controller.error(new Error("broken stream"));
    else controller.close();
  }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  await expect(f.client.uploadStream("/stream", stream, PART + 1)).rejects.toThrow();
  expect(f.calls.some((p) => p.endsWith("/complete"))).toBe(false);
  expect(stream.locked).toBe(false);
  if (mode === "extra") expect(cancelled || stream.locked === false).toBe(true);
});

it("validates completing resumes and zero-byte streams before a commit", async () => {
  const f = clientFixture("completing", [{ partNumber: 1, digest: createHash("sha256").update(new Uint8Array(PART)).digest("hex") }, { partNumber: 2, digest: "0".repeat(64) }]);
  await expect(f.client.uploadStream("/stream", byteStream([new Uint8Array(PART)]), PART + 1)).rejects.toThrow("size mismatch");
  expect(f.calls.some((p) => p.endsWith("/complete"))).toBe(false);
  const empty = clientFixture();
  await expect(empty.client.uploadStream("/stream", byteStream([new Uint8Array(1)]), 0)).rejects.toThrow("size mismatch");
  expect(empty.calls).toHaveLength(0);
  await empty.client.uploadStream("/stream", byteStream([]), 0);
  expect(empty.calls.at(-1)).toContain("/commit");
});

it("cancels a blocked source when the client aborts, without a commit", async () => {
  const controller = new AbortController(); let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull() {}, cancel() { cancelled = true; } });
  const transport = vi.fn();
  const client = new AgfsClient({ token: "secret", fetch: transport, signal: controller.signal });
  const done = client.uploadStream("/stream", stream, 5);
  const result = expect(done).rejects.toThrow("stop");
  controller.abort(new Error("stop")); await result;
  expect(cancelled).toBe(true); expect(stream.locked).toBe(false); expect(transport).not.toHaveBeenCalled();
});

it("retries an immutable buffered PUT without rereading a consumed source", async () => {
  const f = clientFixture(); const transport = f.transport; let attempts = 0, reads = 0;
  const client = new AgfsClient({ token: "secret", retries: 1, fetch: async (input, init) => {
    if (String(input).includes("/parts/") && attempts++ === 0) return new Response(null, { status: 503 });
    return transport(input, init);
  } });
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { reads++; controller.enqueue(new Uint8Array([1, 2])); controller.close(); } });
  await client.uploadStream("/stream", stream, 2);
  expect(reads).toBe(1); expect(attempts).toBe(2); expect(f.bodies).toEqual([new Uint8Array([1, 2])]);
});

it("yields ready ordered work while a source pull waits for consumer acknowledgment", async () => {
  const ack = deferred(), waiting = deferred(), finishWork = deferred();
  let emitted = false, closed = false;
  async function* source() {
    try { yield 1; waiting.resolve(); await ack.promise; yield 2; }
    finally { closed = true; }
  }
  const output = mapConcurrentIterable(source(), 2, async (value) => {
    if (value === 1) await finishWork.promise;
    return value * 10;
  });
  const first = output.next().then((result) => { emitted = true; return result; });
  try {
    await waiting.promise;
    finishWork.resolve();
    await vi.waitFor(() => expect(emitted).toBe(true), { timeout: 1000 });
    expect((await first).value).toBe(10);
    ack.resolve();
    expect((await output.next()).value).toBe(20);
    expect((await output.next()).done).toBe(true);
    expect(closed).toBe(true);
  } finally {
    ack.resolve(); finishWork.resolve();
    await first; await output.return();
  }
});

it("closes a cooperative blocked source pull on early return and joins its workers", async () => {
  const waiting = deferred(), close = deferred(), finishWork = deferred();
  let pulls = 0, activePulls = 0, peakPulls = 0;
  const returned = vi.fn(async () => { close.resolve(); return { done: true as const, value: undefined }; });
  const source = {
    [Symbol.asyncIterator]() { return {
      async next() {
        activePulls++; peakPulls = Math.max(peakPulls, activePulls);
        try {
          if (++pulls === 1) return { done: false as const, value: 1 };
          waiting.resolve(); await close.promise;
          return { done: true as const, value: undefined };
        } finally { activePulls--; }
      },
      return: returned,
    }; },
  };
  const work = vi.fn(async (value: number) => { await finishWork.promise; return value; });
  const output = mapConcurrentIterable(source, 2, work);
  const first = output.next();
  await waiting.promise; finishWork.resolve();
  expect((await first).value).toBe(1);
  await output.return();
  expect(returned).toHaveBeenCalledOnce(); expect(peakPulls).toBe(1); expect(activePulls).toBe(0);
  expect(work).toHaveBeenCalledTimes(1); expect(pulls).toBe(2);
});

it("joins active callbacks when an asynchronous source pull fails", async () => {
  const finishWork = deferred(), waiting = deferred(); const error = new Error("source failed");
  let worked = false, closed = false, calls = 0;
  const source = { [Symbol.asyncIterator]() { return {
    async next() { if (++calls === 1) return { done: false as const, value: 1 }; waiting.resolve(); throw error; },
    async return() { closed = true; return { done: true as const, value: undefined }; },
  }; } };
  const result = collect(mapConcurrentIterable(source, 2, async () => { await finishWork.promise; worked = true; return 1; }));
  const checked = expect(result).rejects.toBe(error);
  await waiting.promise;
  expect(worked).toBe(false);
  finishWork.resolve(); await checked;
  expect(worked).toBe(true); expect(closed).toBe(true); expect(calls).toBe(2);
});
