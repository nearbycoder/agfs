import { useEffect, useState } from "react";
import type {
  IndexingPolicyResult,
  IndexDiagnosticsResult,
  IndexDiagnostic,
  ReindexPlanResult,
  QueueFailure,
  FailureRetryResult,
} from "@agfs/contracts";
import { Button } from "~/components/ui/button";
import { Select, SelectItem } from "~/components/ui/select";
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { Field } from "./shared";
import { formatBytes } from "~/lib/format";
import {
  operationInteger,
  operationQuery,
  operationTime,
  selectedOperationIds,
  type OperationsClient,
  reviewedReindexRequest,
  type ReindexReviewRequest,
} from "~/lib/browser-operations";
import {
  MoreOperations,
  OperationFeedback,
  OperationTable,
  toggleOperationSelection,
  useOperation,
  useOperationPage,
  useReviewedOperation,
} from "./OperationsShared";

function SearchPolicy({ client }: { client: OperationsClient }) {
  const action = useOperation<IndexingPolicyResult>(),
    [mode, setMode] = useState("content"),
    [bytes, setBytes] = useState("1048576");
  const setPolicy = (value: IndexingPolicyResult) => {
    setMode(value.mode);
    setBytes(String(value.maxTextBytes));
  };
  return (
    <section className="space-y-4">
      <p className="section-copy">
        Metadata mode skips content indexing. Content mode reads eligible text
        only up to the selected size. A policy change requires an explicit
        reindex to update existing documents.
      </p>
      <Button
        variant="outline"
        disabled={action.busy}
        onClick={() =>
          void action.read(
            (signal) => client.request("/operations/search-policy", { signal }),
            setPolicy,
          )
        }
      >
        Load search policy
      </Button>
      {action.value ? (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void action.write(
              () =>
                client.request("/operations/search-policy", {
                  method: "PUT",
                  body: {
                    mode,
                    maxTextBytes: operationInteger(
                      bytes,
                      "Maximum text bytes",
                      0,
                      1048576,
                    ),
                  },
                  mutation: true,
                }),
              setPolicy,
            );
          }}
        >
          <label className="grid gap-2 text-sm">
            Index content
            <Select
              aria-label="Index content"
              value={mode}
              disabled={action.busy}
              onValueChange={setMode}
            >
              <SelectItem value="content">
                Eligible text and metadata
              </SelectItem>
              <SelectItem value="metadata">Metadata only</SelectItem>
            </Select>
          </label>
          <Field
            label="Maximum text bytes"
            type="number"
            min={0}
            max={1048576}
            required
            value={bytes}
            disabled={action.busy}
            onChange={(event) => setBytes(event.target.value)}
          />
          <p className="text-xs text-muted-foreground sm:col-span-2">
            Revision {action.value.revision} ·{" "}
            {formatBytes(action.value.maxTextBytes)} maximum. Zero is a
            deliberate zero-byte threshold.
          </p>
          <Button disabled={action.busy}>Save search policy</Button>
          {action.value.reindexRequired ? (
            <p role="status" className="text-sm">
              Policy saved. Preview a scoped reindex below to update existing
              content.
            </p>
          ) : null}
        </form>
      ) : null}
      <OperationFeedback action={action} />
    </section>
  );
}
function IndexDiagnostics({ client }: { client: OperationsClient }) {
  const page = useOperationPage<IndexDiagnostic, IndexDiagnosticsResult>(),
    [path, setPath] = useState("/"),
    [state, setState] = useState("all");
  const load = (more = false) =>
    page.load(
      (signal) =>
        client.request("/operations/index", {
          method: "POST",
          body: {
            path,
            state,
            cursor: more ? (page.page?.nextCursor ?? undefined) : undefined,
          },
          signal,
        }),
      more,
    );
  return (
    <section className="space-y-4">
      <p className="section-copy">
        Inspect at most 50 candidates per request. State filters apply within
        each candidate page; an empty page can still have more candidates.
      </p>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <Field
          label="Index folder"
          value={path}
          maxLength={4096}
          required
          disabled={page.busy}
          onChange={(event) => {
            setPath(event.target.value);
            page.clear();
          }}
        />
        <label className="grid gap-2 text-sm">
          Index state
          <Select
            aria-label="Index state"
            value={state}
            disabled={page.busy}
            onValueChange={(value) => {
              setState(value);
              page.clear();
            }}
          >
            {["all", "pending", "failed", "current"].map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </Select>
        </label>
        <Button disabled={page.busy}>Inspect index</Button>
      </form>
      <OperationFeedback action={page} />
      {page.page ? (
        <>
          <p role="status" className="text-xs text-muted-foreground">
            {page.page.inspected} candidates inspected in the latest page ·{" "}
            {page.page.results.length} matching rows loaded
          </p>
          <OperationTable
            label="Index diagnostics"
            rows={page.page.results}
            rowKey={(row) => row.id}
            columns={[
              { label: "Path", render: (row) => row.path },
              {
                label: "State / attempts",
                render: (row) => `${row.state} · ${row.attempts ?? 0}`,
              },
              { label: "Content policy", render: (row) => row.contentReason },
              {
                label: "Last indexed (UTC)",
                render: (row) => operationTime(row.indexedAt),
              },
              { label: "Last error", render: (row) => row.lastError ?? "—" },
            ]}
          />
          <MoreOperations
            page={page.page}
            busy={page.busy}
            load={() => void load(true)}
          />
        </>
      ) : null}
    </section>
  );
}
function Reindex({ client }: { client: OperationsClient }) {
  const action = useReviewedOperation<
      ReindexReviewRequest,
      ReindexPlanResult
    >(),
    [path, setPath] = useState("/"),
    [failedOnly, setFailedOnly] = useState(false),
    [cursor, setCursor] = useState<string | undefined>();
  const [expiryTime, setExpiryTime] = useState(0);
  const expiresAt = action.review?.value.reviewExpiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(
      () => setExpiryTime(expiresAt),
      Math.max(0, expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expiresAt]);
  const expired = !expiresAt || expiresAt <= Math.max(Date.now(), expiryTime);
  const request = { path, failedOnly, ...(cursor ? { cursor } : {}) },
    scope = JSON.stringify([client.namespace, request]);
  const preview = (nextCursor = cursor) => {
    const next = {
      path,
      failedOnly,
      ...(nextCursor ? { cursor: nextCursor } : {}),
    };
    setCursor(nextCursor);
    return action.preview(
      JSON.stringify([client.namespace, next]),
      next,
      (signal) =>
        client.request("/operations/reindex", {
          method: "POST",
          body: { ...next, dryRun: true },
          signal,
        }),
      (value) => ({
        ...next,
        reviewToken: value.reviewToken ?? undefined,
        reviewExpiresAt: value.reviewExpiresAt ?? undefined,
      }),
    );
  };
  const reset = () => {
    setCursor(undefined);
    action.clear();
  };
  return (
    <section className="space-y-4">
      <p className="section-copy">
        Review one page of up to 50 candidates before queueing work. Applying
        uses a five-minute server review bound to these candidates, revisions,
        indexing policy, folder, filter and input cursor. Changed or expired
        reviews are refused. Preview again explicitly after any refusal or
        uncertain response. It does not process the entire workspace.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Reindex folder"
          value={path}
          required
          maxLength={4096}
          disabled={action.busy}
          onChange={(event) => {
            setPath(event.target.value);
            reset();
          }}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={failedOnly}
            disabled={action.busy}
            onChange={(event) => {
              setFailedOnly(event.target.checked);
              reset();
            }}
          />
          Only failed index jobs
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={action.busy} onClick={() => void preview()}>
          Preview reindex page
        </Button>
        {cursor ? (
          <Button variant="ghost" disabled={action.busy} onClick={reset}>
            Start from first page
          </Button>
        ) : null}
      </div>
      <OperationFeedback action={action} />
      {action.value ? (
        <>
          <p role="status">
            {action.value.dryRun ? "Preview" : "Applied"}:{" "}
            {action.value.inspected} inspected · {action.value.results.length}{" "}
            candidates · {action.value.enqueued} enqueued · at most{" "}
            {action.value.maximumR2Reads} potential object reads for these
            candidates
          </p>
          <OperationTable
            label="Reindex candidates"
            rows={action.value.results}
            rowKey={(row) => row.id}
            columns={[
              { label: "Path", render: (row) => row.path },
              { label: "Failed attempts", render: (row) => row.attempts },
            ]}
          />
          <div className="flex flex-wrap gap-3">
            {action.review ? (
              <p role="status" className="w-full text-sm">
                {expired || !action.review.value.reviewToken
                  ? "Review unavailable or expired. Preview this page again."
                  : `Review expires ${operationTime(expiresAt)}.`}
              </p>
            ) : null}
            {action.review?.value.dryRun && action.review.scope === scope ? (
              <Button
                disabled={
                  action.busy ||
                  !action.review.value.results.length ||
                  expired ||
                  !action.review.value.reviewToken
                }
                onClick={() =>
                  void action.apply(scope, (saved) =>
                    client.request("/operations/reindex", {
                      method: "POST",
                      body: reviewedReindexRequest(saved),
                      mutation: true,
                    }),
                  )
                }
              >
                Apply reviewed reindex page
              </Button>
            ) : null}
            {action.value.nextCursor ? (
              <Button
                variant="outline"
                disabled={action.busy}
                onClick={() => void preview(action.value!.nextCursor!)}
              >
                Preview next page
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
function QueueFailures({ client }: { client: OperationsClient }) {
  const page = useOperationPage<QueueFailure>(),
    action = useOperation<FailureRetryResult>(),
    [selected, setSelected] = useState<string[]>([]);
  const busy = page.busy || action.busy;
  const load = (more = false) => {
    if (!more) setSelected([]);
    return page.load(
      (signal) =>
        client.request(
          operationQuery("/operations/failures", {
            cursor: more ? (page.page?.nextCursor ?? undefined) : undefined,
          }),
          { signal },
        ),
      more,
    );
  };
  return (
    <section className="space-y-4">
      <p className="section-copy">
        Choose up to 20 loaded index or webhook failures to retry. Unavailable
        or changed items are reported individually.
      </p>
      <Button variant="outline" disabled={busy} onClick={() => void load()}>
        Load failures
      </Button>
      <OperationFeedback action={page} />
      {page.page ? (
        <>
          <OperationTable
            label="Queue failures"
            rows={page.page.results}
            rowKey={(row) => row.id}
            selected={selected}
            onSelect={(id, checked) =>
              setSelected(toggleOperationSelection(selected, id, checked, 20))
            }
            disabled={busy}
            columns={[
              {
                label: "Kind / path",
                render: (row) => `${row.kind} · ${row.path ?? row.id}`,
              },
              {
                label: "Failed (UTC)",
                render: (row) => operationTime(row.createdAt),
              },
              { label: "Error", render: (row) => row.lastError },
            ]}
          />
          <MoreOperations
            page={page.page}
            busy={busy}
            load={() => void load(true)}
          />
          <Button
            disabled={busy || !selected.length}
            onClick={() =>
              void action.write(
                () =>
                  client.request("/operations/failures/retry", {
                    method: "POST",
                    body: { ids: selectedOperationIds(selected, 20) },
                    mutation: true,
                  }),
                () => setSelected([]),
              )
            }
          >
            Retry {selected.length} selected failures
          </Button>
        </>
      ) : null}
      <OperationFeedback action={action} />
      {action.value ? (
        <OperationTable
          label="Retry outcomes"
          rows={action.value.results}
          rowKey={(row) => row.id}
          columns={[
            { label: "Item", render: (row) => row.id },
            { label: "Result", render: (row) => row.status },
          ]}
        />
      ) : null}
    </section>
  );
}
export function OperationsIndexing({ client }: { client: OperationsClient }) {
  return (
    <div className="space-y-4">
      <Disclosure lazy>
        <DisclosureSummary>Search indexing policy</DisclosureSummary>
        <SearchPolicy client={client} />
      </Disclosure>
      <Disclosure lazy>
        <DisclosureSummary>Inspect index coverage</DisclosureSummary>
        <IndexDiagnostics client={client} />
      </Disclosure>
      <Disclosure lazy id="operations-reindex">
        <DisclosureSummary>Preview and apply scoped reindex</DisclosureSummary>
        <Reindex client={client} />
      </Disclosure>
      <Disclosure lazy>
        <DisclosureSummary>Retry queue failures</DisclosureSummary>
        <QueueFailures client={client} />
      </Disclosure>
    </div>
  );
}
