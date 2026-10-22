import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm, readdir, unlink, symlink, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { setImmediate as tick } from "node:timers/promises";
import { AgfsClient, type Inventory } from "@agfs/sdk";
import { atomicLocal } from "./automation-io";
import { exportInventory, uploadBundle } from "./transfer-jobs";

const control = vi.hoisted(() => ({ raceInstall: false, retention: false, references: [] as WeakRef<object>[], survivors: [] as number[] }));
setFlagsFromString("--expose_gc");
const collectGarbage: () => void = runInNewContext("gc");
vi.mock("@agfs/sdk", async original => {
  const sdk = await original<typeof import("@agfs/sdk")>();
  return { ...sdk, listBounded: async (...args: Parameters<typeof sdk.listBounded>) => {
    if (control.retention && control.references.length) {
      await tick(); collectGarbage();
      control.survivors.push(control.references.filter(ref => ref.deref() !== undefined).length); control.references = [];
    }
    const entries = await sdk.listBounded(...args);
    if (control.retention) control.references = entries.map(entry => new WeakRef(entry));
    return entries;
  } };
});
vi.mock("node:fs/promises", async original => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, link: async (...args: Parameters<typeof fs.link>) => {
    if (control.raceInstall) { control.raceInstall = false; await fs.writeFile(args[1], "foreign", { flag: "wx" }); }
    return fs.link(...args);
  } };
});
const roots: string[] = [];
const temporary = async () => { const root = await mkdtemp("/tmp/agfs-cli-review-"); roots.push(root); return root; };
afterEach(async () => { control.raceInstall = false; control.retention = false; control.references = []; control.survivors = []; vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const entry = (path: string) => ({ id: "entry", path, name: path.split("/").at(-1)!, kind: "file" as const, size: 4, etag: "version", contentType: "text/plain", updatedAt: "now" });
const inventory = (paths = ["/file"]): Inventory => ({ version: 1, identity: { origin: "https://agfs.dev", account: "owner", workspace: null }, root: "/", entries: paths.map(entry) });
const client = () => { const c = new AgfsClient({ token: "fixture", fetch: vi.fn() }); vi.spyOn(c, "whoami").mockResolvedValue({ user: { id: "owner" }, workspaceId: null }); vi.spyOn(c, "download").mockImplementation(async () => new Response("data")); return c; };

it.each(["download", "install"])("export preserves a foreign destination created during %s and does not certify it", async phase => {
  const root = await temporary(), c = client();
  if (phase === "download") vi.mocked(c.download).mockImplementation(async () => { await writeFile(root + "/file", "foreign"); return new Response("data"); });
  else control.raceInstall = true;
  await expect(exportInventory(c, inventory(), root)).rejects.toMatchObject({ status: 409 });
  expect(await readFile(root + "/file", "utf8")).toBe("foreign");
  expect(await readdir(root)).toEqual(["file"]);
  vi.mocked(c.download).mockClear(); await expect(exportInventory(c, inventory(), root)).rejects.toMatchObject({ status: 409 }); expect(c.download).not.toHaveBeenCalled();
});
it("create-only install leaves an uncheckpointed completed export intact on resume", async () => {
  const root = await temporary(), c = client();
  await atomicLocal(root + "/file", new Response("data").body!, 4, { createOnly: true });
  await expect(exportInventory(c, inventory(), root)).rejects.toMatchObject({ status: 409 });
  expect(c.download).not.toHaveBeenCalled(); expect(await readFile(root + "/file", "utf8")).toBe("data");
});
it.each(["regular", "symlink"])("cleanup preserves a detected foreign %s staging replacement", async kind => {
  const root = await temporary(); let stage = ""; await writeFile(root + "/victim", "victim");
  const body = new ReadableStream<Uint8Array>({ async pull(c) {
    stage = root + "/" + (await readdir(root)).find(name => name.startsWith(".agfs-stage-"));
    await unlink(stage + "/content");
    if (kind === "regular") await writeFile(stage + "/content", "foreign"); else await symlink(root + "/victim", stage + "/content");
    c.enqueue(new TextEncoder().encode("data")); c.close();
  } }, { highWaterMark: 0 });
  await expect(atomicLocal(root + "/target", body, 4)).rejects.toThrow("Staging");
  expect((await lstat(stage)).isDirectory()).toBe(true);
  expect(await readFile(stage + "/content", "utf8")).toBe(kind === "regular" ? "foreign" : "victim");
  expect((await lstat(stage + "/content")).isSymbolicLink()).toBe(kind === "symlink");
});
it("bundle never checkpoints a source hash for different completing-session bytes", async () => {
  const root = await temporary(), bytes = new Uint8Array(8388609).fill(65); bytes[8388608] = 78; await writeFile(root + "/source", bytes);
  const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex"); let puts = 0, commits = 0;
  const c = new AgfsClient({ token: "fixture", retries: 0, fetch: async url => {
    const route = String(url);
    if (route.includes("/whoami")) return Response.json({ user: { id: "owner" }, workspaceId: null });
    if (route.includes("/list?")) return Response.json({ path: "/", entries: [] });
    if (route.endsWith("/resumable")) return Response.json({ uploadId: "upl_old", partSize: 8388608, status: "completing", parts: [{ partNumber: 1, digest: sha(bytes.subarray(0, 8388608)) }, { partNumber: 2, digest: sha(new Uint8Array([79])) }] });
    if (route.includes("/parts/")) puts++; else commits++;
    return Response.json({ entry: entry("/file") });
  } });
  const bundle = { version: 1 as const, root: "/", files: [{ source: "source", path: "/file" }] };
  for (let attempt = 0; attempt < 2; attempt++) await expect(uploadBundle(c, bundle, root)).rejects.toMatchObject({ status: 409 });
  expect({ puts, commits }).toEqual({ puts: 0, commits: 0 }); expect(await readdir(root)).toEqual(["source"]);
});
it("export accepts ASCII and Unicode prefix siblings at shallow and nested paths", async () => {
  const root = await temporary(), paths = ["/a", "/ab", "/é", "/éclair", "/日本", "/日本語", "/nested/x", "/nested/xy"];
  expect(await exportInventory(client(), inventory(paths), root)).toMatchObject({ downloaded: paths.length });
  for (const path of paths) expect(await readFile(root + path, "utf8")).toBe("data");
});
it.each([["/a", "/a/b"], ["/deep/parent/file", "/deep/parent/file/child"], ["/日本", "/日本/語"]])("export refuses true file ancestors %j before local mutations", async (ancestor, descendant) => {
  const root = await temporary(), c = client(); await expect(exportInventory(c, inventory([ancestor, descendant]), root)).rejects.toThrow("collision");
  expect(c.download).not.toHaveBeenCalled(); expect(await readdir(root)).toEqual([]);
});
it("bundle releases each 5001-entry listing before the next parent, retaining only selected preflight metadata", async () => {
  const root = await temporary(); await writeFile(root + "/source", "data"); control.retention = true;
  const parents = ["/p0", "/p1", "/p2", "/p3"], listed: string[] = [];
  const c = new AgfsClient({ token: "fixture", fetch: async url => {
    if (String(url).includes("whoami")) return Response.json({ user: { id: "owner" }, workspaceId: null });
    const parent = new URL(String(url)).searchParams.get("path")!; listed.push(parent);
    return Response.json({ path: parent, entries: [entry(parent + "/target"), ...Array.from({ length: 5000 }, (_, i) => entry(parent + "/unrelated-" + i))] });
  } });
  const upload = vi.spyOn(c, "uploadSource").mockImplementation(async path => {
    expect(listed).toEqual(parents); expect(control.survivors).toEqual([0, 0, 0]); return entry(path);
  });
  const result = await uploadBundle(c, { version: 1, root: "/", files: parents.map(parent => ({ source: "source", path: parent + "/target", ifMatch: "version" })) }, root);
  expect(result).toMatchObject({ uploaded: 4 }); expect(upload).toHaveBeenCalledTimes(4); expect(listed).toHaveLength(4);
  expect(control.survivors).toEqual([0, 0, 0]);
});
it("a conflict in the last parent prevents every bundle upload", async () => {
  const root = await temporary(); await writeFile(root + "/source", "data"); const listed: string[] = [];
  const c = new AgfsClient({ token: "fixture", fetch: async url => {
    if (String(url).includes("whoami")) return Response.json({ user: { id: "owner" }, workspaceId: null });
    const parent = new URL(String(url)).searchParams.get("path")!; listed.push(parent);
    return Response.json({ path: parent, entries: parent === "/second" ? [entry("/second/target")] : [] });
  } });
  const upload = vi.spyOn(c, "uploadSource");
  await expect(uploadBundle(c, { version: 1, root: "/", files: ["/first", "/second"].map(parent => ({ source: "source", path: parent + "/target" })) }, root)).rejects.toMatchObject({ status: 409 });
  expect(listed).toEqual(["/first", "/second"]); expect(upload).not.toHaveBeenCalled(); expect(await readdir(root)).toEqual(["source"]);
});
