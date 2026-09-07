import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { lstat, readdir, readFile, open, unlink } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import { lookup } from "mime-types";
import { AgfsClient as SDK, type Entry } from "@agfs/sdk";
import { AgfsClient } from "../lib/client";
import {
  ensureDownloadDirectory,
  writeDownloadFile,
} from "../lib/safe-download";
import { ignoredPath, syncOperation, type SyncVersion } from "../lib/sync-plan";
async function hashFile(file: string): Promise<string | undefined> {
  let stat;
  try {
    stat = await lstat(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("Sync refuses non-regular files: " + file);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const hash = createHash("sha256");
    for await (const bytes of handle.createReadStream({ autoClose: false }))
      hash.update(bytes);
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}
async function responseHash(response: Response) {
  const hash = createHash("sha256");
  if (response.body)
    for await (const bytes of response.body as any) hash.update(bytes);
  return hash.digest("hex");
}
interface State {
  version: 1;
  namespace: string;
  remoteRoot: string;
  files: Record<string, SyncVersion>;
}
async function synchronize(
  client: SDK,
  localRoot: string,
  remoteRoot: string,
  options: { dryRun?: boolean; delete?: boolean },
  namespace: string,
) {
  await ensureDownloadDirectory(localRoot);
  const ignoreFile = path.join(localRoot, ".agfsignore");
  let patterns: string[] = [];
  try {
    const stat = await lstat(ignoreFile);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("Ignore file must be a regular file");
    patterns = (await readFile(ignoreFile, "utf8"))
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("#"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const local = new Map<string, string>(),
    remote = new Map<string, Entry>();
  async function scanLocal(directory: string, relative = "") {
    for (const e of await readdir(directory, { withFileTypes: true })) {
      const name = relative ? relative + "/" + e.name : e.name;
      if (ignoredPath(name, patterns)) continue;
      if (e.isSymbolicLink()) throw new Error("Sync refuses symlinks: " + name);
      if (e.isDirectory()) await scanLocal(path.join(directory, e.name), name);
      else if (e.isFile())
        local.set(name, (await hashFile(path.join(directory, e.name)))!);
      else throw new Error("Sync refuses special files: " + name);
    }
  }
  async function scanRemote(folder: string, relative = "") {
    const result = await client.list(folder);
    for (const e of result.entries) {
      if (e.name === "." || e.name === ".." || /[\\/\x00-\x1f]/.test(e.name))
        throw new Error("Unsafe remote filename");
      const name = relative ? relative + "/" + e.name : e.name;
      if (ignoredPath(name, patterns)) continue;
      if (e.kind === "folder") await scanRemote(e.path, name);
      else remote.set(name, e);
    }
  }
  await scanLocal(localRoot);
  await scanRemote(remoteRoot);
  const statePath = path.join(localRoot, ".agfs-sync.json");
  let state: State = { version: 1, namespace, remoteRoot, files: {} };
  try {
    const entry = await lstat(statePath);
    if (!entry.isFile() || entry.isSymbolicLink())
      throw new Error("Invalid sync state file");
    state = JSON.parse(await readFile(statePath, "utf8"));
    if (
      state.version !== 1 ||
      state.namespace !== namespace ||
      state.remoteRoot !== remoteRoot ||
      !state.files ||
      typeof state.files !== "object"
    )
      throw new Error("Sync state belongs to another workspace or folder");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const names = [
    ...new Set([
      ...local.keys(),
      ...remote.keys(),
      ...Object.keys(state.files),
    ]),
  ]
    .filter((n) => !ignoredPath(n, patterns))
    .sort();
  const plan = [];
  for (const name of names) {
    if (
      name.split("/").some((p) => p === ".." || p === "." || !p) ||
      /[\\\x00-\x1f]/.test(name)
    )
      throw new Error("Invalid sync state path");
    let operation = syncOperation(
      local.get(name),
      remote.get(name)?.etag ?? undefined,
      state.files[name],
      options.delete,
    );
    if (operation === "compare") {
      const hash = await responseHash(
        await client.download(remote.get(name)!.path, remote.get(name)!.etag!),
      );
      operation = hash === local.get(name) ? "unchanged" : "conflict";
    }
    plan.push({ name, operation });
  }
  for (const p of plan)
    if (p.operation !== "unchanged")
      console.log(`${p.operation.padEnd(14)} ${p.name}`);
  if (plan.some((p) => p.operation === "conflict"))
    throw new Error(
      "Sync found conflicts. Resolve both copies before retrying; no files were changed.",
    );
  if (options.dryRun) {
    console.log("Dry run complete. No files or sync state changed.");
    return;
  }
  const next = { ...state, files: { ...state.files } };
  for (const { name, operation } of plan) {
    const destination = path.join(localRoot, name),
      remotePath = remoteRoot === "/" ? "/" + name : remoteRoot + "/" + name,
      originalHash = local.get(name),
      entry = remote.get(name);
    if ((await hashFile(destination)) !== originalHash)
      throw new Error("Local file changed during sync: " + name);
    if (operation === "upload") {
      const file = await open(
        destination,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stat = await file.stat();
        const saved = await client.uploadSource(
          remotePath,
          {
            size: stat.size,
            read: async (start, end) => {
              const bytes = new Uint8Array(end - start);
              const r = await file.read(bytes, 0, bytes.length, start);
              return bytes.subarray(0, r.bytesRead);
            },
          },
          {
            contentType: lookup(name) || "application/octet-stream",
            ifMatch: entry?.etag ?? null,
          },
        );
        if ((await hashFile(destination)) !== originalHash)
          throw new Error(
            "Local file changed during upload; review before retrying: " + name,
          );
        next.files[name] = { local: originalHash!, remote: saved.etag! };
      } finally {
        await file.close();
      }
    } else if (operation === "download") {
      const response = await client.download(remotePath, entry!.etag!);
      if (!response.body) throw new Error("Empty download response");
      await writeDownloadFile(
        destination,
        response.body,
        () => {},
        undefined,
        async () => {
          if ((await hashFile(destination)) !== originalHash)
            throw new Error("Local file changed during download: " + name);
        },
      );
      next.files[name] = {
        local: (await hashFile(destination))!,
        remote: entry!.etag!,
      };
    } else if (operation === "delete-remote") {
      await client.json("/fs/delete", "POST", {
        path: remotePath,
        ifMatch: entry!.etag,
      });
      delete next.files[name];
    } else if (operation === "delete-local") {
      // Recheck remote absence before propagating a previously observed deletion.
      const siblings = await client.list(path.posix.dirname(remotePath));
      if (siblings.entries.some((e) => e.path === remotePath))
        throw new Error("Remote file reappeared: " + name);
      if ((await hashFile(destination)) !== originalHash)
        throw new Error("Local file changed before deletion: " + name);
      await unlink(destination);
      delete next.files[name];
    } else if (originalHash && entry) {
      next.files[name] = { local: originalHash, remote: entry.etag! };
    } else if (!originalHash && !entry) delete next.files[name];
    // Persist progress after every file, so interruption resumes safely.
    await writeDownloadFile(
      statePath,
      new Blob([JSON.stringify(next, null, 2)]).stream(),
      () => {},
    );
  }
  console.log("Sync complete.");
}
export function registerSyncCommands(program: Command) {
  for (const watch of [false, true])
    program
      .command(watch ? "watch <local> <remote>" : "sync <local> <remote>")
      .description(
        watch
          ? "Continuously synchronize files; stop with Ctrl+C"
          : "Synchronize local and AGFS files with conflict detection",
      )
      .option("--dry-run", "Print changes without applying them")
      .option("--delete", "Propagate tracked deletions")
      .option("--interval <seconds>", "Watch polling interval", "5")
      .action(
        async (
          local: string,
          remote: string,
          options: { dryRun?: boolean; delete?: boolean; interval: string },
        ) => {
          if (!remote.startsWith("/") || remote.split("/").includes(".."))
            throw new Error("Use an absolute remote path without ..");
          remote = path.posix.normalize(remote).replace(/\/$/, "") || "/";
          const root = path.resolve(local),
            resolved = await AgfsClient.fromConfig();
          if (!resolved.token)
            throw new Error("Sign in first with agfs auth login");
          const client = new SDK({
            token: resolved.token,
            baseUrl: resolved.baseUrl,
          });
          const who = (await client.whoami()) as any,
            namespace =
              resolved.baseUrl +
              ":" +
              who.user.id +
              ":" +
              (who.workspaceId ?? "personal");
          const interval = Number(options.interval);
          if (!Number.isFinite(interval) || interval < 2 || interval > 3600)
            throw new Error("Interval must be 2–3600 seconds");
          await ensureDownloadDirectory(root);
          const lock = path.join(root, ".agfs-sync.lock"),
            handle = await open(lock, "wx", 0o600);
          let stopped = false;
          const stop = () => {
            stopped = true;
          };
          process.on("SIGINT", stop);
          process.on("SIGTERM", stop);
          try {
            await handle.writeFile(String(process.pid));
            do {
              await synchronize(client, root, remote, options, namespace);
              if (watch && !options.dryRun && !stopped)
                await new Promise<void>((resolve) => {
                  const timer = setTimeout(done, interval * 1000);
                  function done() {
                    clearTimeout(timer);
                    process.off("SIGINT", done);
                    process.off("SIGTERM", done);
                    resolve();
                  }
                  process.once("SIGINT", done);
                  process.once("SIGTERM", done);
                });
            } while (watch && !options.dryRun && !stopped);
          } finally {
            process.off("SIGINT", stop);
            process.off("SIGTERM", stop);
            await handle.close();
            await unlink(lock);
          }
        },
      );
}
