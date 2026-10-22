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

`uploadStream(path, stream, size, options?)` accepts a nonseekable `ReadableStream<Uint8Array>` and its exact byte size (0–20 GiB). It uses sequential 8 MiB parts and the same conditional writes, verified resume metadata and progress callbacks as `uploadSource`; `options` omits `concurrency`. It retains at most one SDK-owned multipart buffer (8 MiB), releasing each verified part before reading the next. Producer-supplied chunks can themselves exceed 8 MiB; bound the producer's chunk size and queue. This is a live-reference bound, not a process-memory ceiling: retained/incoming producer chunks, runtime/WebCrypto/Fetch buffers and garbage awaiting collection can use additional memory. The source must end at exactly `size`: truncated, extra or failed input never commits. Every completing resume verifies every source-part digest against the immutable session, for byte arrays, Blobs, file adapters and streams. Missing or different digests return a 409 conflict before PUT/commit; inspect that upload before retrying. The first-part fingerprint alone never certifies the remaining content. The reader is cancelled/released on success, failure or client abort. HTTP retries replay only the owned part buffer; they never replay a consumed stream. To resume a failed stream upload, supply a fresh stream from the beginning.

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

## Bounded automation workflows

The following functions and types are exported from `@agfs/sdk`; they use existing authenticated endpoints. No polling or extra service is started.

```ts
import {
  captureInventory, compareInventories, walk, copyFile, publishText,
  transformJson, mergeJsonPatch, readLines, readJsonLines, changeBatches,
  stageDraft, withRun, verifyWebhook, diagnoseError,
} from "@agfs/sdk";

for await (const entry of walk(agfs, "/reports", {
  maxEntries: 1000, maxFolders: 100, maxDepth: 8,
  prune: (entry) => entry.name === "scratch",
})) console.log(entry.path);
const inventory = await captureInventory(agfs, "/reports");
const differences = compareInventories(previousInventory, inventory); // offline

await copyFile(sourceClient, destinationClient, "/reports/input.bin", "/incoming/input.bin", {
  maxBytes: 64 * 1024 * 1024, // default 1 GiB; destination defaults to create-only
});
await publishText(agfs, "/reports/status.txt", "Ready\n"); // identical bytes skip uploading
await transformJson(agfs, "/reports/config.json", value =>
  mergeJsonPatch(value, { enabled: true, obsolete: null }));
```

`walk` is sequential and pull-driven, with defaults of 10,000 observed entries, 1,000 folder requests and depth 16. Depth zero lists only the selected folder; deeper folders are deliberately omitted. Pruned folders are not requested. Each listing body is limited to 2 MiB; the existing server still performs its normal scoped folder query. `captureInventory` retains at most 10,000 sanitized metadata entries and 8 MiB of serialized metadata, then sorts by path. This is a sequence of observations, **not an atomic namespace snapshot**. Exported ETags identify each observed version. Comparisons require the same account, workspace, origin and root; changed means kind, ETag, size or content type changed. Neither capture nor comparison downloads file bodies.

`copyFile` uses separate explicit clients, one source listing and one ETag-pinned download, then the existing destination multipart protocol. Credentials remain with their respective transports. The destination's default `ifMatch: null` prevents overwriting; pass an explicit ETag to replace one version. Source size is capped before downloading. Multipart memory bounds are those of `uploadStream`, including its documented producer/runtime caveats. Failures do not automatically recreate an upload or retry HTTP 409/412.

The copy's source download requests `Accept-Encoding: identity`; ordinary `download` calls are unchanged. Native fetch can decompress a response while retaining its compressed headers, so copy accepts only absent `Content-Encoding` or the case-insensitive `identity` token. A server/custom transport that still returns another coding is refused and its body cancelled before any destination request. Copy never treats encoded `Content-Length` as the file size: the ETag-pinned listing and the upload stream's exact byte-count checks remain authoritative. This adds no requests, decompression buffers, or retries. Wire transfer uses uncompressed file bytes, which can exceed an ordinary compressed download's transfer size. A custom transport must honor identity negotiation to support copying.

