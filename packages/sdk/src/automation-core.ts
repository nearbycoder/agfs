import type { AgfsClient, Entry } from "./index.js";
import type { WorkflowResource } from "./workflow-state.js";

export class ResourceLimitError extends Error {
  constructor(message: string) { super(message); this.name = "ResourceLimitError"; }
}
export class UnsupportedPlatformError extends Error {
  constructor(message: string) { super(message); this.name = "UnsupportedPlatformError"; }
}
export interface ErrorDiagnostic { category: string; message: string; status?: number; retryable: boolean; exitCode: number; resourceId?: string; completed?: number; resources?: WorkflowResource[] }
/** Safe to serialize: never includes request headers, tokens, URLs, or nested causes. */
export function diagnoseError(error: unknown): ErrorDiagnostic {
  const seen = new Set<object>(), resources = new Map<string, WorkflowResource>();
  let current = error, result = diagnostic(error), workflow: { message: string; resourceId: string; completed: number } | undefined;
  const remember = (value: WorkflowResource) => {
    if (!value || typeof value.resourceId !== "string" || !value.resourceId || !Number.isSafeInteger(value.completed) || value.completed < 0) return;
    const prior = resources.get(value.resourceId), kind = value.kind === "draft" || value.kind === "run" ? value.kind : prior?.kind;
    resources.set(value.resourceId, { ...(kind ? { kind } : {}), resourceId: value.resourceId, completed: Math.max(value.completed, prior?.completed ?? 0) });
  };
  // Iterative traversal is proportional to the supplied finite cause graph.
  // Meaningful non-workflow errors (especially cancellation) are terminal: an
  // AbortError's caller-owned reason must not replace cancellation semantics.
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const e = current as Error & { resourceId?: string; completed?: number; resources?: WorkflowResource[] };
    const candidate = diagnostic(e);
    if (candidate.category !== "failure") result = candidate;
    if (e.name === "WorkflowError") {
      if (typeof e.resourceId === "string" && Number.isSafeInteger(e.completed) && e.completed! >= 0) {
        workflow ??= { message: typeof e.message === "string" ? e.message : "Workflow incomplete", resourceId: e.resourceId, completed: e.completed! };
        remember({ resourceId: e.resourceId, completed: e.completed! });
      }
      if (Array.isArray(e.resources)) for (const record of e.resources) remember(record);
    } else if (candidate.category !== "failure") break;
    // Do not invoke a dynamic cause getter that could fabricate an endless chain.
    const cause = Object.getOwnPropertyDescriptor(current, "cause");
    if (!cause || !Object.hasOwn(cause, "value")) break;
    current = cause.value;
  }
  return { ...result, ...workflow, ...(resources.size ? { resources: [...resources.values()] } : {}) };
}
function diagnostic(error: unknown): ErrorDiagnostic {
  const e = error as { name?: string; code?: string; status?: number; message?: string; cause?: unknown; resourceId?: string; completed?: number; resources?: WorkflowResource[] } | null;
  const status = typeof e?.status === "number" ? e.status : undefined;
  const category = e?.name === "AbortError" ? "cancelled" : e?.name === "TimeoutError" ? "timeout"
    : e?.name === "ResourceLimitError" ? "budget" : e?.name === "UnsupportedPlatformError" ? "unsupported_platform" : status === 401 || status === 403 ? "authorization"
    : status === 404 ? "not_found" : status === 409 || status === 412 ? "conflict"
    : status === 410 ? "checkpoint_expired" : status === 429 ? "rate_limited"
    : status !== undefined && status >= 500 ? "service" : e?.name === "TypeError" || e?.name === "SyntaxError" || e?.name === "JsonLineError" || typeof e?.code === "string" && e.code.startsWith("commander.") || status === 400 ? "invalid_input" : "failure";
  const exitCode = ({ cancelled: 130, timeout: 124, budget: 8, authorization: 3, not_found: 4, conflict: 5,
    checkpoint_expired: 6, rate_limited: 7, service: 7, invalid_input: 2, unsupported_platform: 9 } as Record<string, number>)[category] ?? 1;
  return { category, message: typeof e?.message === "string" ? e.message : "Operation failed", ...(status === undefined ? {} : { status }),
    retryable: ["timeout", "rate_limited", "service"].includes(category), exitCode };
}
export function integer(value: number, name: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${name} must be an integer from ${min} to ${max}`);
  return value;
}
export function remotePath(value: string): string {
  if (typeof value !== "string" || value.length > 4096 || !value.startsWith("/") || /[\\\x00-\x1f]/.test(value) ||
      (value !== "/" && value.split("/").slice(1).some(s => !s || s === "." || s === ".."))) throw new TypeError("Use a canonical absolute remote path without traversal");
  return value;
}
export const inside = (root: string, path: string) => path === root || path.startsWith(root === "/" ? "/" : root + "/");
export interface ClientIdentity { origin: string; account: string; workspace: string | null }
export async function clientIdentity(client: AgfsClient): Promise<ClientIdentity> {
  const who = await client.whoami() as { user?: { id?: unknown }; workspaceId?: unknown };
  if (typeof who.user?.id !== "string" || !who.user.id || !(who.workspaceId == null || typeof who.workspaceId === "string")) throw new TypeError("Invalid account identity response");
  return { origin: client.baseUrl, account: who.user.id, workspace: (who.workspaceId as string | null) ?? null };
}
export const sameIdentity = (a: ClientIdentity, b: ClientIdentity) => a.origin === b.origin && a.account === b.account && a.workspace === b.workspace;

/** Stops and cancels at the limit. A producer/runtime can still supply a larger individual chunk. */
export async function readBounded(response: Response, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  integer(maxBytes, "maxBytes", 0, 16 * 1024 * 1024);
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = []; let length = 0;
  const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal?.throwIfAborted();
      const next = await reader.read(); signal?.throwIfAborted();
      if (next.done) break;
      length += next.value.length;
      if (length > maxBytes) throw new ResourceLimitError("Response exceeds maxBytes");
      parts.push(next.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    return bytes;
  } finally { signal?.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function boundedJson<T>(client: AgfsClient, path: string, maxBytes = 2 * 1024 * 1024): Promise<T> {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBounded(await client.request("/api/v1" + path), maxBytes, client.signal)));
}
export function validateEntry(value: unknown, folder: string): Entry {
  remotePath(folder);
  if (!value || typeof value !== "object" || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw new TypeError("Invalid remote entry metadata");
  const fields = ["id", "path", "name", "kind", "size", "etag", "contentType", "updatedAt"] as const;
  const descriptors = Object.getOwnPropertyDescriptors(value), data: Record<string, unknown> = Object.create(null);
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError("Invalid remote entry metadata");
    data[field] = descriptor.value;
  }
  const entry = data as unknown as Entry;
  if (typeof entry.name !== "string" || !entry.name || entry.name.includes("/") ||
      entry.path !== (folder === "/" ? "/" : folder + "/") + entry.name) throw new TypeError("Invalid remote entry path");
  remotePath(entry.path);
  const text = (value: unknown, max: number, empty = false) => typeof value === "string" && (empty || value.length > 0) && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
  if (entry.kind !== "file" && entry.kind !== "folder" ||
      !(entry.size === null && entry.kind === "folder" || Number.isSafeInteger(entry.size) && entry.size! >= 0) ||
      !(entry.etag === null && entry.kind === "folder" || text(entry.etag, 256)) ||
      !text(entry.id, 256) || !text(entry.updatedAt, 100) || !(entry.contentType === null || text(entry.contentType, 255, true))) throw new TypeError("Invalid remote entry metadata");
  return { id: entry.id, path: entry.path, name: entry.name, kind: entry.kind, size: entry.size, etag: entry.etag, contentType: entry.contentType, updatedAt: entry.updatedAt };
}
export async function listBounded(client: AgfsClient, folder: string): Promise<Entry[]> {
  remotePath(folder);
  const result = await boundedJson<{ path: string; entries: Entry[] }>(client, "/fs/list?" + new URLSearchParams({ path: folder }));
  if (!result || result.path !== folder || !Array.isArray(result.entries) || result.entries.length > 10000) throw new TypeError("Invalid or oversized folder listing");
  const paths = new Set<string>();
  return result.entries.map(value => { const entry = validateEntry(value, folder); if (paths.has(entry.path)) throw new TypeError("Duplicate remote entry"); paths.add(entry.path); return entry; });
}
export async function fileEntry(client: AgfsClient, path: string): Promise<Entry | undefined> {
  remotePath(path); if (path === "/") throw new TypeError("Expected a file path");
  const entry = (await listBounded(client, path.slice(0, path.lastIndexOf("/")) || "/")).find(e => e.path === path);
  if (entry && entry.kind !== "file") throw new TypeError("Expected a file");
  return entry;
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)), b => b.toString(16).padStart(2, "0")).join("");
}
