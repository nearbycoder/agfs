import { lstat, mkdir, mkdtemp, open, rename, rm } from "node:fs/promises";
import path from "node:path";

async function inspect(target: string) {
  try {
    return await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// Remote names must never redirect writes through pre-existing local symlinks.
export async function ensureDownloadDirectory(directory: string) {
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  for (const segment of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!(await inspect(current))) {
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    const entry = await inspect(current);
    if (entry?.isSymbolicLink()) throw new Error("Refusing download through a symlink");
    if (!entry?.isDirectory()) throw new Error("Download parent is not a directory");
  }
}

async function checkFile(destination: string) {
  const entry = await inspect(destination);
  if (entry?.isSymbolicLink()) throw new Error("Refusing to replace a download symlink");
  if (entry && !entry.isFile()) throw new Error("Download destination is not a regular file");
}

export async function writeDownloadFile(
  destination: string,
  body: ReadableStream<Uint8Array>,
  progress: (bytes: number) => void,
  expectedSize?: number,
) {
  const reader = body.getReader();
  let temporary: string | undefined;
  try {
    await ensureDownloadDirectory(path.dirname(destination));
    await checkFile(destination);
    temporary = await mkdtemp(path.join(path.dirname(path.resolve(destination)), ".agfs-download-"));
    const filePath = path.join(temporary, "content");
    const file = await open(filePath, "wx", 0o600);
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (expectedSize !== undefined && total > expectedSize) throw new Error("Download size mismatch");
        await file.writeFile(value);
        progress(total);
      }
      if (expectedSize !== undefined && total !== expectedSize) throw new Error("Download size mismatch");
    } finally {
      await file.close();
    }
    await ensureDownloadDirectory(path.dirname(destination));
    await checkFile(destination);
    // Rename replaces the directory entry, so an existing hard link is never truncated.
    await rename(filePath, destination);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