`publishText` compares a bounded UTF-8 file before a conditional create/update; identical text and content type cause no upload requests. `transformJson` calls the callback once against the observed version, validates JSON values, then conditionally commits changed output. It does not retry the callback after conflicts. The default current/result limit is 1 MiB (maximum 8 MiB). Undefined, non-finite numbers, sparse arrays, cycles, getters, symbols and class instances are rejected. JavaScript's normal JSON number representation applies. RFC 7396 merge-patch `null` deletes an object member; a top-level `null` replaces the complete document with JSON null. No-op transforms retain the original formatting.

## Stream records and resume finite change windows

```ts
for await (const row of readLines(agfs, "/reports/job.log", {
  checkpoint: savedLineCheckpoint, maxBytes: 8 * 1024 * 1024, maxLineBytes: 65536,
})) {
  await consume(row.text);
  await saveCheckpoint(row.checkpoint); // only after accepting the line
}
for await (const row of readJsonLines(agfs, "/reports/items.jsonl", { maxRecords: 10000 })) {
  await consume(row.value); // null is preserved; invalid/blank records are errors
}
for await (const batch of changeBatches(agfs, "/reports", {
  checkpoint: savedChangeCheckpoint, maxPages: 20,
})) {
  await consume(batch.changes);
  await saveCheckpoint(batch.checkpoint);
}
```

Lines use strict UTF-8, preserve a final unterminated line, strip CR only in CRLF, and emit exact byte offsets after completed lines. The default line buffer is 64 KiB (maximum 1 MiB), the requested body is at most 8 MiB by default (maximum 1 GiB), and default maximum lines is 100,000. The reader retains one bounded line buffer plus the transport's current chunk; producer and runtime buffering is additional. Each invocation lists the parent once and sends one conditional range GET. Resume requests one preceding byte to validate an LF boundary, so the maximum range size is `maxBytes + 1`. An ETag change returns a conflict; malformed/truncated/ignored ranges are rejected. Early iterator return cancels the body. A byte/page limit throws rather than silently reporting a complete stream; save each accepted checkpoint and resume. Checkpoints contain no credentials. Do not manufacture offsets; a final-line EOF checkpoint simply observes the version and returns.

JSONL errors identify the path and exact line. Validation callbacks can enforce an application schema. `maxRecords` defaults to 10,000. JSON numbers follow the host language's representation; non-finite parsed numbers are rejected. Persist a line checkpoint after processing its record to resume without replaying accepted records. Exactly-once side effects still require application-level atomic processing/checkpoint persistence.

A supplied line/JSONL checkpoint must contain all six fields: `version`, `origin`, `path`, `etag`, `offset`, and `line`. They are validated and copied before any request; missing offsets or line numbers never default to a fresh read. Offset and line must be nonnegative safe integers, both zero or both positive, with line no greater than byte offset. ETags must be nonempty bounded strings without control characters. Use an omitted checkpoint for a fresh read. Checkpoints with accessors or inherited fields are refused.

`changeBatches` reads a finite fixed-`through` window sequentially, at most 100 pages by default and 500 changes per page. Checkpoints bind origin/account/workspace/path. An incomplete checkpoint resumes its original window; a complete checkpoint starts the next finite window. Without `since` or a checkpoint it captures today's watermark with no historical changes. There is no polling, automatic full scan, or silent recovery from expired history (410). Identity checking adds one `whoami` request per invocation. Persist only after processing the entire batch; a crash before persistence can replay that batch.

Every checkpoint field is required; malformed or partial checkpoints fail before transport. `since` is the resume cursor and must be a nonnegative safe integer no greater than `through`; completed checkpoints require equality. Valid checkpoint account/workspace bindings are checked against the identity response. Change entries use the same complete, sanitized metadata schema as listings. Existing change-log epoch-millisecond timestamps are decoded into the public `Entry.updatedAt` ISO string. Traversal/prune outputs are independent snapshots; mutating them cannot redirect authenticated traversal. Buffered line/JSONL records cannot be emitted after scope closure or expiry.

## Request lifetimes and actionable failures

```ts
const result = await agfs.withScope({ maxRequests: 30, timeoutMs: 15000, signal }, async scoped => {
  return publishText(scoped, "/reports/status.txt", "Ready\n");
});
```

