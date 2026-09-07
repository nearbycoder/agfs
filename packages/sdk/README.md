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

`upload` accepts a Blob or Uint8Array. `uploadSource` accepts `{size, read(start,end)}` for bounded-memory file uploads. Nonempty files use resumable 8 MiB parts, rehashing each resumed part. Retry an interrupted upload with the same source and options to continue. Empty files use the upload-intent API. The return value is the committed file entry.

Omitting `ifMatch` preserves unconditional write behavior. `null` requires an absent destination; an ETag requires that exact version. A stale write throws `AgfsError` with status 409. `download(path, etag)` returns a streaming Response and rejects changed versions with 412. Callers must consume or cancel response bodies.

The client retries GET, HEAD, and PUT requests on transient network failures or HTTP 429/502/503/504, with bounded backoff. POST requests retry only when explicitly supplied an idempotency key. API redirects are rejected to protect credentials. `searchAll` and `activity` paginate automatically. `json('/platform/...', method, body, idempotencyKey)` provides access to the full API, including workspace, draft, webhook, and budget management.

Tokens must stay on the server or in a trusted application; never embed a privileged token in public frontend code.

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
