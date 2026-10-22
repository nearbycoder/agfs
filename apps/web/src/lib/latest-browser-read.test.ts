import { expect, it, vi } from "vitest";
import { createLatestBrowserRead } from "./latest-browser-read";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function handlers() {
  return { success: vi.fn(), error: vi.fn(), settled: vi.fn() };
}

it("aborts a superseded read and ignores its late response even if transport ignores abort", async () => {
  const lane = createLatestBrowserRead(),
    old = deferred<string>(),
    fresh = deferred<string>();
  const previous = handlers(),
    current = handlers();
  let oldSignal!: AbortSignal;
  const first = lane.run((signal) => {
    oldSignal = signal;
    return old.promise;
  }, previous);
  const second = lane.run(() => fresh.promise, current);
  expect(oldSignal.aborted).toBe(true);
  old.resolve("private old data");
  await first;
  expect(previous.success).not.toHaveBeenCalled();
  expect(previous.settled).not.toHaveBeenCalled();
  fresh.resolve("fresh data");
  await second;
  expect(current.success).toHaveBeenCalledWith("fresh data");
  expect(current.settled).toHaveBeenCalledOnce();
});

it("cancels network work and all callbacks after leaving a tool", async () => {
  const lane = createLatestBrowserRead(),
    read = deferred<string>(),
    callbacks = handlers();
  let signal!: AbortSignal;
  const pending = lane.run((s) => {
    signal = s;
    return read.promise;
  }, callbacks);
  lane.cancel();
  expect(signal.aborted).toBe(true);
  read.reject(new Error("AbortError"));
  await pending;
  for (const callback of Object.values(callbacks))
    expect(callback).not.toHaveBeenCalled();
});

it("keeps tool instances isolated and reloads a file instead of caching its contents", async () => {
  const a = createLatestBrowserRead(),
    b = createLatestBrowserRead();
  const first = deferred<string>(),
    second = deferred<string>();
  const ah = handlers(),
    bh = handlers();
  const ap = a.run(() => first.promise, ah),
    bp = b.run(() => second.promise, bh);
  a.cancel();
  second.resolve("workspace B");
  first.resolve("workspace A");
  await Promise.all([ap, bp]);
  expect(bh.success).toHaveBeenCalledWith("workspace B");
  expect(ah.success).not.toHaveBeenCalled();
  const fetchFile = vi
    .fn()
    .mockResolvedValueOnce("revision 1")
    .mockResolvedValueOnce("revision 2");
  await a.run(fetchFile, ah);
  await a.run(fetchFile, ah);
  expect(fetchFile).toHaveBeenCalledTimes(2);
  expect(ah.success).toHaveBeenLastCalledWith("revision 2");
});

it("reports current network/parser errors and settles only the active read", async () => {
  const lane = createLatestBrowserRead(),
    callbacks = handlers();
  const failure = new Error("Malformed CSV");
  callbacks.success.mockImplementationOnce(() => {
    throw failure;
  });
  await lane.run(async () => "unparsed", callbacks);
  expect(callbacks.error).toHaveBeenCalledWith(failure);
  expect(callbacks.settled).toHaveBeenCalledOnce();
  callbacks.error.mockClear();
  await lane.run(async () => {
    throw new Error("Forbidden");
  }, callbacks);
  expect(callbacks.error).toHaveBeenCalledWith(new Error("Forbidden"));
});
