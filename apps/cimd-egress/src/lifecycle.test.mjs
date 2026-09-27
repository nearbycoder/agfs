import assert from "node:assert/strict";
import { test } from "node:test";
import { MetadataRequestLifecycle } from "./lifecycle.ts";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("consumes metadata before stopping, even when the caller ignores the body", async () => {
  const read = deferred();
  const body = new ReadableStream(
    {
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("metadata"));
        controller.close();
        read.resolve();
      },
    },
    { highWaterMark: 0 },
  );
  let stops = 0;
  const lifecycle = new MetadataRequestLifecycle(
    async () => new Response(body, { status: 200 }),
    async () => {
      await read.promise;
      stops++;
    },
  );
  const response = await lifecycle.fetch(new Request("https://metadata/fetch"));
  assert.equal(stops, 1);
  assert.equal(await response.text(), "metadata");
});

test("keeps the container running until concurrent requests complete", async () => {
  const secondResponse = deferred();
  let calls = 0;
  let stops = 0;
  const lifecycle = new MetadataRequestLifecycle(
    async () => {
      calls++;
      if (calls === 2) await secondResponse.promise;
      return new Response("ok");
    },
    async () => {
      stops++;
    },
  );
  const request = new Request("https://metadata/fetch");
  const first = lifecycle.fetch(request);
  const second = lifecycle.fetch(request);
  assert.equal(await (await first).text(), "ok");
  assert.equal(stops, 0);
  secondResponse.resolve();
  assert.equal(await (await second).text(), "ok");
  assert.equal(stops, 1);
});

test("new requests wait for shutdown before restarting", async () => {
  const stopped = deferred();
  let calls = 0;
  const lifecycle = new MetadataRequestLifecycle(
    async () => {
      calls++;
      return new Response("ok");
    },
    async () => stopped.promise,
  );
  const request = new Request("https://metadata/fetch");
  const first = lifecycle.fetch(request);
  await new Promise((resolve) => setImmediate(resolve));
  const second = lifecycle.fetch(request);
  assert.equal(calls, 1);
  stopped.resolve();
  await Promise.all([first, second]);
  assert.equal(calls, 2);
});

test("stops after upstream errors and keeps HEAD and 304 bodies empty", async () => {
  let stops = 0;
  const lifecycle = new MetadataRequestLifecycle(
    async (request) => {
      if (request.url.endsWith("/error")) throw new Error("upstream failed");
      return new Response(null, { status: 304 });
    },
    async () => {
      stops++;
    },
  );
  await assert.rejects(lifecycle.fetch(new Request("https://metadata/error")));
  const response = await lifecycle.fetch(
    new Request("https://metadata/fetch", { method: "HEAD" }),
  );
  assert.equal(response.status, 304);
  assert.equal(response.body, null);
  assert.equal(stops, 2);
});

test("stops when the upstream response stream fails", async () => {
  let stops = 0;
  const lifecycle = new MetadataRequestLifecycle(
    async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.error(new Error("broken stream"));
          },
        }),
      ),
    async () => {
      stops++;
    },
  );
  await assert.rejects(lifecycle.fetch(new Request("https://metadata/fetch")));
  assert.equal(stops, 1);
});
