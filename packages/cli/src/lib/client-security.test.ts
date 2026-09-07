import { afterEach, expect, it, vi } from "vitest";
import { link, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgfsClient } from "./client";
import { writeDownloadFile } from "./safe-download";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("replaces a hard-linked destination without changing the other link", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agfs-download-security-"));
  roots.push(root);
  const victim = path.join(root, "private.txt");
  const destination = path.join(root, "download.txt");
  await writeFile(victim, "private");
  await link(victim, destination);
  await writeDownloadFile(destination, new Response("download").body!, () => {}, 8);
  expect(await readFile(victim, "utf8")).toBe("private");
  expect(await readFile(destination, "utf8")).toBe("download");
});

it("preserves existing data and removes temporary files when a download is truncated", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agfs-download-security-"));
  roots.push(root);
  const destination = path.join(root, "download.txt");
  await writeFile(destination, "original");
  await expect(writeDownloadFile(destination, new Response("short").body!, () => {}, 100)).rejects.toThrow(
    "size mismatch",
  );
  expect(await readFile(destination, "utf8")).toBe("original");
  expect(await readdir(root)).toEqual(["download.txt"]);
});

it("downloads a normal folder tree into real directories", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agfs-download-security-"));
  roots.push(root);
  const client = new AgfsClient("https://agfs.dev", "fixture");
  vi.spyOn(client, "list").mockResolvedValue({ path: "/remote", entries: [] });
  vi.spyOn(client, "tree").mockResolvedValue({
    path: "/remote",
    tree: [{
      id: "dir", path: "/remote/nested", name: "nested", kind: "folder", size: null,
      children: [{ id: "file", path: "/remote/nested/file.txt", name: "file.txt", kind: "file", size: 4 }],
    }],
  });
  vi.spyOn(client, "request").mockResolvedValue(new Response("data", { headers: { "content-length": "4" } }));
  const destination = path.join(root, "download");
  await client.download("/remote", destination);
  expect(await readFile(path.join(destination, "nested", "file.txt"), "utf8")).toBe("data");
});

it("does not compare decoded data against a compressed response's wire size", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agfs-download-security-"));
  roots.push(root);
  const client = new AgfsClient("https://agfs.dev", "fixture");
  vi.spyOn(client, "list").mockRejectedValue(new Error("Not a folder"));
  vi.spyOn(client, "request").mockResolvedValue(new Response("decoded body", {
    headers: { "content-encoding": "gzip", "content-length": "32" },
  }));
  const destination = path.join(root, "file.txt");
  await client.download("/file.txt", destination);
  expect(await readFile(destination, "utf8")).toBe("decoded body");
});

it.each(["file", "directory"])("does not follow an existing %s symlink while downloading", async (kind) => {
  const root = await mkdtemp(path.join(tmpdir(), "agfs-download-security-"));
  roots.push(root);
  await mkdir(path.join(root, "outside"));
  await mkdir(path.join(root, "downloads"));
  const victim = path.join(root, "outside", "victim.txt");
  await writeFile(victim, "keep private file");
  const destination = path.join(root, "downloads", "victim.txt");
  if (kind === "file") await symlink(victim, destination);
  else {
    await symlink(path.join(root, "outside"), path.join(root, "downloads", "linked"));
  }
  const client = new AgfsClient("https://agfs.dev", "fixture");
  vi.spyOn(client, "list").mockRejectedValue(new Error("Not a folder"));
  vi.spyOn(client, "request").mockResolvedValue(new Response("attacker controlled data"));
  const target = kind === "file" ? destination : path.join(root, "downloads", "linked", "victim.txt");
  await expect(client.download("/victim.txt", target)).rejects.toThrow(/symlink/i);
  expect(await readFile(victim, "utf8")).toBe("keep private file");
});
