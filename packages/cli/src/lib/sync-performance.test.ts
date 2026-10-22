import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgfsClient, Entry } from "@agfs/sdk";
import { compileIgnoredPath, ignoredPath } from "./sync-plan";
import { scanLocalFiles, scanRemoteFiles, discoverTogether, checkpointWriter, hashFile } from "./sync-io";
import { writeDownloadFile } from "./safe-download";
import { synchronize } from "../commands/sync";
import { TransferProgress } from "./progress";

vi.mock("./sync-io", async (original) => {
  const actual = await original<typeof import("./sync-io")>();
  return { ...actual, hashFile: vi.fn(actual.hashFile) };
});
vi.mock("./safe-download", async (original) => {
  const actual = await original<typeof import("./safe-download")>();
  return { ...actual, writeDownloadFile: vi.fn(actual.writeDownloadFile) };
});
let root: string;
beforeEach(async () => { vi.clearAllMocks(); root = await mkdtemp(path.join(tmpdir(), "agfs-client-perf-")); vi.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { force: true, recursive: true }); });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; };
const entry = (name: string, size = 1, kind: "file" | "folder" = "file"): Entry => ({ id: name, name: name.split("/").at(-1)!, path: "/" + name, kind, size, etag: "etag-" + name, contentType: null, updatedAt: "" });
function client(entries: Entry[], download = vi.fn(async () => new Response("x"))) {
  return { changes: vi.fn(async () => ({ checkpoint: 1, changes: [], nextCursor: null })), list: vi.fn(async () => ({ entries })), download, uploadSource: vi.fn(), json: vi.fn() } as unknown as AgfsClient;
}

it("compiles each ignore pattern once for 10,000 paths without changing matches", () => {
  const Original = RegExp; let compilations = 0;
  vi.stubGlobal("RegExp", new Proxy(Original, { construct(target, args) { compilations++; return Reflect.construct(target, args); } }));
  try {
    const matcher = compileIgnoredPath(["*.log", "build/", "reports/**/*.csv"]);
    for (let i = 0; i < 10000; i++) expect(matcher(`nested/${i}.log`)).toBe(true);
    expect(compilations).toBe(3);
  } finally { vi.unstubAllGlobals(); }
  const patterns = ["*.log", "build/", "a?.txt", "literal[1]", "reports/**/*.csv"];
  const matcher = compileIgnoredPath(patterns);
  for (const p of ["a1.txt", "a12.txt", "literal[1]", "build/a", "nested/a.log", ".env", "reports/2026/a.csv", "z.txt"])
    expect(matcher(p)).toBe(ignoredPath(p, patterns));
});

it("hashes local files in a bounded lazy pool, ignoring subtrees and rejecting symlinks", async () => {
  await Promise.all(Array.from({ length: 8 }, (_, i) => writeFile(path.join(root, `${i}.txt`), "x")));
  const gate = deferred(); let active = 0, peak = 0;
  const read = vi.fn(async () => { active++; peak = Math.max(peak, active); await gate.promise; active--; return { hash: hash("x"), size: 1 }; });
  const scanning = scanLocalFiles(root, () => false, 3, undefined, read);
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  gate.resolve(); expect((await scanning).size).toBe(8); expect(peak).toBe(3); expect(read).toHaveBeenCalledTimes(8);
  await mkdir(path.join(root, "ignored")); await symlink(root, path.join(root, "ignored", "link"));
  expect((await scanLocalFiles(root, (p) => p === "ignored", 2)).size).toBe(8);
  await expect(scanLocalFiles(root, () => false, 2)).rejects.toThrow("symlinks");
});

it("starts both discovery lanes immediately and drains after failure", async () => {
  const localGate = deferred(), remoteGate = deferred();
  const localLane = vi.fn(async () => { await localGate.promise; return "local"; });
  const remoteLane = vi.fn(async () => { await remoteGate.promise; return "remote"; });
  const together = discoverTogether(localLane, remoteLane);
  await vi.waitFor(() => {
    expect(localLane).toHaveBeenCalledOnce();
    expect(remoteLane).toHaveBeenCalledOnce();
  });
  localGate.resolve(); remoteGate.resolve();
  expect(await together).toEqual(["local", "remote"]);
  const gate = deferred(); let remoteFinished = false;
  const remote = vi.fn(async () => { await gate.promise; remoteFinished = true; return "remote"; });
  const failure = new Error("local scan failed");
  const result = discoverTogether(async () => { throw failure; }, remote);
  const checked = expect(result).rejects.toBe(failure);
  await vi.waitFor(() => expect(remote).toHaveBeenCalledOnce());
  expect(remoteFinished).toBe(false); gate.resolve(); await checked; expect(remoteFinished).toBe(true);
});

it("lists sibling folders concurrently with exact bounds and validates remote paths", async () => {
  const gate = deferred(); let active = 0, peak = 0;
  const list = vi.fn(async (folder: string) => {
    if (folder === "/") return { entries: [entry("a", 0, "folder"), entry("b", 0, "folder"), entry("c", 0, "folder"), entry("ignored", 0, "folder")] };
    active++; peak = Math.max(peak, active); await gate.promise; active--;
    return { entries: [entry(folder.slice(1) + "/file")] };
  });
  const result = scanRemoteFiles({ list }, "/", (n) => n === "ignored", 2);
  await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(3));
  gate.resolve(); expect((await result).size).toBe(3); expect(peak).toBe(2); expect(list).toHaveBeenCalledTimes(4);
  await expect(scanRemoteFiles({ list: async () => ({ entries: [{ ...entry("x"), path: "/foreign/x" }] }) }, "/", () => false, 2)).rejects.toThrow("Invalid remote entry path");
  await expect(scanRemoteFiles({ list: async () => ({ entries: [entry("x"), entry("x")] }) }, "/", () => false, 2)).rejects.toThrow("Invalid remote entry path");
  if (process.platform !== "win32") expect((await scanRemoteFiles({ list: async () => ({ entries: [entry("a:b"), entry("del\x7f")] }) }, "/", () => false, 2)).size).toBe(2);
});

