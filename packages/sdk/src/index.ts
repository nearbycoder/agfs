import { mapConcurrent } from "./concurrency.js";
export { mapConcurrent, mapConcurrentIterable } from "./concurrency.js";
export type Permission = "read" | "write" | "delete" | "share" | "manage";
export interface Entry {
  id: string;
  path: string;
  name: string;
  kind: "file" | "folder";
  size: number | null;
  etag: string | null;
  contentType: string | null;
  updatedAt: string;
}
export interface SearchResult {
  id: string;
  path: string;
  name: string;
  kind: "file" | "folder";
  size: number | null;
  etag: string | null;
  contentType: string | null;
  tags: string[];
  excerpt: string | null;
}
export interface ClientOptions {
  token: string | (() => string | Promise<string>);
  baseUrl?: string;
  workspace?: string;
  fetch?: typeof fetch;
  retries?: number;
  signal?: AbortSignal;
}
export interface UploadOptions {
  contentType?: string;
  ifMatch?: string | null;
  onProgress?: (bytes: number) => void;
  /** Concurrent 8 MiB parts, from 1 to 8. Defaults to 3 for upload, 1 for custom sources. */
  concurrency?: number;
}
export class AgfsError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "AgfsError";
  }
}
const digest = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const delay = (ms: number, signal?: AbortSignal | null) =>
  new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    const cancel = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Cancelled"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal?.addEventListener("abort", cancel, { once: true });
  });
