import { expect, it, vi } from "vitest";
import type { BudgetTokensResult, BudgetTokenSummary } from "@agfs/contracts";
import {
  budgetEditor,
  readBudgetTokenPage,
  reviewedBudgetUpdates,
  type BudgetEditorState,
} from "./browser-operation-budgets";
import type { OperationsClient } from "./browser-operations";
import { createLatestBrowserRead } from "./latest-browser-read";

const token = (
  id: string,
  values: Partial<BudgetTokenSummary> = {},
): BudgetTokenSummary => ({
  id,
  label: id,
  pathPrefix: "/work",
  paused: false,
  storageLimit: null,
  uploadLimit: 0,
  operationLimit: 20,
  ...values,
});
const empty = (): BudgetEditorState => ({ drafts: [], reviewed: false });
const select = (state: BudgetEditorState, value: BudgetTokenSummary) =>
  budgetEditor(state, { type: "select", token: value, selected: true });

it("loads exactly one metadata page per explicit request and replaces previous rows", async () => {
  const first: BudgetTokensResult = {
    results: [token("tok_a")],
    nextCursor: "next+/=",
  };
  const second: BudgetTokensResult = {
    results: [token("tok_b", { paused: true })],
    nextCursor: null,
  };
  const request = vi
    .fn()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second);
  const client: OperationsClient = {
    namespace: { actor: "owner", workspace: "personal" },
    request,
  };
  const signal = new AbortController().signal;
  let page = await readBudgetTokenPage(client, signal);
  expect(request).toHaveBeenCalledTimes(1);
  page = await readBudgetTokenPage(client, signal, page.nextCursor!);
  expect(page).toEqual(second);
  expect(page.results.map((row) => row.id)).toEqual(["tok_b"]);
  expect(request.mock.calls).toEqual([
    ["/operations/budgets/tokens", { signal }],
    ["/operations/budgets/tokens?cursor=next%2B%2F%3D", { signal }],
  ]);
});

it("retains empty-page cursors and refuses oversized token pages", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ results: [], nextCursor: "continue" })
    .mockResolvedValueOnce({
      results: Array.from({ length: 51 }, (_, i) => token("tok_" + i)),
      nextCursor: null,
    });
  const client: OperationsClient = {
    namespace: { actor: "owner", workspace: "personal" },
    request,
  };
  const signal = new AbortController().signal;
  expect(await readBudgetTokenPage(client, signal)).toEqual({
    results: [],
    nextCursor: "continue",
  });
  await expect(readBudgetTokenPage(client, signal, "continue")).rejects.toThrow(
    "exceeded 50 rows",
  );
});

it("keeps edited drafts across page changes but invalidates reviewed limits", () => {
  let state = select(empty(), token("tok_a"));
  state = budgetEditor(state, {
    type: "edit",
    id: "tok_a",
    values: { storage: "123", operations: "0", paused: true },
  });
  state = budgetEditor(state, { type: "review", reviewed: true });
  expect(reviewedBudgetUpdates(state)[0]).toMatchObject({
    storageLimit: 123,
    operationLimit: 0,
    paused: true,
  });
  const drafts = state.drafts;
  state = budgetEditor(state, { type: "invalidate" });
  expect(state.drafts).toBe(drafts);
  expect(() => reviewedBudgetUpdates(state)).toThrow("again");
  state = select(state, token("tok_b"));
  state = select(state, token("tok_a", { storageLimit: 999, paused: false }));
  expect(state.drafts).toHaveLength(2);
  expect(state.drafts[0]).toMatchObject({
    id: "tok_a",
    storage: "123",
    operations: "0",
    paused: true,
  });
});

it("bounds selection across pages to 20 and removes drafts absent from the current page", () => {
  let state = empty();
  for (let i = 0; i < 25; i++) state = select(state, token("tok_" + i));
  expect(state.drafts).toHaveLength(20);
  state = budgetEditor(state, { type: "review", reviewed: true });
  state = budgetEditor(state, { type: "remove", id: "tok_0" });
  expect(state.reviewed).toBe(false);
  expect(state.drafts.some((row) => row.id === "tok_0")).toBe(false);
  state = select(state, token("tok_24"));
  expect(state.drafts).toHaveLength(20);
  expect(state.drafts[19].id).toBe("tok_24");
});

it("round trips nullable and zero limits without usage data or false active status", () => {
  let state = select(
    empty(),
    token("tok_a", {
      paused: true,
      storageLimit: null,
      uploadLimit: 0,
      operationLimit: 0,
    }),
  );
  expect(state.drafts[0]).toMatchObject({
    storage: "",
    uploads: "0",
    operations: "0",
    paused: true,
  });
  state = budgetEditor(state, { type: "review", reviewed: true });
  expect(reviewedBudgetUpdates(state)).toEqual([
    {
      id: "tok_a",
      paused: true,
      storageLimit: null,
      uploadLimit: 0,
      operationLimit: 0,
    },
  ]);
  state = budgetEditor(state, {
    type: "edit",
    id: "tok_a",
    values: { storage: "0", uploads: "", operations: "" },
  });
  expect(() => reviewedBudgetUpdates(state)).toThrow("Review");
  state = budgetEditor(state, { type: "review", reviewed: true });
  expect(reviewedBudgetUpdates(state)[0]).toMatchObject({
    storageLimit: 0,
    uploadLimit: null,
    operationLimit: null,
  });
});

it("requires another review after selection, removal, refresh, or a failed submit", () => {
  let state = budgetEditor(select(empty(), token("tok_a")), {
    type: "review",
    reviewed: true,
  });
  state = select(state, token("tok_b"));
  expect(() => reviewedBudgetUpdates(state)).toThrow();
  state = budgetEditor(state, { type: "review", reviewed: true });
  state = budgetEditor(state, {
    type: "select",
    token: token("tok_b"),
    selected: false,
  });
  expect(() => reviewedBudgetUpdates(state)).toThrow();
  state = budgetEditor(state, { type: "review", reviewed: true });
  const submitted = reviewedBudgetUpdates(state);
  state = budgetEditor(state, { type: "invalidate" });
  expect(submitted).toHaveLength(1);
  expect(() => reviewedBudgetUpdates(state)).toThrow();
});

it("passes cancellation through and suppresses an old token page after scope reset", async () => {
  let resolve!: (value: BudgetTokensResult) => void;
  const request = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<BudgetTokensResult>((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValueOnce({ results: [token("new_owner")], nextCursor: null });
  const client: OperationsClient = {
    namespace: { actor: "owner", workspace: "personal" },
    request,
  };
  const lane = createLatestBrowserRead(),
    success = vi.fn();
  const handlers = { success, error: vi.fn(), settled: vi.fn() };
  const old = lane.run(
    (signal) => readBudgetTokenPage(client, signal, "old_scope"),
    handlers,
  );
  lane.cancel();
  await lane.run((signal) => readBudgetTokenPage(client, signal), handlers);
  resolve({ results: [token("old_owner")], nextCursor: "old_next" });
  await old;
  expect(request.mock.calls[0][1].signal.aborted).toBe(true);
  expect(success).toHaveBeenCalledExactlyOnceWith({
    results: [token("new_owner")],
    nextCursor: null,
  });
});