`withScope` requires a **static/resolved token**; callback-token configurations are rejected before requests. Resolve OAuth outside the scope. Caller-owned OAuth requests are not included in its limit. Every transport attempt inside the scope, including retries and empty-file capability PUTs, consumes the shared budget once. Nested scopes also consume the outer budget. Defaults are 100 requests and a 30-second deadline; maxima are 10,000 and one hour. Pre-aborted, exhausted and closed scopes make no further transport calls. Deadlines and caller cancellation stop retries, cancel owned response bodies and release owned timers/listeners. Consume responses and iterators inside the callback; retaining a scoped client or iterator does not extend its lifetime. Uncooperative user callbacks cannot be forcibly terminated, but subsequent client requests are refused. The callback should pass `scoped.signal` to its own I/O. Runtime/transport cancellation remains cooperative.

`diagnoseError(error)` returns a JSON-safe `{category,message,status?,retryable,exitCode}` record. Workflow failures also expose `resourceId` and `completed`, retaining the underlying category/status. Categories distinguish conflicts, expired checkpoints, request budgets, deadlines, cancellation, authorization and unavailable services. Messages come from the operation/server; do not put credentials in custom exception messages.

Scopes retain acknowledged draft/run IDs and confirmed draft-change counts so deadlines/cancellation cannot race away recovery information. When several workflows remain incomplete, `resources` lists their `{kind,resourceId,completed}` records; the original cause is retained on `WorkflowError`. This journal is bounded by the transport-attempt budget and cleared on scope exit. Acknowledged successful workflows are removed. The scope does not wait for uncooperative callbacks, and an unacknowledged create response cannot supply a recovery ID.

Nested workflow diagnostics follow causes iteratively with cycle detection, without a fixed wrapper-depth cutoff. They retain the underlying conflict/budget/deadline/cancellation category and every known resource ID, including nested workflows outside a scope. Duplicate IDs retain the largest confirmed progress count. Helpers supply `kind`; manually constructed `WorkflowError` records may omit it. Classification stops at a meaningful non-workflow error so a caller's abort reason cannot replace cancellation semantics. Diagnostic work is local, proportional to the supplied cause chain and recovery records; it makes no requests or retries.

`UploadOptions.verifySource` is an optional awaited local validation callback immediately before commit (including completing resumes). A thrown error prevents commit. It lets a file-backed adapter reject a changed local source without weakening the existing ETag condition.

## Drafts, runs and webhook consumers

```ts
const draft = await stageDraft(agfs, {
  name: "Release notes", path: "/reports",
  changes: [{ path: "/reports/release.txt", operation: "write", content: "Ready" }],
});
const run = await withRun(agfs, "Summarize", "/reports", async ({ id }) => {
  await produceArtifacts(id);
  return "complete";
});
const verified = await verifyWebhook(secret, exactRawBodyBytes, {
  timestamp: request.headers.get("x-agfs-timestamp") ?? "",
  signature: request.headers.get("x-agfs-signature") ?? "",
});
```

`stageDraft` validates all 1–30 unique, confined changes before creating anything, then stages sequentially. It neither approves nor applies a draft. A partial failure throws `WorkflowError` with the draft ID and confirmed completed count; inspect that draft before retrying. It is not a multi-request transaction. Writes are limited to the existing 8,192 UTF-16 code units per change.

`withRun` starts one run, invokes work once and completes only after callback success. Callback or completion failure throws `WorkflowError` preserving the cause and run ID. A lost completion response can leave an already-completed run; inspect before retrying. No polling or automatic duplicate run creation occurs.

`verifyWebhook` verifies the exact raw bytes with WebCrypto HMAC verification. It accepts the server's one- or two-`v1=` comma-separated signature format during key rotation and verifies every candidate. Default replay window is ±300 seconds, configurable 0–3,600; future timestamps beyond that window fail too. Default body limit is 1 MiB (maximum 8 MiB); signature header is capped at 160 characters. It makes zero cloud requests. Persist and deduplicate event IDs yourself: timestamp/signature verification does not prevent replay within the accepted window.
