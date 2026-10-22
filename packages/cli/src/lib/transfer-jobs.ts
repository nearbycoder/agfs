import path from "node:path";
import { createHash } from "node:crypto";
import { AgfsClient, AgfsError, clientIdentity, inside, integer, remotePath, ResourceLimitError, sameIdentity, validateInventory, listBounded, type ClientIdentity, type Inventory } from "@agfs/sdk";
import { assertDurablePlatform, atomicLocal, hashLocal, localPath, openRegular, readLocalJson, withJobLock, writeLocalJson } from "./automation-io";
import { readUploadPart } from "./upload-source";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function relative(root: string, remote: string): string {
  const value = remote.slice(root === "/" ? 1 : root.length + 1);
  if (!value || value.split("/").some(part => !part || part === "." || part === ".." || part.startsWith(".agfs-") || /[\\\x00-\x1f]/.test(part))) throw new TypeError("Unsafe or reserved automation path");
  return value;
}
interface JobCheckpoint { version: 1; kind: "export" | "bundle"; identity: ClientIdentity; manifest: string; completed: Record<string, { hash: string; size: number; etag: string }> }
async function checkpoint(filename: string, expected: Omit<JobCheckpoint, "completed">): Promise<JobCheckpoint> {
  let value: JobCheckpoint;
  try { value = await readLocalJson(filename); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...expected, completed: Object.create(null) }; throw error; }
  if (!value || value.version !== 1 || value.kind !== expected.kind || !value.identity || !sameIdentity(value.identity, expected.identity) || value.manifest !== expected.manifest ||
      !value.completed || typeof value.completed !== "object" || Array.isArray(value.completed) || Object.keys(value.completed).length > 10000) throw new TypeError("Checkpoint belongs to another manifest, account, workspace, or origin");
  for (const completed of Object.values(value.completed)) if (!completed || !/^[a-f0-9]{64}$/.test(completed.hash) || !Number.isSafeInteger(completed.size) || completed.size < 0 || typeof completed.etag !== "string" || !completed.etag) throw new TypeError("Invalid completed transfer checkpoint");
  return value;
}
export async function exportInventory(client: AgfsClient, input: Inventory, destination: string, options: { maxBytes?: number } = {}) {
  await assertDurablePlatform();
  const manifest = validateInventory(input), root = localPath(destination), identity = await clientIdentity(client);
  if (!sameIdentity(identity, manifest.identity)) throw new TypeError("Inventory belongs to another account, workspace, or origin");
  const maxBytes = integer(options.maxBytes ?? 1024 ** 3, "maxBytes", 0, 20 * 1024 ** 3);
  const files = manifest.entries.filter(e => e.kind === "file"), paths = new Set<string>(); let total = 0;
  for (const entry of manifest.entries) {
    const name = relative(manifest.root, entry.path); paths.add(name);
    if (entry.kind === "file") total += entry.size!;
  }
  // File ancestors would alias a directory destination; refuse before creating anything.
  const fileNames = new Set(files.map(entry => relative(manifest.root, entry.path)));
  for (const name of paths) { let slash = name.lastIndexOf("/"); while (slash >= 0) { if (fileNames.has(name.slice(0, slash))) throw new TypeError("Inventory has a file-directory collision"); slash = name.lastIndexOf("/", slash - 1); } }
  if (!Number.isSafeInteger(total) || total > maxBytes) throw new ResourceLimitError("Export exceeds maxBytes");
  const stateFile = path.join(root, ".agfs-export.json");
  return withJobLock(path.join(root, ".agfs-export.lock"), async () => {
    const state = await checkpoint(stateFile, { version: 1, kind: "export", identity, manifest: digest(manifest) });
    const allowed = new Map(files.map(e => [e.path, e]));
    for (const [key, record] of Object.entries(state.completed)) { const entry = allowed.get(key); if (!entry || entry.etag !== record.etag || entry.size !== record.size) throw new TypeError("Checkpoint entry does not match manifest"); }
    let downloaded = 0, skipped = 0;
    for (const entry of files) {
      client.signal?.throwIfAborted(); const target = path.join(root, relative(manifest.root, entry.path));
      const done = Object.hasOwn(state.completed, entry.path) ? state.completed[entry.path] : undefined;
      const existing = await hashLocal(target, maxBytes, client.signal);
      if (done && existing?.hash === done.hash && existing.size === done.size) { skipped++; continue; }
      if (existing) throw new AgfsError(409, `Local export destination changed or is untracked: ${target}`);
      const response = await client.download(entry.path, entry.etag!);
      if (!response.body) throw new TypeError("Missing file body");
      if (response.headers.has("content-encoding")) { await response.body.cancel(); throw new TypeError("Export requires unencoded file bytes"); }
      const result = await atomicLocal(target, response.body, entry.size!, { expectedSize: entry.size!, signal: client.signal, createOnly: true });
      state.completed[entry.path] = { ...result, etag: entry.etag! }; await writeLocalJson(stateFile, state); downloaded++;
    }
    return { downloaded, skipped, files: files.length, bytes: total, checkpoint: stateFile };
  });
}
export interface UploadBundle { version: 1; root: string; files: { source: string; path: string; ifMatch?: string | null; contentType?: string }[] }
export function validateBundle(value: UploadBundle): UploadBundle {
  if (!value || value.version !== 1 || !Array.isArray(value.files) || value.files.length < 1 || value.files.length > 1000) throw new TypeError("Bundle requires 1–1000 files");
  remotePath(value.root); const destinations = new Set<string>();
  for (const file of value.files) {
    remotePath(file.path);
    if (!inside(value.root, file.path) || file.path === value.root || destinations.has(file.path) || typeof file.source !== "string" || !file.source || path.isAbsolute(file.source) ||
        file.source.split(/[\\/]/).some(s => !s || s === "." || s === ".." || s.startsWith(".agfs-")) ||
        !(file.ifMatch === undefined || file.ifMatch === null || typeof file.ifMatch === "string" && !!file.ifMatch) ||
        file.contentType !== undefined && (typeof file.contentType !== "string" || file.contentType.length > 255)) throw new TypeError("Invalid or duplicate bundle item");
    destinations.add(file.path);
  }
  for (const destination of destinations) {
    let parent = destination.slice(0, destination.lastIndexOf("/"));
    while (parent) { if (destinations.has(parent)) throw new TypeError("Bundle file-directory collision"); parent = parent.slice(0, parent.lastIndexOf("/")); }
  }
  return { version: 1, root: value.root, files: value.files.map(({ source, path, ifMatch, contentType }) => ({ source, path, ifMatch, contentType })) };
}
export async function uploadBundle(client: AgfsClient, input: UploadBundle, localRoot: string, options: { maxBytes?: number; dryRun?: boolean } = {}) {
  await assertDurablePlatform();
  const manifest = validateBundle(input), root = localPath(localRoot), maxBytes = integer(options.maxBytes ?? 1024 ** 3, "maxBytes", 0, 20 * 1024 ** 3);
  const prepared: { item: UploadBundle["files"][number]; source: string; hash: string; size: number }[] = []; let total = 0;
  for (const item of manifest.files) {
    const source = path.join(root, item.source), version = await hashLocal(source, maxBytes - total, client.signal);
    if (!version) throw new TypeError("Bundle source not found: " + item.source);
    total += version.size; if (total > maxBytes) throw new ResourceLimitError("Bundle exceeds maxBytes"); prepared.push({ item, source, ...version });
  }
  if (options.dryRun) return { dryRun: true, files: prepared.map(p => ({ source: p.item.source, path: p.item.path, size: p.size, sha256: p.hash, ifMatch: p.item.ifMatch ?? null })), bytes: total };
  const identity = await clientIdentity(client), stateFile = path.join(root, ".agfs-bundle.json");
  return withJobLock(path.join(root, ".agfs-bundle.lock"), async () => {
    const state = await checkpoint(stateFile, { version: 1, kind: "bundle", identity, manifest: digest({ manifest, sources: prepared.map(p => ({ hash: p.hash, size: p.size })) }) });
    const known = new Set(prepared.map(p => p.item.path));
    for (const key of Object.keys(state.completed)) if (!known.has(key)) throw new TypeError("Unknown completed bundle item");
    // Preflight every destination before the first upload; one bounded listing per explicit parent.
    const parents = new Map<string, Set<string>>();
    for (const { item } of prepared) {
      const parent = item.path.slice(0, item.path.lastIndexOf("/")) || "/";
      if (!parents.has(parent)) parents.set(parent, new Set());
      parents.get(parent)!.add(item.path);
    }
    const destinations = new Map<string, { etag: string | null; kind: string }>();
    for (const [parent, selected] of parents) for (const [path, entry] of await selectedDestinations(client, parent, selected)) destinations.set(path, entry);
    for (const item of prepared) {
      const present = destinations.get(item.item.path);
      const done = Object.hasOwn(state.completed, item.item.path) ? state.completed[item.item.path] : undefined;
      if (done ? done.hash !== item.hash || done.size !== item.size || present?.etag !== done.etag || present.kind !== "file"
        : item.item.ifMatch == null ? !!present : present?.etag !== item.item.ifMatch || present.kind !== "file") throw new AgfsError(409, "Bundle destination changed: " + item.item.path);
    }
    let uploaded = 0, skipped = 0;
    for (const item of prepared) {
      client.signal?.throwIfAborted(); if (Object.hasOwn(state.completed, item.item.path)) { skipped++; continue; }
      const file = await openRegular(item.source);
      try {
        const before = await file.stat();
        const verify = async () => {
          const after = await file.stat();
          if (before.size !== item.size || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new AgfsError(409, "Bundle source changed");
          const current = await hashLocal(item.source, item.size, client.signal);
          if (current?.hash !== item.hash || current.size !== item.size) throw new AgfsError(409, "Bundle source changed");
        };
        await verify();
        const entry = await client.uploadSource(item.item.path, { size: item.size, read: (start, end) => readUploadPart(file, start, end).then(bytes => new Uint8Array(bytes)) }, {
          ifMatch: item.item.ifMatch ?? null, contentType: item.item.contentType, concurrency: 1, verifySource: verify,
        });
        if (!entry || entry.path !== item.item.path || typeof entry.etag !== "string" || !entry.etag) throw new TypeError("Invalid committed bundle entry");
        state.completed[item.item.path] = { hash: item.hash, size: item.size, etag: entry.etag }; await writeLocalJson(stateFile, state); uploaded++;
      } finally { await file.close(); }
    }
    return { uploaded, skipped, files: prepared.length, bytes: total, checkpoint: stateFile };
  });
}
// The full bounded listing dies with this frame before the next parent request.
// Only explicitly selected destination metadata survives the preflight phase.
async function selectedDestinations(client: AgfsClient, parent: string, selected: Set<string>) {
  const result = new Map<string, { etag: string | null; kind: string }>();
  for (const entry of await listBounded(client, parent)) if (selected.has(entry.path)) result.set(entry.path, { etag: entry.etag, kind: entry.kind });
  return result;
}
