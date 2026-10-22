import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink, readdir, rename, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";
import { AgfsClient, diagnoseError, type Inventory } from "@agfs/sdk";
import { AgfsClient as CliClient } from "./client";
import { atomicLocal, assertDurablePlatform, readPortableJson } from "./automation-io";
import { exportInventory, uploadBundle } from "./transfer-jobs";
import { registerAutomationCommands } from "../commands/automation";

const control = vi.hoisted(() => ({ probeError: "", collision: false, checkpointFailure: false }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    if (args[0] === "/proc/self/fd" && control.probeError) throw Object.assign(new Error(control.probeError), { code: control.probeError });
    if (control.collision && String(args[0]).endsWith("/content")) { control.collision = false; await actual.writeFile(args[0], "foreign", { flag: "wx" }); }
    return actual.open(...args);
  } };
});
vi.mock("./automation-io", async importOriginal => {
  const actual = await importOriginal<typeof import("./automation-io")>();
  return { ...actual, writeLocalJson: async (...args: Parameters<typeof actual.writeLocalJson>) => {
    if (control.checkpointFailure && args[0].endsWith(".agfs-export.json")) throw new Error("Checkpoint disk failure after rename");
    return actual.writeLocalJson(...args);
  } };
});
const roots: string[] = [];
afterEach(async () => { control.probeError = ""; control.collision = false; control.checkpointFailure = false; vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const temporary = async () => { const root = await mkdtemp(path.join(tmpdir(), "agfs-adversarial-")); roots.push(root); return root; };
const inventory: Inventory = { version: 1, identity: { origin: "https://agfs.dev", account: "owner", workspace: null }, root: "/", entries: [{ id: "file", path: "/file", name: "file", kind: "file", size: 4, etag: "old", contentType: "text/plain", updatedAt: "now" }] };
const client = () => { const c = new AgfsClient({ token: "fixture", fetch: vi.fn() }); vi.spyOn(c, "whoami").mockResolvedValue({ user: { id: "owner" }, workspaceId: null }); vi.spyOn(c, "download").mockImplementation(async () => new Response("data")); return c; };

it("absent descriptor filesystem fails before authentication, requests or output creation", async () => {
  const root = await temporary(), c = client(); control.probeError = "ENOENT";
  const failure = await exportInventory(c, inventory, root).catch(error => error);
  expect(diagnoseError(failure)).toMatchObject({ category: "unsupported_platform", exitCode: 9 }); expect(c.whoami).not.toHaveBeenCalled(); expect(c.download).not.toHaveBeenCalled(); expect(await readdir(root)).toEqual([]);
  await expect(uploadBundle(c, { version: 1, root: "/", files: [{ source: "file", path: "/file" }] }, root)).rejects.toMatchObject({ name: "UnsupportedPlatformError" });
  const config = vi.spyOn(CliClient, "fromConfig"); const program = new Command(); registerAutomationCommands(program);
  await expect(program.parseAsync(["inventory", "capture", "/", "--out", path.join(root, "manifest")], { from: "user" })).rejects.toMatchObject({ name: "UnsupportedPlatformError" }); expect(config).not.toHaveBeenCalled();
});
it("permission denial is preserved and portable offline reads do not require /proc", async () => {
  const root = await temporary(), filename = path.join(root, "inventory.json"); await writeFile(filename, JSON.stringify(inventory)); control.probeError = "EACCES";
  await expect(assertDurablePlatform()).rejects.toMatchObject({ code: "EACCES" }); expect(await readPortableJson(filename)).toEqual(inventory);
});
it("unsupported operating systems reject durable jobs before requests while offline JSON remains readable", async () => {
  const root = await temporary(), filename = path.join(root, "inventory.json"), c = client(); await writeFile(filename, JSON.stringify(inventory));
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  try {
    Object.defineProperty(process, "platform", { ...original, value: "darwin" });
    await expect(exportInventory(c, inventory, root)).rejects.toMatchObject({ name: "UnsupportedPlatformError" }); expect(c.whoami).not.toHaveBeenCalled();
    expect(await readPortableJson(filename)).toEqual(inventory);
  } finally { Object.defineProperty(process, "platform", original); }
});
it("replacing the destination parent cannot redirect an anchored write into a foreign directory", async () => {
  const root = await temporary(), outside = await temporary(), moved = root + "-moved"; roots.push(moved);
  await writeFile(path.join(root, "file"), "old"); await writeFile(path.join(outside, "file"), "foreign");
  const body = new ReadableStream<Uint8Array>({ async pull(c) { await rename(root, moved); await symlink(outside, root); c.enqueue(new TextEncoder().encode("data")); c.close(); } }, { highWaterMark: 0 });
  await atomicLocal(path.join(root, "file"), body, 4, { expectedSize: 4 });
  expect(await readFile(path.join(outside, "file"), "utf8")).toBe("foreign"); expect(await readFile(path.join(moved, "file"), "utf8")).toBe("data");
});
it.each(["content", "directory"])("refuses staging %s substitution and preserves foreign content", async kind => {
  const root = await temporary(), victim = path.join(root, "victim"), target = path.join(root, "target");
  await writeFile(victim, "foreign"); await writeFile(target, "original"); let replacement = "";
  const body = new ReadableStream<Uint8Array>({ async pull(c) {
    const stage = path.join(root, (await readdir(root)).find(name => name.startsWith(".agfs-stage-"))!);
    if (kind === "content") { await unlink(path.join(stage, "content")); await symlink(victim, path.join(stage, "content")); }
    else { await rename(stage, stage + "-moved"); await mkdir(stage); replacement = path.join(stage, "foreign"); await writeFile(replacement, "keep"); }
    c.enqueue(new TextEncoder().encode("data")); c.close();
  } }, { highWaterMark: 0 });
  await expect(atomicLocal(target, body, 4, { expectedSize: 4 })).rejects.toThrow("Staging");
  expect(await readFile(target, "utf8")).toBe("original"); expect(await readFile(victim, "utf8")).toBe("foreign"); if (replacement) expect(await readFile(replacement, "utf8")).toBe("keep");
});
it("an exclusive staging-file collision never deletes the preexisting entry", async () => {
  const root = await temporary(); control.collision = true;
  await expect(atomicLocal(path.join(root, "target"), new Response("data").body!, 4)).rejects.toMatchObject({ code: "EEXIST" });
  const stage = (await readdir(root)).find(name => name.startsWith(".agfs-stage-"))!;
  expect(await readFile(path.join(root, stage, "content"), "utf8")).toBe("foreign");
});
it("a checkpoint failure after rename leaves installed content intact and requires explicit recovery", async () => {
  const root = await temporary(), c = client(); control.checkpointFailure = true;
  await expect(exportInventory(c, inventory, root)).rejects.toThrow("after rename"); expect(await readFile(path.join(root, "file"), "utf8")).toBe("data");
  control.checkpointFailure = false; vi.mocked(c.download).mockClear();
  await expect(exportInventory(c, inventory, root)).rejects.toMatchObject({ status: 409 }); expect(c.download).not.toHaveBeenCalled();
  expect(await readFile(path.join(root, "file"), "utf8")).toBe("data");
});
