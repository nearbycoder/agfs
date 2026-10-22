import { expect, it, vi } from "vitest";
import {
  uploadFolderItems,
  type FolderTransferItem,
} from "./browser-folder-transfer";

function item(path: string, text = "abc"): FolderTransferItem {
  return {
    path,
    file: new File([text], path.slice(1)),
    status: "queued",
    bytes: 0,
  };
}
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

it("#34 transfers nonempty and empty files with create-only requests, skips done files", async () => {
  const updates = new Map<string, Partial<FolderTransferItem>>();
  const paths: string[] = [],
    headers: RequestInit[] = [];
  const controller = new AbortController();
  const request: typeof fetch = async (input, init) => {
    const path = String(input);
    headers.push(init!);
    if (path.endsWith("/resumable") || path.endsWith("/upload-intents")) {
      const body = JSON.parse(init!.body as string);
      paths.push(body.path);
      expect(body.ifMatch).toBeNull();
      return Response.json(
        path.endsWith("/resumable")
          ? {
              uploadId: "nonempty",
              partSize: 8 * 1024 * 1024,
              parts: [],
              status: "uploading",
            }
          : {
              uploadId: "empty",
              headers: { "X-AGFS-Upload-Token": "test-token" },
            },
      );
    }
    if (init?.method === "PUT")
      return new Response("", { headers: { etag: "checksum" } });
    return Response.json({ entry: { etag: "checksum" } });
  };
  await uploadFolderItems(
    [item("/file"), item("/empty", ""), { ...item("/done"), status: "done" }],
    {
      signal: controller.signal,
      shouldStop: () => false,
      pause: vi.fn(),
      request,
      update: (path, patch) =>
        updates.set(path, { ...updates.get(path), ...patch }),
    },
  );
  expect(paths.sort()).toEqual(["/empty", "/file"]);
  expect(headers.every((init) => init.signal === controller.signal)).toBe(true);
  expect(updates.get("/file")).toMatchObject({ status: "done", bytes: 3 });
  expect(updates.get("/empty")).toMatchObject({ status: "done", bytes: 0 });
});

it.each([401, 403, 429, 507])(
  "#34 stops new files on HTTP %s while draining the initial three",
  async (status) => {
    let paused = false;
    const started: string[] = [],
      updates = new Map<string, Partial<FolderTransferItem>>();
    const pause = vi.fn(() => {
      paused = true;
    });
    await uploadFolderItems(
      Array.from({ length: 8 }, (_, i) => item("/" + i)),
      {
        signal: new AbortController().signal,
        shouldStop: () => paused,
        pause,
        request: async (_input, init) => {
          started.push(JSON.parse(init!.body as string).path);
          return Response.json({ error: "blocked" }, { status });
        },
        update: (path, patch) =>
          updates.set(path, { ...updates.get(path), ...patch }),
      },
    );
    expect(started).toEqual(["/0", "/1", "/2"]);
    expect(pause).toHaveBeenCalledTimes(3);
    expect([...updates.values()].every((v) => v.status === "failed")).toBe(
      true,
    );
  },
);

it("#34 aborts after a pending local read and never hashes/sends the obsolete file", async () => {
  let resolve!: (value: ArrayBuffer) => void;
  const pending = new Promise<ArrayBuffer>((yes) => {
    resolve = yes;
  });
  const file = item("/a");
  vi.spyOn(file.file, "slice").mockReturnValue({
    arrayBuffer: () => pending,
  } as Blob);
  const controller = new AbortController();
  const request = vi.fn(async () =>
    Response.json({
      uploadId: "a",
      partSize: 8 * 1024 * 1024,
      parts: [],
      status: "uploading",
    }),
  );
  const promise = uploadFolderItems([file], {
    signal: controller.signal,
    shouldStop: () => false,
    pause: vi.fn(),
    update: vi.fn(),
    request,
  });
  const rejected = expect(promise).rejects.toMatchObject({
    name: "AbortError",
  });
  await tick();
  controller.abort();
  resolve(new ArrayBuffer(3));
  await rejected;
  expect(request).toHaveBeenCalledTimes(1);
});
