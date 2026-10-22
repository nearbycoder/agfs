import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";
import { mapConcurrent, mapConcurrentIterable, type Entry } from "@agfs/sdk";

export async function localVersion(file: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  let before;
  try { before = await lstat(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink())
    throw new Error("Sync refuses non-regular files: " + file);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev)
      throw new Error("Local file changed during sync: " + file);
    const hash = createHash("sha256");
    for await (const bytes of handle.createReadStream({ autoClose: false, signal })) hash.update(bytes);
    const after = await handle.stat();
    if (opened.size !== after.size || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs)
      throw new Error("Local file changed during sync: " + file);
    return { hash: hash.digest("hex"), size: after.size };
  } finally { await handle.close(); }
}

export async function hashFile(file: string, signal?: AbortSignal) {
  return (await localVersion(file, signal))?.hash;
}

export async function scanLocalFiles(
  root: string, ignored: (name: string) => boolean, concurrency: number, signal?: AbortSignal,
  readVersion = localVersion,
) {
  async function* walk(directory: string, relative = ""): AsyncGenerator<string> {
    signal?.throwIfAborted();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = relative ? relative + "/" + entry.name : entry.name;
      if (ignored(name)) continue;
      if (entry.isSymbolicLink()) throw new Error("Sync refuses symlinks: " + name);
      if (entry.isDirectory()) yield* walk(path.join(directory, entry.name), name);
      else if (entry.isFile()) yield name;
      else throw new Error("Sync refuses special files: " + name);
    }
  }
  const versions = new Map<string, { hash: string; size: number }>();
  for await (const [name, version] of mapConcurrentIterable(walk(root), concurrency, async (name) => {
    const version = await readVersion(path.join(root, name), signal);
    if (!version) throw new Error("Local file disappeared during sync: " + name);
    return [name, version] as const;
  }, signal)) versions.set(name, version);
  return versions;
}

export async function scanRemoteFiles(
  client: { list: (folder: string) => Promise<{ entries: Entry[] }> },
  root: string, ignored: (name: string) => boolean, concurrency: number, signal?: AbortSignal,
) {
  const files = new Map<string, Entry>();
  const folders = [{ folder: root, relative: "" }];
  const seen = new Set<string>();
  for (let index = 0; index < folders.length;) {
    const batch = folders.slice(index, index + concurrency);
    index += batch.length;
    await mapConcurrent(batch, concurrency, async ({ folder, relative }) => {
      const result = await client.list(folder);
      for (const entry of result.entries) {
        if (!entry.name || entry.name === "." || entry.name === ".." || /[\\/\x00-\x1f]/.test(entry.name) ||
          (process.platform === "win32" && entry.name.includes(":")))
          throw new Error("Unsafe remote filename");
        const name = relative ? relative + "/" + entry.name : entry.name;
        const expected = (folder === "/" ? "/" : folder + "/") + entry.name;
        if (entry.path !== expected || seen.has(name)) throw new Error("Invalid remote entry path");
        seen.add(name);
        if (ignored(name)) continue;
        if (entry.kind === "folder") folders.push({ folder: entry.path, relative: name });
        else if (entry.kind === "file") files.set(name, entry);
        else throw new Error("Invalid remote entry kind");
      }
    }, signal);
  }
  return files;
}

/** Start both lanes immediately, drain both, preserve the first observed failure. */
export async function discoverTogether<A, B>(local: () => Promise<A>, remote: () => Promise<B>): Promise<[A, B]> {
  let failed = false, failure: unknown;
  const capture = <T>(work: () => Promise<T>) => Promise.resolve().then(work).catch((error) => {
    if (!failed) failure = error;
    failed = true;
    throw error;
  });
  const results = await Promise.allSettled([capture(local), capture(remote)]);
  if (failed) throw failure;
  return [(results[0] as PromiseFulfilledResult<A>).value, (results[1] as PromiseFulfilledResult<B>).value];
}

/** All callers wait until the snapshot containing their update has been saved. */
export function checkpointWriter(write: () => Promise<void>) {
  let requested = 0, running: Promise<void> | undefined;
  return () => {
    requested++;
    if (running) return running;
    const completion = new Promise<void>((resolve, reject) => {
      queueMicrotask(async () => {
        try {
          for (;;) {
            const version = requested;
            await write();
            if (version === requested) {
              // Retire synchronously with the last generation check. A later
              // caller must start a successor, even before this promise settles.
              running = undefined;
              resolve();
              return;
            }
          }
        } catch (error) {
          running = undefined;
          reject(error);
        }
      });
    });
    running = completion;
    return completion;
  };
}
