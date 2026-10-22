import { setImmediate as tick } from "node:timers/promises";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { AgfsClient } from "./index";
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; };

// Exercise actual reachability, rather than inferring peak memory from source text
// or counting total allocations. Only this test process exposes/forces V8 GC.
setFlagsFromString("--expose_gc");
const collectGarbage: () => void = runInNewContext("gc");
it.each(["pending", "completing"])("releases part one before reading part two of a %s stream", async (status) => {
  const Original = Uint8Array, PART = 8388608;
  const allocated: WeakRef<Uint8Array>[] = [];
  const gate = deferred(), waiting = deferred();
  let pulled = 0;
  const producerChunk = new Original(PART / 8);
  const partDigest = createHash("sha256"); for (let i = 0; i < 8; i++) partDigest.update(producerChunk);
  const hash = partDigest.digest("hex");
  const stream = new ReadableStream<Uint8Array>({ async pull(controller) {
    if (pulled === 8) { waiting.resolve(); await gate.promise; }
    if (pulled++ < 16) controller.enqueue(producerChunk);
    else controller.close();
  } }, { highWaterMark: 0 });
  const client = new AgfsClient({ token: "fixture", retries: 0, fetch: async (input) => {
    if (String(input).endsWith("/resumable")) return Response.json({ uploadId: "upl_memory", status, partSize: PART, parts: status === "completing" ? [1, 2].map(partNumber => ({ partNumber, digest: hash })) : [] });
    return Response.json({ entry: { path: "/file" } });
  } });
  globalThis.Uint8Array = new Proxy(Original, { construct(target, args) {
    const bytes = Reflect.construct(target, args);
    if (args[0] === PART) allocated.push(new WeakRef(bytes));
    return bytes;
  } });
  let upload: Promise<unknown> | undefined;
  try {
    upload = client.uploadStream("/file", stream, PART * 2);
    await waiting.promise;
    await tick(); collectGarbage();
    expect(allocated).toHaveLength(2);
    expect(allocated.map((bytes) => Boolean(bytes.deref()))).toEqual([false, true]);
  } finally {
    globalThis.Uint8Array = Original;
    gate.resolve(); await upload;
  }
});
