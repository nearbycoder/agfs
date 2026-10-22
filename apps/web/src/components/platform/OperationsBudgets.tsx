import { useReducer, useState } from "react";
import type {
  BudgetHistoryResult,
  BudgetPreflightResult,
  BudgetBatchResult,
  BudgetTokensResult,
  BudgetTokenSummary,
} from "@agfs/contracts";
import { Button } from "~/components/ui/button";
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { Field } from "./shared";
import { formatBytes } from "~/lib/format";
import {
  operationInteger,
  operationQuery,
  type OperationsClient,
} from "~/lib/browser-operations";
import {
  budgetEditor,
  readBudgetTokenPage,
  reviewedBudgetUpdates,
  type BudgetDraft,
} from "~/lib/browser-operation-budgets";
import {
  OperationFeedback,
  OperationTable,
  useOperation,
} from "./OperationsShared";

export function OperationsBudgets({ client }: { client: OperationsClient }) {
  return (
    <BudgetControls key={JSON.stringify(client.namespace)} client={client} />
  );
}
export function BudgetTokenPage({
  page,
  selected,
  busy,
  choose,
  select,
  next,
}: {
  page: BudgetTokensResult;
  selected: string[];
  busy: boolean;
  choose: (id: string) => void;
  select: (token: BudgetTokenSummary, checked: boolean) => void;
  next: () => void;
}) {
  return (
    <div className="space-y-3">
      <p role="status" className="text-sm text-muted-foreground">
        {page.results.length} tokens on this page · {selected.length}/20
        selected for batch editing across pages.
      </p>
      {page.results.length ? (
        <OperationTable
          label="Agent token budgets"
          rows={page.results}
          rowKey={(row) => row.id}
          disabled={busy}
          selected={selected}
          onSelect={(id, checked) => {
            const token = page.results.find((row) => row.id === id);
            if (token) select(token, checked);
          }}
          columns={[
            {
              label: "Agent / path",
              render: (row) => (
                <>
                  {row.label}
                  <br />
                  <span className="text-muted-foreground">
                    {row.pathPrefix}
                  </span>
                </>
              ),
            },
            {
              label: "Budget state",
              render: (row) =>
                row.paused ? "Budget paused" : "Budget enabled",
            },
            {
              label: "Limits",
              render: (row) => (
                <>
                  Storage:{" "}
                  {formatBytes(row.storageLimit, { nullLabel: "Unlimited" })}
                  <br />
                  Daily uploads:{" "}
                  {formatBytes(row.uploadLimit, { nullLabel: "Unlimited" })}
                  <br />
                  Daily operations: {row.operationLimit ?? "Unlimited"}
                </>
              ),
            },
            {
              label: "History & planning",
              render: (row) => (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  aria-label={`Use ${row.label} (${row.id}) for history and planning`}
                  onClick={() => choose(row.id)}
                >
                  Use token
                </Button>
              ),
            },
          ]}
        />
      ) : (
        <p
          role="status"
          className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
        >
          No non-revoked agent tokens in this page.{" "}
          {page.nextCursor
            ? "A next page is available."
            : "Reload to check for new tokens."}
        </p>
      )}
      {page.nextCursor ? (
        <Button variant="outline" disabled={busy} onClick={next}>
          Load next token page
        </Button>
      ) : null}
    </div>
  );
}
function BudgetControls({ client }: { client: OperationsClient }) {
  const listing = useOperation<BudgetTokensResult>(),
    history = useOperation<BudgetHistoryResult>(),
    preflight = useOperation<BudgetPreflightResult>(),
    batch = useOperation<BudgetBatchResult>();
  const [tokenId, setToken] = useState(""),
    [days, setDays] = useState("30"),
    [operations, setOperations] = useState("1"),
    [uploads, setUploads] = useState("0"),
    [storage, setStorage] = useState("0"),
    [pageCursor, setPageCursor] = useState<string | undefined>();
  const [editor, edit] = useReducer(budgetEditor, {
    drafts: [],
    reviewed: false,
  });
  const { drafts, reviewed } = editor;
  const busy = listing.busy || history.busy || preflight.busy || batch.busy;
  function selectToken(value: string) {
    setToken(value);
    history.clear();
    preflight.clear();
  }
  function editDraft(
    id: string,
    values: Partial<
      Pick<BudgetDraft, "paused" | "storage" | "uploads" | "operations">
    >,
  ) {
    edit({ type: "edit", id, values });
    batch.clear();
  }
  function loadTokens(cursor?: string) {
    edit({ type: "invalidate" });
    batch.clear();
    listing.clear();
    setPageCursor(cursor);
    return listing.read((signal) =>
      readBudgetTokenPage(client, signal, cursor),
    );
  }
  return (
    <div className="space-y-5">
      <p className="section-copy">
        Inspect UTC usage history, estimate agent-budget headroom, or edit up to
        20 budgets together. Blank limits mean unlimited; zero means no
        allowance. The preflight is advisory and does not reserve capacity.
      </p>
      <p className="text-xs text-muted-foreground">
        Enter a known token ID below without loading a list, or load one
        metadata page of up to 50 non-revoked tokens. Expired tokens can appear
        for management and history; budget state is not credential validity.
        Select checkboxes for batch editing, or use a token for history and
        planning.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void loadTokens()}
        >
          Load first token page
        </Button>
        {pageCursor ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void loadTokens(pageCursor)}
          >
            Reload current token page
          </Button>
        ) : null}
      </div>
      <OperationFeedback action={listing} />
      {listing.value ? (
        <BudgetTokenPage
          page={listing.value}
          selected={drafts.map((row) => row.id)}
          busy={busy}
          choose={selectToken}
          select={(token, selected) => {
            edit({ type: "select", token, selected });
            batch.clear();
          }}
          next={() => {
            if (listing.value?.nextCursor)
              void loadTokens(listing.value.nextCursor);
          }}
        />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Agent token ID"
          value={tokenId}
          maxLength={128}
          disabled={busy}
          placeholder="tok_…"
          onChange={(event) => selectToken(event.target.value)}
        />
      </div>
      <Disclosure lazy>
        <DisclosureSummary>Daily usage history</DisclosureSummary>
        <section className="space-y-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void history.read((signal) =>
                client.request(
                  operationQuery("/operations/budgets/history", {
                    tokenId,
                    days: operationInteger(days, "History days", 1, 90),
                  }),
                  { signal },
                ),
              );
            }}
          >
            <Field
              label="History days (UTC)"
              type="number"
              min={1}
              max={90}
              required
              value={days}
              disabled={busy}
              onChange={(event) => {
                setDays(event.target.value);
                history.clear();
              }}
            />
            <Button disabled={busy || !tokenId}>Load usage history</Button>
          </form>
          <OperationFeedback action={history} />
          {history.value ? (
            <>
              <p role="status" className="text-sm">
                {history.value.token.label} · {history.value.from} through{" "}
                {history.value.through} UTC · {history.value.retentionDays}-day
                retention
              </p>
              <OperationTable
                label="Budget history"
                rows={history.value.results}
                rowKey={(row) => row.day}
                columns={[
                  { label: "Day (UTC)", render: (row) => row.day },
                  { label: "Operations", render: (row) => row.operations },
                  {
                    label: "Uploaded / reserved bytes",
                    render: (row) => formatBytes(row.uploadBytes),
                  },
                ]}
              />
            </>
          ) : null}
        </section>
      </Disclosure>
      <Disclosure lazy>
        <DisclosureSummary>
          Check planned work against a budget
        </DisclosureSummary>
        <section className="space-y-4">
          <form
            className="grid gap-3 sm:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              void preflight.read((signal) =>
                client.request("/operations/budgets/preflight", {
                  method: "POST",
                  signal,
                  body: {
                    tokenId,
                    operations: operationInteger(
                      operations,
                      "Planned operations",
                    ),
                    uploadBytes: operationInteger(
                      uploads,
                      "Planned upload bytes",
                    ),
                    storageBytes: operationInteger(
                      storage,
                      "Planned storage bytes",
                    ),
                  },
                }),
              );
            }}
          >
            <Field
              label="Planned operations"
              type="number"
              min={0}
              required
              value={operations}
              disabled={busy}
              onChange={(event) => {
                setOperations(event.target.value);
                preflight.clear();
              }}
            />
            <Field
              label="Planned upload bytes"
              type="number"
              min={0}
              required
              value={uploads}
              disabled={busy}
              onChange={(event) => {
                setUploads(event.target.value);
                preflight.clear();
              }}
            />
            <Field
              label="Planned added storage bytes"
              type="number"
              min={0}
              required
              value={storage}
              disabled={busy}
              onChange={(event) => {
                setStorage(event.target.value);
                preflight.clear();
              }}
            />
            <Button disabled={busy || !tokenId}>Check advisory budget</Button>
          </form>
          <OperationFeedback action={preflight} />
          {preflight.value ? (
            <div className="space-y-3 rounded-xl border p-4">
              <h3 className="font-semibold">
                {preflight.value.allowedByAgentBudget
                  ? "Within the current agent budget"
                  : "Agent budget blocks this plan"}
              </h3>
              <p className="section-copy">
                Advisory only; no reservation or guaranteed execution.{" "}
                {preflight.value.constraints}
              </p>
              {preflight.value.blockers.length ? (
                <ul className="list-inside list-disc text-sm">
                  {preflight.value.blockers.map((blocker, i) => (
                    <li key={i}>{blocker}</li>
                  ))}
                </ul>
              ) : null}
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt>Operations remaining</dt>
                  <dd>{preflight.value.remaining.operations ?? "Unlimited"}</dd>
                </div>
                <div>
                  <dt>Upload allowance remaining</dt>
                  <dd>
                    {formatBytes(preflight.value.remaining.uploadBytes, {
                      nullLabel: "Unlimited",
                    })}
                  </dd>
                </div>
                <div>
                  <dt>Storage allowance remaining</dt>
                  <dd>
                    {formatBytes(preflight.value.remaining.storageBytes, {
                      nullLabel: "Unlimited",
                    })}
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                Used: {preflight.value.used.operations} operations ·{" "}
                {formatBytes(preflight.value.used.uploadBytes)} uploads ·{" "}
                {formatBytes(preflight.value.used.storageBytes)} storage ·{" "}
                {formatBytes(preflight.value.used.reservedBytes)} reserved.
                Daily reset: {preflight.value.resetsAt}.
              </p>
            </div>
          ) : null}
        </section>
      </Disclosure>
      <Disclosure lazy>
        <DisclosureSummary>Edit several agent budgets</DisclosureSummary>
        <section className="space-y-4">
          <p className="section-copy">
            Select up to 20 tokens from the pages above, review each limit, then
            save the batch. Drafts keep your selected limits and edits across
            pages. To replace a draft with freshly loaded limits, remove it and
            select that token again. Loading any page requires a new review.
            Blank is unlimited and 0 is zero. Pausing does not remove existing
            files.
          </p>
          {!drafts.length ? (
            <p className="text-sm text-muted-foreground">
              Load a token page above and select budgets to edit.
            </p>
          ) : null}
          {drafts.length ? (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void batch.write(() => {
                  const updates = reviewedBudgetUpdates(editor);
                  edit({ type: "invalidate" });
                  return client.request("/operations/budgets/batch", {
                    method: "PUT",
                    body: { updates },
                    mutation: true,
                  });
                });
              }}
            >
              {drafts.map((row) => (
                <fieldset
                  key={row.id}
                  className="grid gap-3 rounded-xl border p-4 sm:grid-cols-3"
                  disabled={busy}
                >
                  <legend className="px-2 font-medium">{row.label}</legend>
                  <p className="break-words text-xs text-muted-foreground sm:col-span-3">
                    {row.id} · {row.pathPrefix}
                  </p>
                  <Field
                    label={row.label + " storage limit (bytes)"}
                    type="number"
                    min={0}
                    placeholder="Unlimited"
                    value={row.storage}
                    onChange={(event) =>
                      editDraft(row.id, { storage: event.target.value })
                    }
                  />
                  <Field
                    label={row.label + " daily upload limit (bytes)"}
                    type="number"
                    min={0}
                    placeholder="Unlimited"
                    value={row.uploads}
                    onChange={(event) =>
                      editDraft(row.id, { uploads: event.target.value })
                    }
                  />
                  <Field
                    label={row.label + " daily operation limit"}
                    type="number"
                    min={0}
                    placeholder="Unlimited"
                    value={row.operations}
                    onChange={(event) =>
                      editDraft(row.id, { operations: event.target.value })
                    }
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={row.paused}
                      onChange={(event) =>
                        editDraft(row.id, { paused: event.target.checked })
                      }
                    />
                    Pause {row.label}
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Remove ${row.label} from batch`}
                    onClick={() => {
                      edit({ type: "remove", id: row.id });
                      batch.clear();
                    }}
                  >
                    Remove from batch
                  </Button>
                </fieldset>
              ))}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={busy}
                  onChange={(event) =>
                    edit({ type: "review", reviewed: event.target.checked })
                  }
                />
                I reviewed these {drafts.length} budget changes, including
                unlimited and zero limits.
              </label>
              <Button disabled={busy || !reviewed}>
                Save reviewed budget batch
              </Button>
            </form>
          ) : null}
          <OperationFeedback action={batch} />
          {batch.value ? (
            <p role="status">
              Server updated {batch.value.updated.length} budgets:{" "}
              {batch.value.updated.join(", ")}. Reload the token page to inspect
              the saved values; retained drafts remain your local edits.
            </p>
          ) : null}
        </section>
      </Disclosure>
    </div>
  );
}
