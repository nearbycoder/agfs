# @agfs/sdk

Official TypeScript SDK for AGFS. Requires Node 22+ or a browser with Fetch and Web Crypto.

```ts
import { AgfsClient } from "@agfs/sdk";
const agfs = new AgfsClient({ token: process.env.AGFS_TOKEN! });
await agfs.mkdir("/reports");
const entry = await agfs.upload(
  "/reports/summary.txt",
  new Blob(["First draft"]),
  {
    contentType: "text/plain",
    ifMatch: null, // create only
  },
);
await agfs.upload(entry.path, new Blob(["Revised draft"]), {
  ifMatch: entry.etag!,
});
for await (const file of agfs.searchAll({ q: "revised", path: "/reports" })) {
  console.log(file.path);
}
const run = await agfs.startRun("Daily report", "/reports", {
  inputs: ["/inputs/brief.txt"],
  metadata: { revision: "abc123" },
});
console.log(await agfs.completeRun(run.id));
```

The token determines the workspace. `workspace` is an optional assertion of that workspace's ID, not a way to switch a token into another workspace. Browser OAuth connections use the same API; supply their current bearer access token or an async token callback. For interactive browser login in Node, use the separate `@agfs/sdk/oauth` export. DPoP signing remains the calling application's responsibility.

`upload` accepts a Blob or Uint8Array. `uploadSource` accepts `{size, read(start,end)}` for bounded-memory file uploads. Nonempty files use resumable 8 MiB parts, verifying each resumed part. The first part reuses the bytes and hash read for its fingerprint. Set `concurrency` in upload options to 1–8 (`upload` defaults to 3; `uploadSource` defaults to 1 for compatibility with sequential readers); at most that many chunks are read, hashed and uploaded at once. A custom reader must support independent offset reads and return stable, separately owned buffers; use `concurrency: 1` for sequential readers. Progress reports total verified/uploaded bytes, including parts that finish out of order. A failed transfer waits for active parts and never commits. Retry an interrupted upload with the same source and options to continue. Empty files use the upload-intent API. The return value is the committed file entry.

Omitting `ifMatch` preserves unconditional write behavior. `null` requires an absent destination; an ETag requires that exact version. A stale write throws `AgfsError` with status 409. `download(path, etag)` returns a streaming Response and rejects changed versions with 412. Callers must consume or cancel response bodies.

The client retries GET, HEAD, and PUT requests on transient network failures or HTTP 429/502/503/504, with bounded backoff. POST requests retry only when explicitly supplied an idempotency key. API redirects are rejected to protect credentials. `searchAll` and `activity` paginate automatically. `json('/platform/...', method, body, idempotencyKey)` provides access to the full API, including workspace, draft, webhook, and budget management.

Tokens must stay on the server or in a trusted application; never embed a privileged token in public frontend code.

Set `retries` to an integer from 0 to 5 (default 2). Streaming request bodies cannot be replayed and are never retried automatically.

Browser login uses PKCE, a loopback callback, and refresh-token rotation:

```ts
import { OAuthSession, fileCredentialStore } from "@agfs/sdk/oauth";
const session = await OAuthSession.login({
  onAuthorizationUrl: (url) => console.log("Open:", url),
  store: fileCredentialStore("/home/me/.config/agfs-sdk/credentials.json"),
});
const client = new AgfsClient({ token: session.token });
```

The optional credential directory must be private (0700); files use 0600. Use one session per store/process. Pass `signal` in client options to cancel requests and retry delays. `mapConcurrent(items, concurrency, callback, signal)` bounds independent transfers to 1–8 workers. `changes(path, since, through)` supports incremental sync; an expired checkpoint returns 410.

`uploadStream(path, stream, size, options?)` accepts a nonseekable `ReadableStream<Uint8Array>` and its exact byte size (0–20 GiB). It uses sequential 8 MiB parts and the same conditional writes, verified resume metadata and progress callbacks as `uploadSource`; `options` omits `concurrency`. It retains at most one SDK-owned multipart buffer (8 MiB), releasing the fingerprint snapshot before validating a completing resume. Producer-supplied chunks can themselves exceed 8 MiB; bound the producer's chunk size and queue. This is a live-reference bound, not a process-memory ceiling: retained/incoming producer chunks, runtime/WebCrypto/Fetch buffers and garbage awaiting collection can use additional memory. The source must end at exactly `size`: truncated, extra or failed input never commits. Even a completing resume validates the stream length. The reader is cancelled/released on success, failure or client abort. HTTP retries replay only the owned part buffer; they never replay a consumed stream. To resume a failed stream upload, supply a fresh stream from the beginning.

```ts
await agfs.uploadStream("/reports/stream.bin", sourceStream, byteSize, {
  ifMatch: null,
  onProgress: (bytes) => console.log(bytes),
});
```

`mapConcurrentIterable(items, limit, work, signal?)` maps a synchronous or asynchronous iterable lazily (including strings), preserving input order with 1–8 workers. Unlike the array-returning `mapConcurrent`, it retains at most `limit` pending inputs/results; consumer backpressure stops further pulls. A ready ordered result is yielded without waiting for an unrelated source pull, so a producer can wait for consumer acknowledgment before yielding its next item. At most one source `next()` is outstanding. An early `break` stops scheduling, waits for active callbacks, and closes the source iterator before joining its outstanding pull. Failure also drains active callbacks before rejecting. The optional signal is checked before pulls/work/results; callbacks and source `next()` must implement their own cancellation for prompt interruption of already-running operations. A slow earlier result can delay later results because output is ordered. Retaining results in your own array still consumes memory proportional to that array.

```ts
import { mapConcurrentIterable } from "@agfs/sdk";
for await (const result of mapConcurrentIterable(paths, 3, async (path) => {
  const response = await agfs.download(path);
  return consumeAndClose(response);
})) {
  console.log(result);
}
```