it("skips content downloads for unequal-size initial comparisons without changing conflicts", async () => {
  await writeFile(path.join(root, "x"), "different size");
  const sdk = client([entry("x", 1)]);
  await expect(synchronize(sdk, root, "/", {}, "test")).rejects.toThrow("conflicts");
  expect(sdk.download).not.toHaveBeenCalled(); expect(writeDownloadFile).not.toHaveBeenCalled();
});

it("compares equal-size initial candidates concurrently and saves one unchanged checkpoint", async () => {
  const names = Array.from({ length: 8 }, (_, i) => String(i));
  await Promise.all(names.map((n) => writeFile(path.join(root, n), "x")));
  const gate = deferred(); let active = 0, peak = 0;
  const download = vi.fn(async () => { active++; peak = Math.max(peak, active); await gate.promise; active--; return new Response("x"); });
  const sdk = client(names.map((n) => entry(n)), download);
  const result = synchronize(sdk, root, "/", { concurrency: "3" }, "test");
  await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(3));
  gate.resolve(); await result; expect(peak).toBe(3); expect(download).toHaveBeenCalledTimes(8);
  expect(hashFile).not.toHaveBeenCalled(); expect(writeDownloadFile).toHaveBeenCalledTimes(1);
  const state = JSON.parse(await readFile(path.join(root, ".agfs-sync.json"), "utf8"));
  expect(Object.keys(state.files)).toHaveLength(8);
  vi.clearAllMocks();
  await synchronize(sdk, root, "/", {}, "test");
  expect(hashFile).not.toHaveBeenCalled(); expect(sdk.list).not.toHaveBeenCalled(); expect(sdk.download).not.toHaveBeenCalled(); expect(writeDownloadFile).toHaveBeenCalledTimes(1);
});

it("coalesces simultaneous checkpoints and awaits updates arriving during a write", async () => {
  const gate = deferred(); let state = 0; const saved: number[] = [];
  const write = vi.fn(async () => { saved.push(state); if (saved.length === 1) await gate.promise; });
  const persist = checkpointWriter(write);
  state = 1; const a = persist(); state = 2; const b = persist();
  await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  state = 3; const c = persist(); gate.resolve(); await Promise.all([a, b, c]);
  expect(saved).toEqual([2, 3]);
  const failure = new Error("write failed");
  await expect(checkpointWriter(async () => { throw failure; })()).rejects.toBe(failure);
});

it("hashes bytes during atomic downloads without rereading the installed destination", async () => {
  const sdk = client([entry("new", 7)], vi.fn(async () => new Response("newdata")));
  await synchronize(sdk, root, "/", {}, "test");
  expect(await readFile(path.join(root, "new"), "utf8")).toBe("newdata");
  expect(hashFile).toHaveBeenCalledTimes(2); // pre-mutation + pre-rename absence guards
  const state = JSON.parse(await readFile(path.join(root, ".agfs-sync.json"), "utf8"));
  expect(state.files.new.local).toBe(hash("newdata"));
});

it("persists an update between the writer's final generation check and promise settlement", async () => {
  let state = 1;
  const writes: number[] = [];
  const persist = checkpointWriter(async () => { writes.push(state); });
  const first = persist();
  let second: Promise<void> | undefined;
  queueMicrotask(() => queueMicrotask(() => { state = 2; second = persist(); }));
  await first;
  await second;
  expect(writes).toEqual([1, 2]);
});

it("retains the local race guard before atomic replacement", async () => {
  const sdk = client([entry("new", 1)], vi.fn(async () => {
    await writeFile(path.join(root, "new"), "user edit"); return new Response("x");
  }));
  await expect(synchronize(sdk, root, "/", {}, "test")).rejects.toThrow("changed during download");
  expect(await readFile(path.join(root, "new"), "utf8")).toBe("user edit");
  await expect(readFile(path.join(root, ".agfs-sync.json"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("does zero clock/render work for non-TTY updates and throttles unknown totals", () => {
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const originalTTY = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
  try {
  Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: false });
  const progress = new TransferProgress("noninteractive", 0);
  const clock = vi.spyOn(Date, "now");
  for (let i = 0; i < 10000; i++) progress.update(i);
  expect(clock).not.toHaveBeenCalled(); progress.complete(); expect(process.stderr.write).toHaveBeenCalledTimes(1);
  Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: true });
  const interactive = new TransferProgress("stream", 0); const render = vi.spyOn(interactive as any, "render");
  clock.mockReturnValue(1000);
  for (let i = 0; i < 10000; i++) interactive.update(i);
  expect(render).toHaveBeenCalledTimes(1); interactive.complete(); expect(render).toHaveBeenCalledTimes(2);
  } finally {
    if (originalTTY) Object.defineProperty(process.stderr, "isTTY", originalTTY);
    else delete (process.stderr as any).isTTY;
  }
});
