import { afterEach, expect, it, vi } from "vitest";
import { link, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgfsClient } from "./client";
import { writeDownloadFile } from "./safe-download";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("rejects unsafe credential origins and prevents API redirects", async () => {
  for (const base of ["http://example.com", "https://user:pass@agfs.dev", "https://agfs.dev/path", "https://agfs.dev?token=x"])
    expect(() => new AgfsClient(base, "fixture")).toThrow("HTTPS origin");
  const transport = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({}));
  vi.stubGlobal("fetch", transport);
  const client = new AgfsClient("https://agfs.dev", "fixture");
  for (const route of ["//evil.example/api/v1/", "/api/v1/../../admin", "/api/v1/%2e%2e/other", "/api/v1/whoami#fragment"])
    await expect(client.request(route)).rejects.toThrow("Invalid AGFS API path");
  expect(transport).not.toHaveBeenCalled();
  await client.request("/api/v1/whoami", { redirect: "follow" });
  expect(transport.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
});

it.each([
  ["https://www.agfs.dev", "https://agfs.dev"],
  ["http://127.0.0.1:8787", "http://localhost:8787"],
  ["https://agfs.dev", "https://evil.example"],
])("keeps empty-upload capabilities on %s when the API advertises %s", async (base, advertised) => {
  const root = await mkdtemp(path.join(tmpdir(), "agfs-upload-security-"));
  roots.push(root);
  const empty = path.join(root, "empty");
  await writeFile(empty, "");
  const transport = vi.fn(async (url: string, init?: RequestInit) => {
    expect(new URL(url).origin).toBe(base);
    expect(init?.redirect).toBe("error");
    if (url.endsWith("/upload-intents")) return Response.json({
      uploadId: "upl_test", url: `${advertised}/api/v1/fs/uploads/upl_test/blob`, method: "PUT",
      headers: { "X-AGFS-Upload-Token": "fixture-capability" }, objectKey: "fixture", expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    if (url.endsWith("/blob")) {
      expect(new Headers(init?.headers).get("authorization")).toBeNull();
      expect(new Headers(init?.headers).get("X-AGFS-Upload-Token")).toBe("fixture-capability");
      expect(await new Response(init?.body).text()).toBe("");
      return new Response(null, { headers: { etag: "empty" } });
    }
    expect(url).toBe(`${base}/api/v1/fs/uploads/upl_test/commit`);
    return Response.json({ entry: { path: "/empty" } });
  });
  vi.stubGlobal("fetch", transport);
  await expect(new AgfsClient(base, "fixture").upload(empty, "/empty")).resolves.toEqual({ entry: { path: "/empty" } });
  expect(transport).toHaveBeenCalledTimes(3);
});

it("downloads folder files in bounded parallel streams and waits for every file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agfs-download-parallel-"));
  roots.push(root);
  const client = new AgfsClient("https://agfs.dev", "fixture");
  vi.spyOn(client, "list").mockResolvedValue({ path: "/remote", entries: [] });
  vi.spyOn(client, "tree").mockResolvedValue({ path: "/remote", tree: Array.from({ length: 5 }, (_, i) => ({
    id: `file_${i}`, path: `/remote/${i}.txt`, name: `${i}.txt`, kind: "file" as const, size: 4,
  })) });
  const pending = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
  vi.spyOn(client, "request").mockImplementation(async (route) => {
    const name = new URL(route, client.baseUrl).searchParams.get("path")!.split("/").at(-1)!;
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { pending.set(name, controller); } }), { headers: { "content-length": "4" } });
  });
  const downloading = client.download("/remote", root, { concurrency: 2 });
  for (let finished = 0; finished < 5; finished++) {
    await vi.waitFor(() => expect(pending.size).toBe(Math.min(2, 5 - finished)));
    const [name, controller] = [...pending][0];
    pending.delete(name);
    controller.enqueue(new TextEncoder().encode("data"));
    controller.close();
  }
  await downloading;
  for (let i = 0; i < 5; i++) expect(await readFile(path.join(root, `${i}.txt`), "utf8")).toBe("data");
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
