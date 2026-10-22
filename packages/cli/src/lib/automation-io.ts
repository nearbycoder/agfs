import { constants } from "node:fs";
import { open, mkdir, mkdtemp, rename, link, unlink, rmdir, lstat, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { AgfsError, ResourceLimitError, UnsupportedPlatformError } from "@agfs/sdk";

// New durable jobs require Linux descriptor paths. Never fall back to a weaker traversal.
const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
export function localPath(value: string): string {
  if (process.platform !== "linux") throw new UnsupportedPlatformError("Durable automation files require Linux /proc/self/fd and O_NOFOLLOW; use portable SDK streaming APIs or inventory diff on other platforms");
  if (value.includes("\0") || value.split(path.sep).includes("..")) throw new TypeError("Local paths cannot contain parent traversal");
  return path.resolve(value);
}
export async function assertDurablePlatform() {
  localPath(".");
  let probe: FileHandle | undefined;
  try { probe = await open("/proc/self/fd", directoryFlags); }
  catch (error) {
    if (["ENOENT", "ENOTDIR", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "")) throw new UnsupportedPlatformError("Durable automation requires a mounted /proc/self/fd on Linux; use SDK streaming APIs or inventory diff instead");
    throw error;
  } finally { await probe?.close(); }
}
export async function anchorFile(value: string, create = false): Promise<{ directory: FileHandle; name: string; target: string }> {
  const absolute = localPath(value), parts = absolute.split("/").filter(Boolean), name = parts.pop();
  if (!name) throw new TypeError("Expected a local file path");
  let directory = await open("/", directoryFlags);
  try {
    for (const segment of parts) {
      const target = `/proc/self/fd/${directory.fd}/${segment}`;
      let next: FileHandle;
      try { next = await open(target, directoryFlags); }
      catch (error) {
        if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        try { await mkdir(target, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
        next = await open(target, directoryFlags);
      }
      await directory.close(); directory = next;
    }
    return { directory, name, target: `/proc/self/fd/${directory.fd}/${name}` };
  } catch (error) { await directory.close(); throw error; }
}
export async function openRegular(value: string): Promise<FileHandle> {
  const anchor = await anchorFile(value);
  try {
    const file = await open(anchor.target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!(await file.stat()).isFile()) { await file.close(); throw new TypeError("Expected a regular local file"); }
    return file;
  } finally { await anchor.directory.close(); }
}
export async function readLocal(value: string, maxBytes = 8 * 1024 * 1024): Promise<Uint8Array> {
  const file = await openRegular(value);
  try {
    if ((await file.stat()).size > maxBytes) throw new ResourceLimitError("Local document exceeds byte limit");
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of file.createReadStream({ autoClose: false, highWaterMark: 65536 })) {
      size += chunk.length; if (size > maxBytes) throw new ResourceLimitError("Local document exceeds byte limit"); chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  } finally { await file.close(); }
}
export const readLocalJson = async (value: string, maxBytes?: number): Promise<any> => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readLocal(value, maxBytes)));
/** Read-only offline tools use portable regular-file reads; no protected writes are needed. */
export async function readPortableJson(value: string, maxBytes = 8 * 1024 * 1024): Promise<any> {
  if (value.includes("\0") || value.split(/[\\/]/).includes("..")) throw new TypeError("Local paths cannot contain parent traversal");
  const absolute = path.resolve(value), segments = absolute.slice(path.parse(absolute).root.length).split(path.sep).filter(Boolean);
  let current = path.parse(absolute).root;
  for (const segment of segments) { current = path.join(current, segment); if ((await lstat(current)).isSymbolicLink()) throw new TypeError("Refusing local document symlink"); }
  const before = await lstat(absolute);
  if (!before.isFile() || before.size > maxBytes) throw new TypeError("Expected a bounded regular JSON document");
  const file = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = await file.stat(); if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev) throw new TypeError("Local document changed");
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of file.createReadStream({ autoClose: false, highWaterMark: 65536 })) { size += chunk.length; if (size > maxBytes) throw new ResourceLimitError("Local document exceeds byte limit"); chunks.push(chunk); }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)));
  } finally { await file.close(); }
}
export async function hashLocal(value: string, maxBytes: number, signal?: AbortSignal): Promise<{ hash: string; size: number } | undefined> {
  let file: FileHandle;
  try { file = await openRegular(value); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  try {
    const before = await file.stat(); if (before.size > maxBytes) throw new ResourceLimitError("Local file exceeds byte limit");
    const hash = createHash("sha256"); let size = 0;
    for await (const chunk of file.createReadStream({ autoClose: false, highWaterMark: 262144, signal })) {
      signal?.throwIfAborted(); size += chunk.length; if (size > maxBytes) throw new ResourceLimitError("Local file exceeds byte limit"); hash.update(chunk);
    }
    const after = await file.stat();
    if (size !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("Local file changed while hashing");
    return { hash: hash.digest("hex"), size };
  } finally { await file.close(); }
}
export async function atomicLocal(value: string, body: ReadableStream<Uint8Array>, maxBytes: number, options: { expectedSize?: number; signal?: AbortSignal; createOnly?: boolean } = {}): Promise<{ size: number; hash: string }> {
  const reader = body.getReader(); let directory: FileHandle | undefined, staging: FileHandle | undefined, temporary: string | undefined;
  let temporaryInode: { ino: number; dev: number } | undefined;
  let contentInode: { ino: number; dev: number } | undefined;
  const abort = () => { void reader.cancel(options.signal?.reason).catch(() => {}); };
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    options.signal?.throwIfAborted(); const anchor = await anchorFile(value, true); directory = anchor.directory;
    const checkDestination = async () => {
      try { const stat = await lstat(anchor.target); if (!stat.isFile() || stat.isSymbolicLink()) throw new TypeError("Refusing unsafe destination"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    };
    await checkDestination();
    temporary = await mkdtemp(`/proc/self/fd/${directory.fd}/.agfs-stage-`);
    staging = await open(temporary, directoryFlags); const stat = await staging.stat(); temporaryInode = stat;
    if (stat.uid !== process.geteuid!() || stat.mode & 0o077) throw new Error("Unsafe staging directory");
    const staged = `/proc/self/fd/${staging.fd}/content`, file = await open(staged, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const opened = await file.stat(); contentInode = opened; const hash = createHash("sha256"); let size = 0;
    try {
      for (;;) {
        options.signal?.throwIfAborted(); const next = await reader.read(); options.signal?.throwIfAborted(); if (next.done) break;
        size += next.value.length;
        if (size > maxBytes || options.expectedSize !== undefined && size > options.expectedSize) throw new ResourceLimitError("Download exceeds declared byte limit");
        await file.writeFile(next.value); hash.update(next.value);
      }
      if (options.expectedSize !== undefined && size !== options.expectedSize) throw new TypeError("Download size mismatch");
      const source = await lstat(staged);
      if (!source.isFile() || source.isSymbolicLink() || source.dev !== opened.dev || source.ino !== opened.ino || source.size !== size) throw new Error("Staging file changed");
      const namedDirectory = await lstat(temporary);
      if (!namedDirectory.isDirectory() || namedDirectory.isSymbolicLink() || namedDirectory.dev !== temporaryInode.dev || namedDirectory.ino !== temporaryInode.ino) throw new Error("Staging directory changed");
      await checkDestination(); options.signal?.throwIfAborted();
      if (options.createOnly) {
        // link(2) installs the finished inode atomically and refuses any existing
        // destination, including one created after our last metadata check.
        try { await link(staged, anchor.target); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new AgfsError(409, "Local export destination already exists"); throw error; }
      } else await rename(staged, anchor.target);
      return { size, hash: hash.digest("hex") };
    } finally { await file.close(); }
  } finally {
    options.signal?.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); reader.releaseLock();
    if (staging) {
      const staged = `/proc/self/fd/${staging.fd}/content`;
      if (contentInode) {
        const current = await lstat(staged).catch(() => undefined);
        if (current?.ino === contentInode.ino && current.dev === contentInode.dev && current.isFile()) await unlink(staged).catch(() => {});
      }
      await staging.close();
    }
    if (temporary && temporaryInode) {
      try { const named = await lstat(temporary); if (named.ino === temporaryInode.ino && named.dev === temporaryInode.dev) await rmdir(temporary); } catch {}
    }
    await directory?.close();
  }
}
export const writeLocalJson = async (value: string, data: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  if (bytes.length > 8 * 1024 * 1024) throw new ResourceLimitError("Checkpoint exceeds 8 MiB");
  return atomicLocal(value, new Blob([bytes]).stream(), bytes.length, { expectedSize: bytes.length });
};
export async function withJobLock<T>(filename: string, work: () => Promise<T>): Promise<T> {
  const anchor = await anchorFile(filename, true); let lock: FileHandle | undefined;
  try { lock = await open(anchor.target, "wx", 0o600); const own = await lock.stat();
    try { await lock.writeFile(JSON.stringify({ pid: process.pid })); return await work(); }
    finally { const current = await lstat(anchor.target).catch(() => null); if (current?.ino === own.ino && current.dev === own.dev) await unlink(anchor.target); }
  } finally { await lock?.close(); await anchor.directory.close(); }
}