export class AgfsClient {
  readonly baseUrl: string;
  private readonly transport: typeof fetch;
  constructor(private options: ClientOptions) {
    if (options.retries !== undefined && (!Number.isInteger(options.retries) || options.retries < 0 || options.retries > 5))
      throw new Error("Retries must be an integer from 0 to 5");
    const base = new URL(options.baseUrl ?? "https://agfs.dev");
    if (
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== "/" ||
      !(
        base.protocol === "https:" ||
        (base.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
      )
    )
      throw new Error(
        "Use an HTTPS origin (HTTP is allowed for local development)",
      );
    this.baseUrl = base.origin;
    this.transport = options.fetch ?? fetch;
  }
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const target = new URL(path, this.baseUrl);
    if (
      !path.startsWith("/api/v1/") ||
      target.origin !== this.baseUrl ||
      !target.pathname.startsWith("/api/v1/") ||
      path.includes("\\") || target.hash
    )
      throw new Error("Invalid AGFS API path");
    init = { ...init, signal: init.signal ?? this.options.signal };
    init.signal?.throwIfAborted();
    const method = (init.method ?? "GET").toUpperCase(),
      retries =
        !(init.body instanceof ReadableStream) &&
        (["GET", "HEAD", "PUT"].includes(method) ||
        new Headers(init.headers).has("idempotency-key"))
          ? Math.min(5, Math.max(0, this.options.retries ?? 2))
          : 0;
    for (let attempt = 0; ; attempt++) {
      const headers = new Headers(init.headers),
        token =
          typeof this.options.token === "function"
            ? await this.options.token()
            : this.options.token;
      headers.set("authorization", "Bearer " + token);
      if (this.options.workspace)
        headers.set("x-agfs-workspace", this.options.workspace);
      let response: Response;
      try {
        response = await this.transport(this.baseUrl + path, {
          ...init,
          method,
          headers,
          redirect: "error",
        });
      } catch (error) {
        if (attempt >= retries || init.signal?.aborted) throw error;
        await delay(250 * 2 ** attempt, init.signal);
        continue;
      }
      if (response.ok) return response;
      if (attempt < retries && [429, 502, 503, 504].includes(response.status)) {
        const retry = Number(response.headers.get("retry-after"));
        await response.body?.cancel();
        await delay(
          Math.min(
            60000,
            Math.max(
              250 * 2 ** attempt,
              Number.isFinite(retry) ? retry * 1000 : 0,
            ),
          ),
          init.signal,
        );
        continue;
      }
      let message = response.statusText;
      try {
        message = (await response.json()).error ?? message;
      } catch {}
      throw new AgfsError(response.status, message);
    }
  }
  async json<T = Record<string, unknown>>(
    path: string,
    method = "GET",
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    return (
      await this.request("/api/v1" + path, {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: {
                "content-type": "application/json",
                ...(idempotencyKey
                  ? { "idempotency-key": idempotencyKey }
                  : {}),
              },
              body: JSON.stringify(body),
            }),
      })
    ).json();
  }
  whoami() {
    return this.json("/whoami");
  }
  account() {
    return this.json("/account");
  }
  list(path = "/") {
    return this.json<{ path: string; entries: Entry[] }>(
      "/fs/list?" + new URLSearchParams({ path }),
    );
  }
  mkdir(path: string) {
    return this.json("/fs/mkdir", "POST", { path });
  }
  move(from: string, to: string) {
    return this.json("/fs/move", "POST", { from, to });
  }
  remove(path: string, recursive = false) {
    return this.json("/fs/delete", "POST", { path, recursive });
  }
  async download(path: string, ifMatch?: string) {
    return this.request(
      "/api/v1/fs/download?" + new URLSearchParams({ path }),
      { headers: ifMatch ? { "if-match": ifMatch } : {} },
    );
  }
  async readText(path: string, ifMatch?: string) {
    return (await this.download(path, ifMatch)).text();
  }
  search(
    input: {
      q?: string;
      path?: string;
      type?: string;
      tag?: string;
      offset?: number;
      cursor?: string;
    } = {},
  ) {
    return this.json<{
      results: SearchResult[];
      nextOffset: number | null;
      nextCursor: string | null;
    }>(
      "/platform/search?" +
        new URLSearchParams(
          Object.entries(input)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)]),
        ),
    );
  }
  async *searchAll(
    input: { q?: string; path?: string; type?: string; tag?: string } = {},
  ) {
    let cursor: string | undefined;
    for (;;) {
      const page = await this.search({ ...input, cursor });
      yield* page.results;
      if (!page.nextCursor) return;
      if (page.nextCursor === cursor)
        throw new Error("Invalid pagination cursor");
      cursor = page.nextCursor;
    }
  }

  async *activity() {
    let cursor: string | null = null;
    for (;;) {
      const page: {
        events: Record<string, unknown>[];
        nextCursor: string | null;
      } = await this.json(
        "/activity" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
      );
      yield* page.events;
      if (!page.nextCursor) return;
      if (cursor === page.nextCursor)
        throw new Error("Invalid pagination cursor");
      cursor = page.nextCursor;
    }
  }
  tags(path: string, tags: string[]) {
    return this.json("/platform/tags", "PUT", { path, tags });
  }
  startRun(
    name: string,
    path: string,
    options: {
      inputs?: string[];
      metadata?: Record<string, string>;
      retentionDays?: number;
    } = {},
  ) {
    return this.json<{ id: string; status: string }>("/platform/runs", "POST", {
      name,
      path,
      ...options,
    });
  }
  completeRun(id: string) {
    return this.json(
      "/platform/runs/" + encodeURIComponent(id) + "/complete",
      "POST",
      {},
    );
  }
  runs(cursor?: string) {
    return this.json(
      "/platform/runs" +
        (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
    );
  }
  async *pages(resource: "runs" | "drafts" | "snapshots") {
    let cursor: string | undefined;
    for (;;) {
      const p: any = await this.json(
        "/platform/" +
          resource +
          (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
      );
      yield* p[resource];
      if (!p.nextCursor) return;
      if (p.nextCursor === cursor) throw new Error("Invalid cursor");
      cursor = p.nextCursor;
    }
  }
  changes(path: string, since?: number, through?: number) {
    return this.json<{
      checkpoint: number;
      nextCursor: number | null;
      changes: {
        seq: number;
        path: string;
        operation: string;
        entry: Entry | null;
      }[];
    }>(
      "/platform/changes?" +
        new URLSearchParams({
          path,
          ...(since === undefined ? {} : { since: String(since) }),
          ...(through === undefined ? {} : { through: String(through) }),
        }),
    );
  }

  createDraft(name: string, path: string) {
    return this.json<{ id: string }>("/platform/drafts", "POST", {
      name,
      path,
    });
  }
  changeDraft(
    id: string,
    change: {
      path: string;
      operation: "write" | "delete";
      content?: string;
      contentType?: string;
    },
  ) {
    return this.json(
      "/platform/drafts/" + encodeURIComponent(id) + "/changes",
      "PUT",
      change,
    );
  }
  getDraft(id: string) {
    return this.json("/platform/drafts/" + encodeURIComponent(id));
  }
  applyDraft(id: string) {
    return this.json(
      "/platform/drafts/" + encodeURIComponent(id) + "/apply",
      "POST",
      {},
    );
  }
  /** Omit ifMatch for unconditional writes; null means create only; an ETag requires that exact current version. */
  async upload(
    path: string,
    source: Uint8Array | Blob,
    options: UploadOptions = {},
  ): Promise<Entry> {
    const blob =
      source instanceof Blob
        ? source
        : new Blob([source as Uint8Array<ArrayBuffer>]);
    return this.uploadSource(
      path,
      {
        size: blob.size,
        read: async (start, end) =>
          new Uint8Array(await blob.slice(start, end).arrayBuffer()),
      },
      { ...options, concurrency: options.concurrency ?? 3 },
    );
  }
  async uploadSource(
    path: string,
    source: {
      size: number;
      read: (start: number, end: number) => Promise<Uint8Array>;
    },
    options: UploadOptions = {},
  ): Promise<Entry> {
    return this.uploadFromSource(path, source, options);
  }

  /** Upload a one-shot byte stream without staging the whole file. Parts stay sequential. */
  async uploadStream(
    path: string,
    stream: ReadableStream<Uint8Array>,
    size: number,
    options: Omit<UploadOptions, "concurrency"> = {},
  ): Promise<Entry> {
    if (!Number.isSafeInteger(size) || size < 0 || size > 20 * 1024 ** 3)
      throw new Error("Invalid upload size");
    this.options.signal?.throwIfAborted();
    const reader = stream.getReader();
    let position = 0, buffered: Uint8Array | undefined, offset = 0, ended = false;
    const signal = this.options.signal;
    const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
    signal?.addEventListener("abort", abort, { once: true });
    const nextChunk = async () => {
      signal?.throwIfAborted();
      const chunk = await reader.read();
      signal?.throwIfAborted();
      if (chunk.done) { ended = true; return undefined; }
      if (!(chunk.value instanceof Uint8Array)) throw new Error("Expected a byte stream");
      return chunk.value;
    };
    const verifyEnd = async () => {
      if (buffered && offset < buffered.length) throw new Error("Upload stream size mismatch");
      while (!ended) {
        const chunk = await nextChunk();
        if (chunk?.length) throw new Error("Upload stream size mismatch");
      }
    };
    const read = async (start: number, end: number) => {
      if (start !== position) throw new Error("Upload stream is not seekable");
      const bytes = new Uint8Array(end - start);
      let written = 0;
      while (written < bytes.length) {
        if (!buffered || offset === buffered.length) {
          buffered = await nextChunk(); offset = 0;
          if (!buffered) throw new Error("Upload stream size mismatch");
        }
        const length = Math.min(bytes.length - written, buffered.length - offset);
        bytes.set(buffered.subarray(offset, offset + length), written);
        offset += length; written += length;
      }
      position = end;
      if (position === size) await verifyEnd();
      return bytes;
    };
    try {
      if (!size) await verifyEnd();
      return await this.uploadFromSource(path, { size, read }, { ...options, concurrency: 1 }, async () => {
        // A completing resume skips PUTs, but must still validate the supplied stream.
        while (position < size) await read(position, Math.min(size, position + 8388608));
        await verifyEnd();
      });
    } finally {
      signal?.removeEventListener("abort", abort);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  private async uploadFromSource(
    path: string,
    source: { size: number; read: (start: number, end: number) => Promise<Uint8Array> },
    options: UploadOptions,
    beforeComplete?: () => Promise<void>,
  ): Promise<Entry> {
    const { size, read } = source,
      contentType = options.contentType ?? "application/octet-stream",
      concurrency = options.concurrency ?? 1;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
      throw new Error("Concurrency must be 1–8");
    this.options.signal?.throwIfAborted();
    if (!Number.isSafeInteger(size) || size < 0 || size > 20 * 1024 ** 3)
      throw new Error("Invalid upload size");
    if (size === 0) {
      const intent = await this.json<{
        url: string;
        headers: Record<string, string>;
        uploadId: string;
      }>("/fs/upload-intents", "POST", {
        path,
        size,
        contentType,
        ifMatch: options.ifMatch,
      });
      const uploadPath = `/api/v1/fs/uploads/${encodeURIComponent(intent.uploadId)}/blob`;
      const advertisedUrl = new URL(intent.url);
      if (!/^upl_[\w-]+$/.test(intent.uploadId) || advertisedUrl.username || advertisedUrl.password ||
        advertisedUrl.pathname !== uploadPath || advertisedUrl.search || advertisedUrl.hash)
        throw new Error("Unexpected upload capability");
      // Canonical APP_URL aliases must not change where a capability is sent.
      const uploadUrl = new URL(uploadPath, this.baseUrl);
      const response = await this.transport(uploadUrl.href, {
        method: "PUT",
        headers: intent.headers,
        body: new Uint8Array(),
        redirect: "error",
        signal: this.options.signal,
      });
      await response.body?.cancel();
      if (!response.ok) throw new AgfsError(response.status, "Upload failed");
      await beforeComplete?.();
      return (
        await this.json<{ entry: Entry }>(
          "/fs/uploads/" + encodeURIComponent(intent.uploadId) + "/commit",
          "POST",
          { etag: response.headers.get("etag") ?? "uploaded" },
        )
      ).entry;
    }
    // The fingerprint and first part share the same byte snapshot and digest.
    let first: Uint8Array | undefined = await read(0, Math.min(size, 8388608));
    if (first.length !== Math.min(size, 8388608))
      throw new Error("Local file changed during upload");
    const firstDigest = await digest(first),
      fingerprint = size + ":" + firstDigest;
    const state = await this.json<{
      uploadId: string;
      partSize: number;
      status: string;
      parts: { partNumber: number; digest: string }[];
    }>("/fs/resumable", "POST", {
      path,
      size,
      contentType,
      fingerprint,
      ifMatch: options.ifMatch,
    });
    const partCount = Math.ceil(size / 8388608);
    if (state.partSize !== 8388608 || !/^upl_[\w-]+$/.test(state.uploadId) ||
      !["pending", "completing"].includes(state.status) || !Array.isArray(state.parts) || state.parts.length > partCount)
      throw new Error("Invalid upload response");
    const completed = new Map<number, string>();
    for (const part of state.parts) {
      if (!part || !Number.isInteger(part.partNumber) || part.partNumber < 1 || part.partNumber > partCount ||
        typeof part.digest !== "string" || !/^[a-f0-9]{64}$/.test(part.digest) || completed.has(part.partNumber))
        throw new Error("Invalid upload response");
      completed.set(part.partNumber, part.digest);
    }
    let transferred = 0;
    if (state.status !== "completing") {
      await mapConcurrent(Array.from({ length: partCount }, (_, index) => index + 1), concurrency, async (part) => {
        const start = (part - 1) * state.partSize;
        const end = Math.min(size, start + state.partSize),
          bytes = part === 1 ? first! : await read(start, end);
        if (part === 1) first = undefined;
        if (bytes.length !== end - start)
          throw new Error("Local file changed during upload");
        this.options.signal?.throwIfAborted();
        if (
          completed.get(part) !== (part === 1 ? firstDigest : await digest(bytes))
        ) {
          const response = await this.request(
            `/api/v1/fs/resumable/${state.uploadId}/parts/${part}`,
            { method: "PUT", body: bytes as Uint8Array<ArrayBuffer> },
          );
          await response.body?.cancel();
        }
        transferred += bytes.length;
        options.onProgress?.(transferred);
      }, this.options.signal);
    }
    // Completing resumes skip the workers that normally release this snapshot.
    // Do not retain it while a stream's completion hook reads later parts.
    first = undefined;
    await beforeComplete?.();
    return (
      await this.json<{ entry: Entry }>(
        `/fs/resumable/${state.uploadId}/complete`,
        "POST",
        {},
      )
    ).entry;
  }
}
