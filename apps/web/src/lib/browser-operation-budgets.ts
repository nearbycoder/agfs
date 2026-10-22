import type { BudgetTokensResult, BudgetTokenSummary } from "@agfs/contracts";
import {
  nullableOperationLimit,
  operationQuery,
  selectedOperationIds,
  type OperationsClient,
} from "./browser-operations";

/** One metadata page only; never accumulates pages or reads usage aggregates. */
export async function readBudgetTokenPage(
  client: OperationsClient,
  signal: AbortSignal,
  cursor?: string,
) {
  const page = await client.request<BudgetTokensResult>(
    operationQuery("/operations/budgets/tokens", { cursor }),
    { signal },
  );
  if (page.results.length > 50)
    throw new Error(
      "The token page exceeded 50 rows. Reload the token list or contact support.",
    );
  return page;
}

export type BudgetDraft = {
  id: string;
  label: string;
  pathPrefix: string;
  paused: boolean;
  storage: string;
  uploads: string;
  operations: string;
};
export type BudgetEditorState = { drafts: BudgetDraft[]; reviewed: boolean };
type DraftValues = Pick<
  BudgetDraft,
  "paused" | "storage" | "uploads" | "operations"
>;
type BudgetEditorAction =
  | { type: "select"; token: BudgetTokenSummary; selected: boolean }
  | { type: "remove"; id: string }
  | { type: "edit"; id: string; values: Partial<DraftValues> }
  | { type: "invalidate" }
  | { type: "review"; reviewed: boolean };
export function budgetEditor(
  state: BudgetEditorState,
  action: BudgetEditorAction,
): BudgetEditorState {
  if (action.type === "review")
    return { ...state, reviewed: action.reviewed && state.drafts.length > 0 };
  if (action.type === "invalidate") return { ...state, reviewed: false };
  if (action.type === "remove")
    return {
      drafts: state.drafts.filter((row) => row.id !== action.id),
      reviewed: false,
    };
  if (action.type === "edit")
    return {
      drafts: state.drafts.map((row) =>
        row.id === action.id ? { ...row, ...action.values } : row,
      ),
      reviewed: false,
    };
  const token = action.token;
  if (!action.selected)
    return {
      drafts: state.drafts.filter((row) => row.id !== token.id),
      reviewed: false,
    };
  if (
    state.drafts.length >= 20 ||
    state.drafts.some((row) => row.id === token.id)
  )
    return { ...state, reviewed: false };
  return {
    reviewed: false,
    drafts: [
      ...state.drafts,
      {
        id: token.id,
        label: token.label,
        pathPrefix: token.pathPrefix,
        paused: token.paused,
        storage: token.storageLimit === null ? "" : String(token.storageLimit),
        uploads: token.uploadLimit === null ? "" : String(token.uploadLimit),
        operations:
          token.operationLimit === null ? "" : String(token.operationLimit),
      },
    ],
  };
}
export function reviewedBudgetUpdates(state: BudgetEditorState) {
  if (!state.reviewed)
    throw new Error(
      "Review the selected budget changes again after editing or loading a token page.",
    );
  selectedOperationIds(
    state.drafts.map((row) => row.id),
    20,
  );
  return state.drafts.map((row) => ({
    id: row.id,
    paused: row.paused,
    storageLimit: nullableOperationLimit(row.storage, "Storage limit"),
    uploadLimit: nullableOperationLimit(row.uploads, "Upload limit"),
    operationLimit: nullableOperationLimit(row.operations, "Operation limit"),
  }));
}
