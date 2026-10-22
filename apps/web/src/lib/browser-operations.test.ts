import { describe, expect, it, vi } from "vitest";
import {
  appendOperationPage,
  connectOperations,
  createOperationReview,
  metricWindow,
  nullableOperationLimit,
  operationInteger,
  operationQuery,
  selectedOperationIds,
  reviewedReindexRequest,
} from "./browser-operations";
import { createLatestBrowserRead } from "./latest-browser-read";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
const who = { user: { id: "actor-test" }, workspaceId: "workspace-test" };
describe("operations browser transport and state guards", () => {
  it("connects with one identity read; data is loaded only through explicit calls", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(who));
    const client = await connectOperations(undefined, undefined, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/whoami");
    expect(client.namespace).toEqual({
      actor: "actor-test",
      workspace: "workspace-test",
    });
    fetcher.mockResolvedValueOnce(json({ results: [], nextCursor: "next" }));
    const page = await client.request("/operations/index", {
      method: "POST",
      body: { path: "/", state: "failed" },
    });
    expect(page).toEqual({ results: [], nextCursor: "next" });
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({
      "x-agfs-workspace": "workspace-test",
    });
  });
  it.each([
    "/operations/index",
    "/operations/uploads",
    "/operations/retention/references",
  ])(
    "sends long Unicode paths in a cancellable readonly POST for %s",
    async (endpoint) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json(who))
        .mockResolvedValueOnce(json({ results: [], nextCursor: "next" }));
      const client = await connectOperations(undefined, undefined, fetcher);
      const controller = new AbortController();
      const path = "/" + "漢".repeat(4095);
      await client.request(endpoint, {
        method: "POST",
        signal: controller.signal,
        body: { path, cursor: "input-cursor", tokenId: undefined },
      });
      expect(fetcher).toHaveBeenCalledTimes(2); // no mutation identity preflight
      const [url, init] = fetcher.mock.calls[1];
      expect(url).toBe("/api/v1/platform" + endpoint);
      expect(init?.method).toBe("POST");
      expect(init?.signal).toBe(controller.signal);
      expect(JSON.parse(init?.body as string)).toEqual({
        path,
        cursor: "input-cursor",
      });
      expect(init?.headers).toMatchObject({
        "content-type": "application/json",
        "x-agfs-workspace": "workspace-test",
      });
    },
  );
  it("keeps empty filtered pages and their continuation, with bounded retained rows", () => {
    const first = appendOperationPage(null, {
      results: [] as string[],
      nextCursor: "c1",
    });
    const second = appendOperationPage(first, {
      results: ["match"],
      nextCursor: "c2",
    });
    const third = appendOperationPage(second, {
      results: [],
      nextCursor: "c3",
    });
    expect(third).toEqual({ results: ["match"], nextCursor: "c3" });
    expect(() =>
      appendOperationPage(
        { results: Array(500).fill("a"), nextCursor: "x" },
        { results: ["b"], nextCursor: null },
      ),
    ).toThrow("500 rows");
  });
  it("passes abort signals and suppresses stale source completions", async () => {
    const lane = createLatestBrowserRead(),
      success = vi.fn(),
      error = vi.fn(),
      settled = vi.fn();
    let firstSignal!: AbortSignal, resolveFirst!: (value: string) => void;
    const first = lane.run(
      (signal) => {
        firstSignal = signal;
        return new Promise<string>((resolve) => {
          resolveFirst = resolve;
        });
      },
      { success, error, settled },
    );
    await lane.run(async () => "current-page", { success, error, settled });
    resolveFirst("wrong-page");
    await first;
    expect(firstSignal.aborted).toBe(true);
    expect(success.mock.calls).toEqual([["current-page"]]);
    let resolveCancelled!: (value: string) => void;
    const cancelled = lane.run(
      () =>
        new Promise<string>((resolve) => {
          resolveCancelled = resolve;
        }),
      { success, error, settled },
    );
    lane.cancel();
    resolveCancelled("late-preview");
    await cancelled;
    expect(success).toHaveBeenCalledTimes(1);
  });
  it("captures an immutable reviewed scope and consumes it only once", () => {
    const gate = createOperationReview<
        { ids: string[] },
        { dryRun: boolean }
      >(),
      request = { ids: ["up_a"] };
    gate.stage("workspace:filter:selection", request, { dryRun: true });
    request.ids.push("up_b");
    expect(gate.consume("workspace:filter:selection").request.ids).toEqual([
      "up_a",
    ]);
    expect(() => gate.consume("workspace:filter:selection")).toThrow("preview");
    gate.stage("old-filter", { ids: ["up_a"] }, { dryRun: true });
    expect(() => gate.consume("new-filter")).toThrow("no longer current");
    gate.stage("old-workspace", { ids: ["up_a"] }, { dryRun: true });
    gate.clear();
    expect(() => gate.consume("old-workspace")).toThrow("preview");
  });
  it("cannot reinstate a preview after cancellation or a newer scope", async () => {
    const lane = createLatestBrowserRead(),
      gate = createOperationReview<{ path: string }, { dryRun: true }>();
    let resolve!: (value: { dryRun: true }) => void;
    const first = lane.run(
      () =>
        new Promise<{ dryRun: true }>((done) => {
          resolve = done;
        }),
      {
        success: (value) => gate.stage("old", { path: "/old" }, value),
        error: () => {},
        settled: () => {},
      },
    );
    lane.cancel();
    gate.clear();
    gate.stage("new", { path: "/new" }, { dryRun: true });
    resolve({ dryRun: true });
    await first;
    expect(gate.consume("new").request).toEqual({ path: "/new" });
  });
  it("rechecks namespace before mutation and refuses changed account/workspace", async () => {
    const changed = vi.fn(),
      fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json(who))
        .mockResolvedValueOnce(json({ ...who, workspaceId: "other" }));
    const client = await connectOperations(undefined, changed, fetcher);
    await expect(
      client.request("/operations/uploads/abandon", {
        method: "POST",
        body: { ids: ["up_a"], dryRun: false },
        mutation: true,
      }),
    ).rejects.toThrow("workspace changed");
    expect(changed).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      fetcher.mock.calls.every(([path]) => path === "/api/v1/whoami"),
    ).toBe(true);
  });
  it("performs an actual dry run before a separate, pinned mutation and returns partial outcomes", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(who))
      .mockResolvedValueOnce(
        json({
          dryRun: true,
          results: [
            { id: "up_a", status: "would-abandon" },
            { id: "up_b", status: "not-pending" },
          ],
          dailyUploadBudgetRefunded: false,
        }),
      )
      .mockResolvedValueOnce(json(who))
      .mockResolvedValueOnce(
        json({
          dryRun: false,
          results: [{ id: "up_a", status: "changed" }],
          dailyUploadBudgetRefunded: false,
        }),
      );
    const client = await connectOperations(undefined, undefined, fetcher),
      gate = createOperationReview<{ ids: string[] }, unknown>();
    const preview = await client.request<{
      results: { id: string; status: string }[];
    }>("/operations/uploads/abandon", {
      method: "POST",
      body: { ids: ["up_a", "up_b"], dryRun: true },
    });
    gate.stage(
      "same-scope",
      {
        ids: preview.results
          .filter((row) => row.status === "would-abandon")
          .map((row) => row.id),
      },
      preview,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    const request = gate.consume("same-scope").request;
    const result = await client.request("/operations/uploads/abandon", {
      method: "POST",
      body: { ...request, dryRun: false },
      mutation: true,
    });
    expect(result).toMatchObject({
      results: [{ id: "up_a", status: "changed" }],
    });
    expect(JSON.parse(fetcher.mock.calls[3][1]?.body as string)).toEqual({
      ids: ["up_a"],
      dryRun: false,
    });
    expect(fetcher.mock.calls[3][1]?.headers).toMatchObject({
      "x-agfs-workspace": "workspace-test",
    });
  });
  it("surfaces authorization refusal and unreadable responses without inventing success", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(who))
      .mockResolvedValueOnce(json({ error: "Permission denied" }, 403))
      .mockResolvedValueOnce(new Response("offline", { status: 503 }));
    const client = await connectOperations(undefined, undefined, fetcher);
    await expect(client.request("/operations/maintenance")).rejects.toThrow(
      "Access denied",
    );
    await expect(client.request("/operations/maintenance")).rejects.toThrow(
      "unreadable response",
    );
  });
  it("refuses excessive metric windows and distinguishes zero from unlimited", () => {
    expect(metricWindow("168", "60")).toEqual({
      hours: 168,
      bucketMinutes: 60,
    });
    expect(metricWindow("14", "5")).toEqual({ hours: 14, bucketMinutes: 5 });
    expect(() => metricWindow("15", "5")).toThrow("168 buckets");
    expect(() => metricWindow("169", "60")).toThrow("168");
    expect(() => metricWindow("1", "10")).toThrow("5, 15, or 60");
    expect(nullableOperationLimit("", "Budget")).toBeNull();
    expect(nullableOperationLimit("0", "Budget")).toBe(0);
    expect(() => operationInteger("9007199254740992", "Budget")).toThrow();
    expect(() =>
      selectedOperationIds(
        Array.from({ length: 21 }, (_, i) => "id_" + i),
        20,
      ),
    ).toThrow("1–20");
    expect(
      operationQuery("/operations/index", {
        path: "/a b",
        state: "failed",
        cursor: "opaque+/=",
      }),
    ).toBe("/operations/index?path=%2Fa+b&state=failed&cursor=opaque%2B%2F%3D");
  });
});

it("sends the server reindex review token with the original input cursor, never its next cursor", () => {
  const request = {
    path: "/reviewed",
    failedOnly: true,
    cursor: "input-page",
    reviewToken: "opaque-review",
    reviewExpiresAt: 2000,
  };
  expect(reviewedReindexRequest(request, 1000)).toEqual({
    path: "/reviewed",
    failedOnly: true,
    cursor: "input-page",
    reviewToken: "opaque-review",
    dryRun: false,
  });
  expect(() => reviewedReindexRequest(request, 2000)).toThrow("expired");
  expect(() =>
    reviewedReindexRequest({ ...request, reviewToken: "" }, 1000),
  ).toThrow("missing");
  expect(() =>
    reviewedReindexRequest({ ...request, reviewExpiresAt: undefined }, 1000),
  ).toThrow("missing");
});
