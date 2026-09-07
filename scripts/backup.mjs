#!/usr/bin/env node
import { mkdir, open, readFile, lstat } from "node:fs/promises";
import { createReadStream, constants } from "node:fs";
import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { AgfsClient } from "../packages/sdk/dist/index.js";
const [command, directory, scope = "/"] = process.argv.slice(2);
if (!["export", "verify", "restore"].includes(command) || !directory)
  throw new Error(
    "Usage: node scripts/backup.mjs export|verify|restore DIRECTORY [REMOTE_FOLDER]",
  );
const root = path.resolve(directory);
await mkdir(root, { recursive: true, mode: 0o700 });
const stat = await lstat(root);
if (!stat.isDirectory() || stat.isSymbolicLink())
  throw new Error("Backup directory must be a real directory");
function localFile(hash) {
  if (!/^[a-f0-9]{64}$/.test(hash))
    throw new Error("Invalid backup object name");
  return path.join(root, hash + ".blob");
}
async function hashFile(file) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await handle.stat();
    if (!s.isFile()) throw new Error("Not a regular backup file");
    const hash = createHash("sha256");
    for await (const bytes of handle.createReadStream({ autoClose: false }))
      hash.update(bytes);
    return { sha256: hash.digest("hex"), size: s.size };
  } finally {
    await handle.close();
  }
}
const client =
  command === "verify"
    ? null
    : new AgfsClient({
        baseUrl: process.env.AGFS_BASE_URL ?? "https://agfs.dev",
        token: process.env.AGFS_TOKEN ?? "",
        workspace: process.env.AGFS_WORKSPACE,
      });
if (command !== "verify" && !process.env.AGFS_TOKEN)
  throw new Error("Set AGFS_TOKEN to a management token");
if (command === "export") {
  const snap = await client.json("/platform/snapshots", "POST", {
    name: "Portable backup " + new Date().toISOString(),
    path: scope,
    days: 1,
  });
  const manifest = {
    version: 1,
    scope,
    snapshotId: snap.id,
    createdAt: new Date().toISOString(),
    entries: [],
  };
  let cursor;
  do {
    const page = await client.json(
      "/platform/snapshots/" +
        snap.id +
        "/manifest" +
        (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
    );
    for (const entry of page.entries) {
      const { r2_key, token_id, ...metadata } = entry;
      if (entry.kind === "file") {
        const hashName = createHash("sha256").update(entry.path).digest("hex"),
          file = localFile(hashName),
          handle = await open(file, "wx", 0o600),
          hash = createHash("sha256");
        let size = 0;
        try {
          const response = await client.request(
            "/api/v1/platform/snapshots/" +
              snap.id +
              "/file?path=" +
              encodeURIComponent(entry.path),
          );
          if (!response.body) throw new Error("Missing backup stream");
          for await (const chunk of Readable.fromWeb(response.body)) {
            hash.update(chunk);
            size += chunk.length;
            await handle.writeFile(chunk);
          }
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (size !== entry.size) throw new Error("Backup size mismatch");
        metadata.blob = hashName;
        metadata.sha256 = hash.digest("hex");
      }
      manifest.entries.push(metadata);
    }
    cursor = page.nextCursor;
  } while (cursor);
  const file = await open(path.join(root, "manifest.json"), "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(manifest, null, 2));
  } finally {
    await file.close();
  }
  console.log(
    `Exported ${manifest.entries.length} entries from a consistent snapshot. Run verify before restore.`,
  );
} else {
  const file = await open(
    path.join(root, "manifest.json"),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  let manifest;
  try {
    manifest = JSON.parse(await file.readFile("utf8"));
  } finally {
    await file.close();
  }
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.entries) ||
    typeof manifest.scope !== "string" ||
    !manifest.scope.startsWith("/")
  )
    throw new Error("Invalid backup manifest");
  const seen = new Set();
  for (const e of manifest.entries) {
    if (
      typeof e.path !== "string" ||
      !e.path.startsWith("/") ||
      e.path.split("/").some((p) => p === "." || p === "..") ||
      /[\\\x00-\x1f]/.test(e.path) ||
      !(
        e.path === manifest.scope ||
        e.path.startsWith(manifest.scope === "/" ? "/" : manifest.scope + "/")
      ) ||
      !["file", "folder"].includes(e.kind) ||
      seen.has(e.path)
    )
      throw new Error("Unsafe backup path");
    seen.add(e.path);
    if (e.kind === "file") {
      const actual = await hashFile(localFile(e.blob));
      if (actual.sha256 !== e.sha256 || actual.size !== e.size)
        throw new Error("Checksum mismatch: " + e.path);
    }
  }
  console.log("Verified all backup sizes and SHA-256 checksums.");
  if (command === "restore") {
    if (
      !scope.startsWith("/") ||
      scope.split("/").includes("..") ||
      scope === "/"
    )
      throw new Error("Restore into a dedicated non-root folder");
    await client.mkdir(scope);
    if ((await client.list(scope)).entries.length)
      throw new Error("Restore destination must be empty");
    for (const e of manifest.entries.sort(
      (a, b) => a.path.length - b.path.length,
    )) {
      const relative = e.path
          .slice(manifest.scope === "/" ? 1 : manifest.scope.length)
          .replace(/^\//, ""),
        target = scope.replace(/\/$/, "") + (relative ? "/" + relative : "");
      if (e.kind === "folder") {
        if (relative) await client.mkdir(target);
        continue;
      }
      const handle = await open(
        localFile(e.blob),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        await client.uploadSource(
          target,
          {
            size: e.size,
            read: async (start, end) => {
              const bytes = new Uint8Array(end - start);
              const r = await handle.read(bytes, 0, bytes.length, start);
              return bytes.subarray(0, r.bytesRead);
            },
          },
          {
            ifMatch: null,
            contentType: e.content_type ?? "application/octet-stream",
          },
        );
      } finally {
        await handle.close();
      }
      const response = await client.download(target),
        hash = createHash("sha256");
      for await (const bytes of Readable.fromWeb(response.body))
        hash.update(bytes);
      if (hash.digest("hex") !== e.sha256)
        throw new Error("Restored checksum mismatch: " + target);
    }
    console.log(
      "Restore complete; every restored file was downloaded and checksum-verified.",
    );
  }
}
