import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink, link, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";
import { AgfsClient, AgfsError, type Entry, type Inventory } from "@agfs/sdk";
import { registerAutomationCommands } from "../commands/automation";
import { atomicLocal, readLocal, writeLocalJson } from "./automation-io";
import { exportInventory, uploadBundle, type UploadBundle } from "./transfer-jobs";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const temporary = async () => { const root = await mkdtemp(path.join(tmpdir(), "agfs-automation-")); roots.push(root); return root; };
const entry = (pathname: string, etag = "old"): Entry => ({ id: pathname, path: pathname, name: pathname.split("/").at(-1)!, kind: "file", size: 4, etag, contentType: "text/plain", updatedAt: "now" });
const identity = { origin: "https://agfs.dev", account: "test-account", workspace: null };
const inventory = (): Inventory => ({ version: 1, identity, root: "/data", entries: [entry("/data/a"), entry("/data/b")] });
const makeClient = () => {
  const client = new AgfsClient({ token: "fixture", retries: 0, fetch: vi.fn(async () => { throw new Error("Unexpected network"); }) });
  vi.spyOn(client, "whoami").mockResolvedValue({ user: { id: identity.account }, workspaceId: null }); return client;
};

it("#108 interrupted backup resumes only unfinished files after rehashing completed content", async () => {
  const root = await temporary(), client = makeClient();
  const download = vi.spyOn(client, "download").mockImplementation(async remote => { if (remote.endsWith("b")) throw new Error("Interrupted"); return new Response("data"); });
  await expect(exportInventory(client, inventory(), root)).rejects.toThrow("Interrupted");
  expect(await readFile(path.join(root, "a"), "utf8")).toBe("data");
  expect((await readdir(root)).some(name => name.endsWith(".lock"))).toBe(false);
  download.mockClear().mockImplementation(async (_path, etag) => { expect(etag).toBe("old"); return new Response("data"); });
  expect(await exportInventory(client, inventory(), root)).toMatchObject({ downloaded: 1, skipped: 1, files: 2, bytes: 8 });
  expect(download).toHaveBeenCalledTimes(1); expect(download.mock.calls[0][0]).toBe("/data/b");
  await writeFile(path.join(root, "a"), "edit"); download.mockClear();
  await expect(exportInventory(client, inventory(), root)).rejects.toMatchObject({ status: 409 }); expect(download).not.toHaveBeenCalled();
});
it("#108 rejects wrong identity, changed manifest, unknown completion rows and reserved names", async () => {
  const root = await temporary(), client = makeClient(); vi.spyOn(client, "download").mockImplementation(async () => new Response("data"));
  await expect(exportInventory(client, { ...inventory(), identity: { ...identity, workspace: "other" } }, root)).rejects.toThrow("another account");
  await exportInventory(client, inventory(), root);
  await expect(exportInventory(client, { ...inventory(), entries: [entry("/data/new")] }, root)).rejects.toThrow("another manifest");
  const statePath = path.join(root, ".agfs-export.json"), state = JSON.parse(await readFile(statePath, "utf8")); state.completed["/outside"] = state.completed["/data/a"]; await writeFile(statePath, JSON.stringify(state));
  await expect(exportInventory(client, inventory(), root)).rejects.toThrow("does not match manifest");
  await expect(exportInventory(client, { ...inventory(), entries: [entry("/data/.agfs-export.json")] }, root)).rejects.toThrow("reserved");
});
it("#108 declared byte budget fails before requesting any content", async () => {
  const client = makeClient(), download = vi.spyOn(client, "download"), root = await temporary();
  await expect(exportInventory(client, inventory(), root, { maxBytes: 7 })).rejects.toThrow("maxBytes"); expect(download).not.toHaveBeenCalled();
  expect(await readdir(root)).toEqual([]);
});
it("durable automation refuses symlink parents, destinations, state files and traversal", async () => {
  const root = await temporary(), outside = await temporary(); await writeFile(path.join(outside, "victim"), "safe");
  await symlink(outside, path.join(root, "linked"));
  await expect(atomicLocal(path.join(root, "linked/victim"), new Response("evil").body!, 4)).rejects.toThrow();
  await symlink(path.join(outside, "victim"), path.join(root, "victim"));
  await expect(writeLocalJson(path.join(root, "victim"), {})).rejects.toThrow("unsafe destination");
  await expect(readLocal(path.join(root, "victim"))).rejects.toThrow();
  await expect(readLocal(root + "/linked/../victim")).rejects.toThrow("parent traversal");
  expect(await readFile(path.join(outside, "victim"), "utf8")).toBe("safe");
});
it("atomic automation writes preserve hard-link targets and previous content on short/error bodies", async () => {
  const root = await temporary(), target = path.join(root, "target"), original = path.join(root, "original");
  await writeFile(original, "original"); await link(original, target);
  await atomicLocal(target, new Response("data").body!, 4, { expectedSize: 4 });
  expect(await readFile(original, "utf8")).toBe("original"); expect(await readFile(target, "utf8")).toBe("data");
  await expect(atomicLocal(target, new Response("x").body!, 4, { expectedSize: 4 })).rejects.toThrow("size mismatch");
  expect(await readFile(target, "utf8")).toBe("data"); expect((await readdir(root)).filter(name => name.startsWith(".agfs-stage"))).toEqual([]);
});
const bundle: UploadBundle = { version: 1, root: "/data", files: [{ source: "a", path: "/data/a" }, { source: "b", path: "/data/b", ifMatch: "before" }] };
async function bundleFixture() {
  const root = await temporary(); await writeFile(path.join(root, "a"), "data"); await writeFile(path.join(root, "b"), "text");
  const client = makeClient(), remote = new Map<string, Entry>([["/data/b", entry("/data/b", "before")]]);
  const request = vi.spyOn(client, "request").mockImplementation(async url => {
    expect(url).toContain("/fs/list?"); return Response.json({ path: "/data", entries: [...remote.values()] });
  });
  return { root, client, remote, request };
}
it("#120 dry-run hashes all sources with zero authentication/network/filesystem mutations", async () => {
  const { root, client, request } = await bundleFixture();
  expect(await uploadBundle(client, bundle, root, { dryRun: true })).toMatchObject({ dryRun: true, bytes: 8, files: [{ ifMatch: null, size: 4 }, { ifMatch: "before", size: 4 }] });
  expect(client.whoami).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled(); expect(await readdir(root)).toEqual(["a", "b"]);
});
it("#120 resumes only after checking local hashes and remote ETags; preserves explicit conditions", async () => {
  const { root, client, remote, request } = await bundleFixture();
  const upload = vi.spyOn(client, "uploadSource").mockImplementation(async (pathname, source, options) => {
    if (pathname.endsWith("b")) throw new Error("Interrupted");
    expect(options?.ifMatch).toBeNull(); expect(new TextDecoder().decode(await source.read(0, 4))).toBe("data"); await options?.verifySource?.();
    const result = entry(pathname, "completed"); remote.set(pathname, result); return result;
  });
  await expect(uploadBundle(client, bundle, root)).rejects.toThrow("Interrupted");
  upload.mockClear().mockImplementation(async (pathname, _source, options) => { expect(options?.ifMatch).toBe("before"); await options?.verifySource?.(); const result = entry(pathname, "after"); remote.set(pathname, result); return result; });
  expect(await uploadBundle(client, bundle, root)).toMatchObject({ uploaded: 1, skipped: 1 }); expect(upload).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(2); // One explicit parent listing in each invocation.
  remote.set("/data/a", entry("/data/a", "someone-else")); upload.mockClear();
  await expect(uploadBundle(client, bundle, root)).rejects.toBeInstanceOf(AgfsError); expect(upload).not.toHaveBeenCalled();
  await writeFile(path.join(root, "a"), "edit");
  await expect(uploadBundle(client, bundle, root)).rejects.toThrow("another manifest");
});
it("#120 preflights every destination before mutation and refuses changed local sources before commit", async () => {
  const { root, client, remote } = await bundleFixture(); const upload = vi.spyOn(client, "uploadSource"); remote.set("/data/b", entry("/data/b", "changed"));
  await expect(uploadBundle(client, bundle, root)).rejects.toMatchObject({ status: 409 }); expect(upload).not.toHaveBeenCalled();
  remote.set("/data/b", entry("/data/b", "before"));
  upload.mockImplementation(async (_pathname, _source, options) => { await writeFile(path.join(root, "a"), "edit"); await options?.verifySource?.(); return entry("/data/a"); });
  await expect(uploadBundle(client, bundle, root)).rejects.toThrow("source changed"); expect(upload).toHaveBeenCalledTimes(1);
});
it("#120 rejects duplicate destinations, symlink sources and total byte overflow before remote work", async () => {
  const { root, client, request } = await bundleFixture();
  await expect(uploadBundle(client, { ...bundle, files: [bundle.files[0], bundle.files[0]] }, root)).rejects.toThrow("duplicate");
  await expect(uploadBundle(client, bundle, root, { maxBytes: 7 })).rejects.toThrow("byte limit");
  await rm(path.join(root, "a")); await symlink(path.join(root, "b"), path.join(root, "a")); await expect(uploadBundle(client, bundle, root)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled(); expect(client.whoami).not.toHaveBeenCalled();
});
it("automation commands expose help and machine-readable error/budget controls", () => {
  const program = new Command(); registerAutomationCommands(program);
  const help = program.helpInformation();
  for (const name of ["inventory", "export", "bundle", "lines", "records", "text", "json", "changes", "draft", "--json-errors", "--max-requests", "--timeout-ms"]) expect(help).toContain(name);
  expect(program.commands.find(command => command.name() === "bundle")!.commands[0].helpInformation()).toContain("--dry-run");
});
