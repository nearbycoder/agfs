import type { AgfsClient } from "./index.js";
import { fileEntry, integer, remotePath, ResourceLimitError } from "./automation-core.js";
import { jsonValue } from "./automation.js";

export interface LineCheckpoint { version: 1; origin: string; path: string; etag: string; offset: number; line: number }
export interface LineOptions { checkpoint?: LineCheckpoint; maxBytes?: number; maxLineBytes?: number; maxLines?: number }
export interface TextLine { text: string; line: number; checkpoint: LineCheckpoint }
/** Checkpoints are emitted only after a complete UTF-8 line. Resume uses a pinned byte range. */
export async function* readLines(client: AgfsClient, path: string, options: LineOptions = {}): AsyncGenerator<TextLine> {
  remotePath(path);
  const maxBytes = integer(options.maxBytes ?? 8 * 1024 * 1024, "maxBytes", 1, 1024 * 1024 * 1024);
  const maxLine = integer(options.maxLineBytes ?? 65536, "maxLineBytes", 1, 1024 * 1024);
  const maxLines = integer(options.maxLines ?? 100000, "maxLines", 1, 1000000);
  let cp: LineCheckpoint | undefined;
  if (options.checkpoint !== undefined) {
    const value = options.checkpoint;
    if (!value || typeof value !== "object" || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw new TypeError("Invalid line checkpoint");
    const descriptors = Object.getOwnPropertyDescriptors(value), snapshot: Record<string, unknown> = Object.create(null);
    for (const field of ["version", "origin", "path", "etag", "offset", "line"]) {
      const d = descriptors[field];
      if (!d?.enumerable || !Object.hasOwn(d, "value")) throw new TypeError("Incomplete line checkpoint");
      snapshot[field] = d.value;
    }
    if (snapshot.version !== 1 || snapshot.origin !== client.baseUrl || snapshot.path !== path || typeof snapshot.etag !== "string" || !snapshot.etag || snapshot.etag.length > 256 || /[\x00-\x1f\x7f]/.test(snapshot.etag)) throw new TypeError("Line checkpoint belongs to another origin or path");
    const offset = integer(snapshot.offset as number, "checkpoint offset", 0, 20 * 1024 ** 3), line = integer(snapshot.line as number, "checkpoint line", 0, Number.MAX_SAFE_INTEGER);
    if ((offset === 0) !== (line === 0) || line > offset) throw new TypeError("Inconsistent line checkpoint offset and line");
    cp = { version: 1, origin: client.baseUrl, path, etag: snapshot.etag, offset, line };
  }
  let offset = cp ? cp.offset : 0, line = cp ? cp.line : 0;
  const entry = await fileEntry(client, path);
  if (!entry) { const error = new Error("File not found"); Object.assign(error, { status: 404 }); throw error; }
  if (cp && entry.etag !== cp.etag) { const error = new Error("Line checkpoint file version changed"); Object.assign(error, { status: 412 }); throw error; }
  const size = entry.size!, etag = entry.etag!;
  if (offset > size) throw new TypeError("Line checkpoint exceeds file size");
  if (offset === size) return;
  const end = Math.min(size, offset + maxBytes) - 1;
  const rangeStart = Math.max(0, offset - 1);
  const response = await client.request("/api/v1/fs/download?" + new URLSearchParams({ path }), { headers: { range: `bytes=${rangeStart}-${end}`, "if-match": etag } });
  const reader = response.body?.getReader();
  if (!reader) throw new TypeError("Missing ranged response body");
  const abort = () => { void reader.cancel(client.signal?.reason).catch(() => {}); };
  client.signal?.addEventListener("abort", abort, { once: true });
  try {
    if (response.status !== 206 || response.headers.get("content-range") !== `bytes ${rangeStart}-${end}/${size}` ||
        response.headers.get("etag")?.replace(/^"|"$/g, "") !== etag || response.headers.has("content-encoding")) throw new TypeError("Invalid or changed ranged response");
    const buffer = new Uint8Array(maxLine); const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    let used = 0, consumed = 0, emitted = 0, prefix = offset > 0;
    const start = offset;
    const emit = (terminated = true): TextLine => {
      client.signal?.throwIfAborted();
      if (++emitted > maxLines) throw new ResourceLimitError("Line reader exceeds maxLines");
      let text = decoder.decode(buffer.subarray(0, used));
      if (line === 0 && start === 0 && text.startsWith("\uFEFF")) text = text.slice(1);
      if (terminated && text.endsWith("\r")) text = text.slice(0, -1);
      used = 0; line++;
      return { text, line, checkpoint: { version: 1, origin: client.baseUrl, path, etag, offset, line } };
    };
    for (;;) {
      client.signal?.throwIfAborted(); const next = await reader.read(); client.signal?.throwIfAborted();
      if (next.done) break;
      consumed += next.value.length;
      if (consumed > end - rangeStart + 1) throw new ResourceLimitError("Ranged response exceeds requested byte count");
      let at = 0;
      if (prefix && next.value.length) { if (next.value[0] !== 10) throw new TypeError("Checkpoint is not a complete line boundary"); at = 1; prefix = false; }
      while (at < next.value.length) {
        client.signal?.throwIfAborted();
        const newline = next.value.indexOf(10, at), stop = newline < 0 ? next.value.length : newline;
        const length = stop - at;
        if (used + length > maxLine) throw new ResourceLimitError("Line exceeds maxLineBytes");
        buffer.set(next.value.subarray(at, stop), used); used += length; offset += length;
        at = stop;
        if (newline >= 0) { offset++; at++; yield emit(); client.signal?.throwIfAborted(); }
      }
    }
    if (consumed !== end - rangeStart + 1) throw new TypeError("Truncated ranged response");
    if (end + 1 < size) throw new ResourceLimitError("Line reader reached maxBytes; resume from the last emitted checkpoint");
    if (used) { yield emit(false); client.signal?.throwIfAborted(); }
  } finally { client.signal?.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export class JsonLineError extends SyntaxError {
  constructor(public path: string, public line: number, cause: unknown) { super(`Invalid JSON record at ${path}:${line}`, { cause }); this.name = "JsonLineError"; }
}
export async function* readJsonLines<T = unknown>(client: AgfsClient, path: string, options: LineOptions & { maxRecords?: number; validate?: (value: unknown) => T } = {}): AsyncGenerator<{ value: T; line: number; checkpoint: LineCheckpoint }> {
  const maxRecords = integer(options.maxRecords ?? 10000, "maxRecords", 1, 1000000); let count = 0;
  for await (const row of readLines(client, path, options)) {
    client.signal?.throwIfAborted();
    if (++count > maxRecords) throw new ResourceLimitError("JSONL reader exceeds maxRecords");
    let value: T;
    try { const parsed: unknown = JSON.parse(row.text); jsonValue(parsed); value = options.validate ? options.validate(parsed) : parsed as T; }
    catch (error) { client.signal?.throwIfAborted(); throw new JsonLineError(path, row.line, error); }
    client.signal?.throwIfAborted(); yield { value, line: row.line, checkpoint: row.checkpoint }; client.signal?.throwIfAborted();
  }
}
