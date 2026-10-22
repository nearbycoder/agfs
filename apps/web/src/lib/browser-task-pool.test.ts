import { describe, expect, it, vi } from "vitest";
import { browserTaskPool } from "./browser-task-pool";
import { readContextFiles } from "./browser-context-pack";
import { createFrameBatch } from "./browser-frame-batch";

function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe("bounded browser work", () => {
  it("#33 fills free slots without batch barriers and preserves requested file order", async () => {
    const pending = Array.from({ length: 6 }, () => deferred());
    const started: string[] = [];
    let active = 0,
      max = 0;
    const result = readContextFiles(
      pending.map((_, i) => "/" + i),
      async (path) => {
        started.push(path);
        max = Math.max(max, ++active);
        await pending[Number(path.slice(1))].promise;
        active--;
        return { path, text: path };
      },
      new AbortController().signal,
    );
    expect(started).toEqual(["/0", "/1", "/2"]);
    pending[1].resolve();
    await tick();
    expect(started).toEqual(["/0", "/1", "/2", "/3"]);
    pending[3].resolve();
    await tick();
    expect(started.at(-1)).toBe("/4");
    pending.forEach((p) => p.resolve());
    expect((await result).map((f) => f.path)).toEqual([
      "/0",
      "/1",
      "/2",
      "/3",
      "/4",
      "/5",
    ]);
    expect(max).toBe(3);
  });
  it("#33 aborts other reads at the aggregate byte budget without scheduling later sources", async () => {
    const started: string[] = [],
      signals: AbortSignal[] = [];
    const result = readContextFiles(
      ["/a", "/b", "/c", "/d"],
      async (path, signal) => {
        started.push(path);
        signals.push(signal);
        return { path, text: "x".repeat(150000) };
      },
      new AbortController().signal,
    );
    await expect(result).rejects.toThrow(/Combined source/);
    expect(started).toEqual(["/a", "/b", "/c"]);
    expect(signals.every((s) => s.aborted)).toBe(true);
  });
  it("#33 cancels active reads and waits for work even if a transport ignores cancellation", async () => {
    const pending = deferred();
    const controller = new AbortController();
    const started: number[] = [];
    let settled = false;
    const result = browserTaskPool(
      [0, 1, 2, 3],
      async (item, signal) => {
        started.push(item);
        await pending.promise;
        signal.throwIfAborted();
        return item;
      },
      { signal: controller.signal },
    ).finally(() => {
      settled = true;
    });
    const rejected = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await tick();
    expect(settled).toBe(false);
    expect(started).toEqual([0, 1, 2]);
    pending.resolve();
    await rejected;
  });
  it("#34 drains active uploads when paused and skips unscheduled files", async () => {
    const pending = Array.from({ length: 3 }, () => deferred());
    let paused = false;
    const started: number[] = [];
    const done: number[] = [];
    const result = browserTaskPool(
      [0, 1, 2, 3, 4],
      async (item) => {
        started.push(item);
        await pending[item].promise;
        done.push(item);
      },
      { shouldStop: () => paused },
    );
    paused = true;
    pending[1].resolve();
    await tick();
    expect(started).toEqual([0, 1, 2]);
    pending[0].resolve();
    pending[2].resolve();
    await result;
    expect(done).toEqual([1, 0, 2]);
  });
  it("#34 retains the first failure, aborts siblings, and never starts extra work", async () => {
    const pending = Array.from({ length: 3 }, () => deferred());
    const started: number[] = [],
      signals: AbortSignal[] = [];
    const first = new Error("first"),
      second = new Error("second");
    const result = browserTaskPool([0, 1, 2, 3], async (item, signal) => {
      started.push(item);
      signals.push(signal);
      await pending[item].promise;
    });
    const failed = expect(result).rejects.toBe(first);
    pending[1].reject(first);
    await tick();
    expect(signals.every((s) => s.aborted)).toBe(true);
    pending[0].reject(second);
    pending[2].resolve();
    await failed;
    expect(started).toEqual([0, 1, 2]);
    await expect(
      browserTaskPool([], async () => {}, { concurrency: Infinity }),
    ).rejects.toThrow();
  });
  it("#35 merges 10,000 progress patches into one frame and flushes final status", () => {
    let callback: (() => void) | undefined;
    const apply = vi.fn(),
      request = vi.fn((cb: () => void) => {
        callback = cb;
        return 1;
      }),
      cancel = vi.fn();
    const batch = createFrameBatch<string, { bytes: number; status: string }>(
      apply,
      request,
      cancel,
    );
    for (let n = 0; n < 10000; n++) batch.push("/a", { bytes: n });
    batch.push("/b", { bytes: 20 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    callback!();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0]).toEqual(
      new Map([
        ["/a", { bytes: 9999 }],
        ["/b", { bytes: 20 }],
      ]),
    );
    batch.push("/a", { bytes: 10000, status: "done" });
    batch.flush();
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[1][0].get("/a")).toEqual({
      bytes: 10000,
      status: "done",
    });
    batch.push("/a", { bytes: 0 });
    batch.dispose();
    callback!();
    batch.push("/b", { bytes: 1 });
    expect(apply).toHaveBeenCalledTimes(2);
  });
});
