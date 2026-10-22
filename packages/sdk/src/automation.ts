import { AgfsError, type AgfsClient, type Entry, type UploadOptions } from "./index.js";
import { boundedJson, clientIdentity, fileEntry, inside, integer, readBounded, remotePath, ResourceLimitError, sameIdentity, validateEntry, type ClientIdentity } from "./automation-core.js";
import { beginWorkflow, WorkflowError } from "./workflow-state.js";
export { WorkflowError, type WorkflowResource } from "./workflow-state.js";

export async function copyFile(source: AgfsClient, destination: AgfsClient, from: string, to: string,
  options: { maxBytes?: number; ifMatch?: string | null } = {}): Promise<Entry> {
  remotePath(from); remotePath(to);
  const max = integer(options.maxBytes ?? 1024 ** 3, "maxBytes", 0, 20 * 1024 ** 3);
  const entry = await fileEntry(source, from);
  if (!entry) throw new AgfsError(404, "Source file not found");
  if (entry.size! > max) throw new ResourceLimitError("Copy exceeds maxBytes");
  // Fetch may decode content while retaining encoded headers. Negotiate the
  // stored representation so stream lengths remain unambiguous across transports.
  const response = await source.request("/api/v1/fs/download?" + new URLSearchParams({ path: from }), {
    headers: { "if-match": entry.etag!, "accept-encoding": "identity" },
  });
  try {
    const encoding = response.headers.get("content-encoding");
    if (encoding !== null && encoding.trim().toLowerCase() !== "identity") throw new TypeError("Copy requires an unencoded file representation");
    return await destination.uploadStream(to, response.body ?? new Blob([]).stream(), entry.size!, {
      ifMatch: options.ifMatch === undefined ? null : options.ifMatch, contentType: entry.contentType ?? "application/octet-stream",
    });
  } finally { if (!response.body?.locked) await response.body?.cancel().catch(() => {}); }
}
export interface PublishResult { changed: boolean; entry: Entry }
async function currentText(client: AgfsClient, path: string, max: number) {
  const entry = await fileEntry(client, path);
  if (!entry) return { entry, text: undefined };
  if (entry.size! > max) throw new ResourceLimitError("Current file exceeds maxBytes");
  const bytes = await readBounded(await client.download(path, entry.etag!), max, client.signal);
  return { entry, text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) };
}
export async function publishText(client: AgfsClient, path: string, text: string,
  options: { maxBytes?: number; contentType?: string } = {}): Promise<PublishResult> {
  remotePath(path);
  const max = integer(options.maxBytes ?? 1048576, "maxBytes", 1, 8388608);
  if (typeof text !== "string" || text.length > max) throw new ResourceLimitError("Text exceeds maxBytes");
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > max) throw new ResourceLimitError("Text exceeds maxBytes");
  if (new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) !== text) throw new TypeError("Text contains an unpaired Unicode surrogate");
  const current = await currentText(client, path, max);
  if (current.entry && current.text === text && (options.contentType === undefined || options.contentType === current.entry.contentType)) return { changed: false, entry: current.entry };
  const entry = await client.upload(path, bytes, { ifMatch: current.entry?.etag ?? null, contentType: options.contentType ?? current.entry?.contentType ?? "text/plain; charset=utf-8" });
  return { changed: true, entry };
}
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
/** Reject lossy JSON values (undefined, non-finite numbers, class instances, cycles, sparse arrays). */
export function jsonValue(value: unknown, depth = 0, ancestors = new Set<object>()): asserts value is JsonValue {
  if (depth > 64) throw new TypeError("JSON nesting exceeds 64 levels");
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || ancestors.has(value)) throw new TypeError("Value cannot be represented exactly as JSON");
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError("Expected a plain JSON object");
  ancestors.add(value);
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError("Symbol keys cannot be serialized as JSON");
  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.keys(descriptors).some(key => key !== "length" && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) throw new TypeError("Extra array properties cannot be serialized as JSON");
    for (let i = 0; i < value.length; i++) {
      const descriptor = descriptors[String(i)];
      if (!descriptor) throw new TypeError("Sparse JSON array");
      if (!Object.hasOwn(descriptor, "value")) throw new TypeError("JSON array values cannot be getters");
      jsonValue(descriptor.value, depth + 1, ancestors);
    }
  } else {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError("JSON properties must be enumerable data properties");
      jsonValue(descriptor.value, depth + 1, ancestors);
    }
  }
  ancestors.delete(value);
}
/** RFC 7396: null deletes an object member; a non-object patch replaces the whole value. */
export function mergeJsonPatch(target: JsonValue, patch: JsonValue): JsonValue {
  jsonValue(target); jsonValue(patch);
  const merge = (current: JsonValue, change: JsonValue): JsonValue => {
    if (change === null || typeof change !== "object" || Array.isArray(change)) return change;
    const result: Record<string, JsonValue> = Object.assign(Object.create(null), current && typeof current === "object" && !Array.isArray(current) ? current : {});
    for (const [key, value] of Object.entries(change)) {
      if (value === null) delete result[key]; else result[key] = merge(Object.hasOwn(result, key) ? result[key] : null, value);
    }
    return result;
  };
  return merge(target, patch);
}
export async function transformJson(client: AgfsClient, path: string, transform: (value: JsonValue) => JsonValue | Promise<JsonValue>, options: { maxBytes?: number } = {}): Promise<PublishResult> {
  remotePath(path); const max = integer(options.maxBytes ?? 1048576, "maxBytes", 1, 8388608);
  const current = await currentText(client, path, max);
  if (!current.entry) throw new AgfsError(404, "JSON file not found");
  const original = JSON.parse(current.text!); jsonValue(original);
  const before = JSON.stringify(original), value = await transform(original); jsonValue(value);
  const serialized = JSON.stringify(value);
  if (serialized === before) return { changed: false, entry: current.entry };
  const bytes = new TextEncoder().encode(serialized);
  if (bytes.length > max) throw new ResourceLimitError("Transformed JSON exceeds maxBytes");
  return { changed: true, entry: await client.upload(path, bytes, { ifMatch: current.entry.etag!, contentType: "application/json" }) };
}
export interface ChangeCheckpoint { version: 1; identity: ClientIdentity; path: string; since: number; through: number; complete: boolean }
export interface ChangeBatch { changes: { seq: number; path: string; operation: string; entry: Entry | null }[]; checkpoint: ChangeCheckpoint }
function checkpointFields(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw new TypeError("Invalid change checkpoint");
  const descriptors = Object.getOwnPropertyDescriptors(value), snapshot: Record<string, unknown> = Object.create(null);
  for (const field of fields) { const d = descriptors[field]; if (!d?.enumerable || !Object.hasOwn(d, "value")) throw new TypeError("Invalid change checkpoint"); snapshot[field] = d.value; }
  return snapshot;
}
export async function* changeBatches(client: AgfsClient, path: string, options: { checkpoint?: ChangeCheckpoint; since?: number; maxPages?: number } = {}): AsyncGenerator<ChangeBatch> {
  remotePath(path); const maxPages = integer(options.maxPages ?? 100, "maxPages", 1, 10000);
  let cp: ChangeCheckpoint | undefined;
  if (options.checkpoint !== undefined) {
    const value = checkpointFields(options.checkpoint, ["version", "identity", "path", "since", "through", "complete"]);
    const identity = checkpointFields(value.identity, ["origin", "account", "workspace"]);
    const identifier = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 256 && !/[\x00-\x1f\x7f]/.test(v);
    if (value.version !== 1 || value.path !== path || typeof value.complete !== "boolean" || options.since !== undefined ||
        identity.origin !== client.baseUrl || !identifier(identity.account) || !(identity.workspace === null || identifier(identity.workspace))) throw new TypeError("Change checkpoint belongs to another scope");
    const since = integer(value.since as number, "checkpoint since", 0, Number.MAX_SAFE_INTEGER), through = integer(value.through as number, "checkpoint through", since, Number.MAX_SAFE_INTEGER);
    if (value.complete && since !== through) throw new TypeError("Invalid completed checkpoint");
    cp = { version: 1, path, identity: { origin: identity.origin as string, account: identity.account as string, workspace: identity.workspace as string | null }, since, through, complete: value.complete };
  }
  let since = cp ? cp.since : options.since, through = cp?.through;
  if (since !== undefined) integer(since, "since", 0, Number.MAX_SAFE_INTEGER);
  const identity = await clientIdentity(client);
  if (cp && !sameIdentity(identity, cp.identity)) throw new TypeError("Change checkpoint belongs to another scope");
  // A completed checkpoint begins the next finite window. An incomplete one resumes its old window.
  if (cp?.complete) through = undefined;
  for (let page = 0; page < maxPages; page++) {
    const result = await boundedJson<Awaited<ReturnType<AgfsClient["changes"]>>>(client, "/platform/changes?" + new URLSearchParams({ path,
      ...(since === undefined ? {} : { since: String(since) }), ...(through === undefined ? {} : { through: String(through) }) }), 8 * 1024 * 1024);
    integer(result.checkpoint, "server checkpoint", since ?? 0, Number.MAX_SAFE_INTEGER);
    if (through !== undefined && through !== result.checkpoint || !Array.isArray(result.changes) || result.changes.length > 500) throw new TypeError("Invalid change page");
    through = result.checkpoint; let previous = since ?? 0; const changes: ChangeBatch["changes"] = [];
    for (const change of result.changes) {
      integer(change.seq, "change sequence", previous + 1, through); remotePath(change.path);
      if (!inside(path, change.path) || !["upsert", "delete"].includes(change.operation)) throw new TypeError("Invalid change path or operation");
      if (change.operation === "upsert" && (!change.entry || change.entry.path !== change.path || !["file", "folder"].includes(change.entry.kind)) ||
          change.operation === "delete" && change.entry !== null) throw new TypeError("Invalid change entry");
      // Existing change-log triggers store updatedAt as epoch milliseconds,
      // whereas folder listings expose ISO text. Decode that wire representation
      // before enforcing the same public Entry schema for either endpoint.
      const wireEntry = change.entry as (Omit<Entry, "updatedAt"> & { updatedAt: unknown }) | null;
      const normalized = wireEntry && typeof wireEntry.updatedAt === "number" ? { ...wireEntry, updatedAt: new Date(integer(wireEntry.updatedAt, "entry timestamp", 0, 8640000000000000)).toISOString() } : wireEntry;
      const entry = normalized === null ? null : validateEntry(normalized, change.path.slice(0, change.path.lastIndexOf("/")) || "/");
      changes.push({ seq: change.seq, path: change.path, operation: change.operation, entry });
      previous = change.seq;
    }
    const complete = result.nextCursor === null;
    if (!complete && (!result.changes.length || result.nextCursor !== previous || previous <= (since ?? -1))) throw new TypeError("Invalid change cursor");
    since = complete ? through : result.nextCursor!;
    yield { changes, checkpoint: { version: 1, identity: { ...identity }, path, since, through, complete } };
    if (complete) return;
  }
  throw new ResourceLimitError("Change reader reached maxPages; resume from the last accepted checkpoint");
}
export interface DraftBatch { name: string; path: string; changes: { path: string; operation: "write" | "delete"; content?: string; contentType?: string }[] }
export function validateDraftBatch(batch: DraftBatch): void {
  if (!batch || typeof batch.name !== "string" || !batch.name.trim() || batch.name.length > 100 || !Array.isArray(batch.changes) || batch.changes.length < 1 || batch.changes.length > 30) throw new TypeError("Draft requires a name and 1–30 changes");
  remotePath(batch.path); const seen = new Set<string>();
  for (const change of batch.changes) {
    remotePath(change.path);
    if (!inside(batch.path, change.path) || change.path === batch.path || seen.has(change.path) || !["write", "delete"].includes(change.operation) ||
        change.operation === "write" && typeof change.content !== "string" || change.content !== undefined && (typeof change.content !== "string" || change.content.length > 8192) ||
        change.contentType !== undefined && (typeof change.contentType !== "string" || change.contentType.length > 255)) throw new TypeError("Invalid or duplicate draft change");
    seen.add(change.path);
  }
}
export async function stageDraft(client: AgfsClient, batch: DraftBatch): Promise<{ id: string; completed: number }> {
  validateDraftBatch(batch);
  batch = { name: batch.name, path: batch.path, changes: batch.changes.map(({ path, operation, content, contentType }) => ({ path, operation, content, contentType })) };
  const draft = await client.createDraft(batch.name, batch.path); let completed = 0;
  if (typeof draft.id !== "string" || draft.id.length > 256 || !/^[\w-]+$/.test(draft.id)) throw new TypeError("Invalid draft identifier");
  const progress = beginWorkflow(client, "draft", draft.id);
  try { for (const change of batch.changes) { await client.changeDraft(draft.id, change); completed++; progress.confirmed(); } }
  catch (error) { throw new WorkflowError(`Draft ${draft.id} staged ${completed}/${batch.changes.length} changes; inspect it before retrying`, draft.id, completed, error, [{ kind: "draft", resourceId: draft.id, completed }]); }
  progress.succeeded();
  return { id: draft.id, completed };
}
export async function withRun<T>(client: AgfsClient, name: string, path: string, work: (run: { id: string }) => Promise<T>, options: Parameters<AgfsClient["startRun"]>[2] = {}): Promise<{ id: string; value: T }> {
  remotePath(path); const run = await client.startRun(name, path, options);
  if (typeof run.id !== "string" || run.id.length > 256 || !/^[\w-]+$/.test(run.id)) throw new TypeError("Invalid run identifier");
  const progress = beginWorkflow(client, "run", run.id);
  try { const value = await work({ id: run.id }); await client.completeRun(run.id); progress.succeeded(); return { id: run.id, value }; }
  catch (error) { throw new WorkflowError(`Run ${run.id} was not confirmed complete; inspect it before retrying`, run.id, 0, error, [{ kind: "run", resourceId: run.id, completed: 0 }]); }
}
export async function verifyWebhook(secret: string, rawBody: Uint8Array, headers: { timestamp: string; signature: string }, options: { nowSeconds?: number; toleranceSeconds?: number; maxBytes?: number } = {}): Promise<boolean> {
  const max = integer(options.maxBytes ?? 1048576, "maxBytes", 1, 8388608), tolerance = integer(options.toleranceSeconds ?? 300, "toleranceSeconds", 0, 3600);
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000); integer(now, "nowSeconds", 0, Number.MAX_SAFE_INTEGER);
  if (!secret || secret.length > 4096 || rawBody.byteLength > max || typeof headers.timestamp !== "string" || !/^\d{1,16}$/.test(headers.timestamp) || typeof headers.signature !== "string" || headers.signature.length > 160) return false;
  const timestamp = Number(headers.timestamp);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > tolerance) return false;
  const signatures = headers.signature.split(",");
  if (signatures.length > 2 || signatures.some(s => !/^v1=[0-9a-f]{64}$/.test(s))) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const prefix = new TextEncoder().encode(headers.timestamp + "."), message = new Uint8Array(prefix.length + rawBody.length);
  message.set(prefix); message.set(rawBody, prefix.length);
  let valid = false;
  for (const signature of signatures) {
    const bytes = Uint8Array.from(signature.slice(3).match(/../g)!, value => parseInt(value, 16));
    // WebCrypto verifies each fixed-size MAC without a secret-dependent JS comparison.
    const matches = await crypto.subtle.verify("HMAC", key, bytes, message); valid = matches || valid;
  }
  return valid;
}
