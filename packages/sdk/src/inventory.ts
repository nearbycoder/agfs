import type { AgfsClient, Entry } from "./index.js";
import { clientIdentity, inside, integer, listBounded, remotePath, ResourceLimitError, sameIdentity, validateEntry, type ClientIdentity } from "./automation-core.js";

export interface WalkOptions { maxEntries?: number; maxFolders?: number; maxDepth?: number; prune?: (entry: Entry) => boolean }
/** Sequential, pull-driven traversal. Each fetched directory is bounded to 2 MiB. */
export async function* walk(client: AgfsClient, root = "/", options: WalkOptions = {}): AsyncGenerator<Entry> {
  remotePath(root);
  const maxEntries = integer(options.maxEntries ?? 10000, "maxEntries", 1, 10000);
  const maxFolders = integer(options.maxFolders ?? 1000, "maxFolders", 1, 10000);
  const maxDepth = integer(options.maxDepth ?? 16, "maxDepth", 0, 64);
  const pending = [{ path: root, depth: 0 }]; let entries = 0, folders = 0;
  while (pending.length) {
    client.signal?.throwIfAborted();
    if (++folders > maxFolders) throw new ResourceLimitError("Walk exceeds maxFolders");
    const folder = pending.pop()!;
    remotePath(folder.path); if (!inside(root, folder.path)) throw new TypeError("Traversal escaped its root");
    const listed = (await listBounded(client, folder.path)).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    entries += listed.length;
    if (entries > maxEntries) throw new ResourceLimitError("Walk exceeds maxEntries");
    const children: typeof pending = [];
    for (const entry of listed) {
      client.signal?.throwIfAborted();
      if (options.prune?.({ ...entry })) continue;
      if (entry.kind === "folder" && folder.depth < maxDepth) children.push({ path: entry.path, depth: folder.depth + 1 });
      yield { ...entry };
    }
    pending.push(...children.reverse());
  }
}
export interface Inventory { version: 1; identity: ClientIdentity; root: string; entries: Entry[] }
export async function captureInventory(client: AgfsClient, root: string, options: WalkOptions = {}): Promise<Inventory> {
  remotePath(root); const identity = await clientIdentity(client), entries: Entry[] = [];
  const encoder = new TextEncoder(); let metadataBytes = encoder.encode(JSON.stringify({ version: 1, identity, root, entries: [] })).length;
  for await (const entry of walk(client, root, options)) {
    metadataBytes += encoder.encode(JSON.stringify(entry)).length + 1;
    if (metadataBytes > 8 * 1024 * 1024) throw new ResourceLimitError("Inventory metadata exceeds 8 MiB");
    entries.push(entry);
  }
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { version: 1, identity, root, entries };
}
export function validateInventory(value: unknown): Inventory {
  const v = value as Inventory;
  if (!v || v.version !== 1 || !v.identity || typeof v.identity.origin !== "string" || typeof v.identity.account !== "string" || !v.identity.account ||
      !(v.identity.workspace === null || typeof v.identity.workspace === "string") || !Array.isArray(v.entries) || v.entries.length > 10000) throw new TypeError("Invalid inventory");
  const origin = new URL(v.identity.origin);
  if (origin.origin !== v.identity.origin || origin.username || origin.password || origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))) throw new TypeError("Invalid inventory origin");
  remotePath(v.root); const paths = new Set<string>(), entries: Entry[] = [];
  for (const entry of v.entries) {
    const path = entry && typeof entry === "object" ? Object.getOwnPropertyDescriptor(entry, "path")?.value : undefined;
    if (typeof path !== "string" || !inside(v.root, path) || path === v.root || paths.has(path)) throw new TypeError("Invalid inventory path");
    entries.push(validateEntry(entry, path.slice(0, path.lastIndexOf("/")) || "/")); paths.add(path);
  }
  return { version: 1, identity: { origin: v.identity.origin, account: v.identity.account, workspace: v.identity.workspace }, root: v.root,
    entries };
}
export interface InventoryDifference { path: string; status: "added" | "removed" | "changed" | "unchanged"; before?: Entry; after?: Entry }
export function compareInventories(before: Inventory, after: Inventory): InventoryDifference[] {
  before = validateInventory(before); after = validateInventory(after);
  if (!sameIdentity(before.identity, after.identity) || before.root !== after.root) throw new TypeError("Inventories belong to different scopes");
  const a = new Map(before.entries.map(e => [e.path, e])), b = new Map(after.entries.map(e => [e.path, e]));
  return [...new Set([...a.keys(), ...b.keys()])].sort().map(path => {
    const x = a.get(path), y = b.get(path);
    const status = !x ? "added" : !y ? "removed" : x.kind !== y.kind || x.etag !== y.etag || x.size !== y.size || x.contentType !== y.contentType ? "changed" : "unchanged";
    return { path, status, ...(x ? { before: x } : {}), ...(y ? { after: y } : {}) };
  });
}
