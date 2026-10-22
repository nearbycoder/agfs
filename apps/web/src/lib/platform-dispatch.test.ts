import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ loaded: [] as string[], calls: [] as string[] }));
vi.mock("./batch-rename-api", () => { state.loaded.push("rename"); return { batchRenameApi: async () => { state.calls.push("rename"); return null; } }; });
vi.mock("./recent-files", () => { state.loaded.push("recent"); return { recentFilesApi: async () => { state.calls.push("recent"); return null; } }; });
vi.mock("./library-api", () => { state.loaded.push("favorites"); return { libraryApi: async () => { state.calls.push("favorites"); return null; } }; });
vi.mock("./saved-searches-api", () => { state.loaded.push("saved"); return { savedSearchesApi: async () => { state.calls.push("saved"); return null; } }; });
vi.mock("./file-notes-api", () => { state.loaded.push("notes"); return { fileNotesApi: async () => { state.calls.push("notes"); return null; } }; });
vi.mock("./collections-api", () => { state.loaded.push("collections"); return { collectionsApi: async () => { state.calls.push("collections"); return null; } }; });
vi.mock("./storage-insights-api", () => { state.loaded.push("storage"); return { storageInsightsApi: async () => { state.calls.push("storage"); return null; } }; });
vi.mock("./duplicates-api", () => { state.loaded.push("duplicates"); return { duplicatesApi: async () => { state.calls.push("duplicates"); return null; } }; });
vi.mock("./text-files-api", () => { state.loaded.push("text"); return { textFilesApi: async () => { state.calls.push("text"); return null; } }; });
vi.mock("./templates-api", () => { state.loaded.push("templates"); return { templatesApi: async () => { state.calls.push("templates"); return null; } }; });
vi.mock("./reliability-api", () => { state.loaded.push("reliability"); return { reliabilityApi: async () => { state.calls.push("reliability"); return null; } }; });
import { dispatchPlatformExtension } from "./platform-dispatch";

const request = new Request("https://agfs.dev"), auth = {} as any;
beforeEach(() => { state.calls = []; });
it("#38 imports only the selected handler on a cold request", async () => {
  expect(state.loaded).toEqual([]);
  await dispatchPlatformExtension(request, auth, "/notes");
  expect(state.loaded).toEqual(["notes"]);
  expect(state.calls).toEqual(["notes"]);
});
it.each([
  ["/batch-rename", "rename"], ["/recent-files", "recent"], ["/favorites", "favorites"],
  ["/saved-searches", "saved"], ["/saved-searches/s_1", "saved"], ["/notes", "notes"],
  ["/collections", "collections"], ["/collections/c-1", "collections"], ["/collections/c-1/items", "collections"],
  ["/storage/insights", "storage"], ["/storage/duplicates", "duplicates"], ["/text", "text"],
  ["/templates", "templates"], ["/templates/t_1", "templates"],
  ...["/changes", "/snapshots", "/snapshots/s1", "/snapshots/s1/restore", "/snapshots/s1/manifest", "/snapshots/s1/file",
    "/runs/r1/file", "/health", "/health/thresholds", "/search/reindex", "/tokens/t1/rotate", "/webhooks/w1/rotate",
    "/invites", "/invites/i1", "/ownership", "/ownership/accept", "/review-policy",
    "/drafts/d1/comments", "/drafts/d1/request-changes", "/drafts/d1/resubmit"].map((path) => [path, "reliability"]),
])("dispatches %s to only %s", async (path, handler) => {
  await dispatchPlatformExtension(request, auth, path);
  expect(state.calls).toEqual([handler]);
});
it.each(["/search", "/runs", "/workspaces", "/collections/c1/items/extra", "/templates/", "/notes/", "/unknown"])("leaves %s to the core router without extension work", async (path) => {
  const loaded = [...state.loaded];
  expect(await dispatchPlatformExtension(request, auth, path)).toBeNull();
  expect(state.calls).toEqual([]); expect(state.loaded).toEqual(loaded);
});
