import { useState } from "react";
import type {
  UploadReservation,
  UploadInventoryResult,
  AbandonUploadsResult,
} from "@agfs/contracts";
import { Button } from "~/components/ui/button";
import { Select, SelectItem } from "~/components/ui/select";
import { Field } from "./shared";
import { formatBytes } from "~/lib/format";
import {
  operationTime,
  selectedOperationIds,
  type OperationsClient,
} from "~/lib/browser-operations";
import {
  MoreOperations,
  OperationFeedback,
  OperationTable,
  toggleOperationSelection,
  useOperationPage,
  useReviewedOperation,
} from "./OperationsShared";

export function OperationsUploads({ client }: { client: OperationsClient }) {
  const page = useOperationPage<UploadReservation, UploadInventoryResult>(),
    action = useReviewedOperation<{ ids: string[] }, AbandonUploadsResult>();
  const [path, setPath] = useState("/"),
    [status, setStatus] = useState("active"),
    [tokenId, setToken] = useState(""),
    [before, setBefore] = useState(""),
    [selected, setSelected] = useState<string[]>([]);
  const busy = page.busy || action.busy,
    filters = { path, status, tokenId, before },
    scope = JSON.stringify([client.namespace, filters, selected]);
  function reset() {
    page.clear();
    action.clear();
    setSelected([]);
  }
  async function load(more = false) {
    action.clear();
    setSelected([]);
    await page.load((signal) => {
      const time = before ? Date.parse(before + "T00:00:00Z") : undefined;
      if (time !== undefined && !Number.isFinite(time))
        throw new Error("Choose a valid before date in UTC.");
      return client.request("/operations/uploads", {
        method: "POST",
        body: {
          path,
          status,
          tokenId: tokenId || undefined,
          before: time,
          cursor: more ? (page.page?.nextCursor ?? undefined) : undefined,
        },
        signal,
      });
    }, more);
  }
  return (
    <section className="space-y-4">
      <p className="section-copy">
        Inspect reservations within a folder, then select up to 20 to preview
        abandonment. Filters apply inside 50-candidate pages, so continue after
        an empty page when a cursor is available. Abandoning a reservation never
        refunds the daily upload budget.
      </p>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <Field
          label="Upload folder"
          required
          value={path}
          maxLength={4096}
          disabled={busy}
          onChange={(event) => {
            setPath(event.target.value);
            reset();
          }}
        />
        <label className="grid gap-2 text-sm">
          Reservation status
          <Select
            aria-label="Reservation status"
            value={status}
            disabled={busy}
            onValueChange={(value) => {
              setStatus(value);
              reset();
            }}
          >
            {["active", "pending", "completing", "expired", "committed"].map(
              (value) => (
                <SelectItem value={value} key={value}>
                  {value}
                </SelectItem>
              ),
            )}
          </Select>
        </label>
        <Field
          label="Token ID (optional)"
          value={tokenId}
          maxLength={128}
          disabled={busy}
          onChange={(event) => {
            setToken(event.target.value);
            reset();
          }}
        />
        <Field
          label="Created before date (UTC, optional)"
          type="date"
          value={before}
          disabled={busy}
          onChange={(event) => {
            setBefore(event.target.value);
            reset();
          }}
        />
        <Button disabled={busy}>Inspect upload reservations</Button>
      </form>
      <OperationFeedback action={page} />
      {page.page ? (
        <>
          <p role="status" className="text-xs text-muted-foreground">
            {page.page.inspected} candidates inspected in the latest page ·{" "}
            {page.page.results.length} matches loaded · {selected.length}/20
            selected
          </p>
          <OperationTable
            label="Upload reservations"
            rows={page.page.results}
            rowKey={(row) => row.id}
            selected={selected}
            disabled={busy}
            onSelect={(id, checked) => {
              setSelected(toggleOperationSelection(selected, id, checked, 20));
              action.clear();
            }}
            columns={[
              {
                label: "Path / status",
                render: (row) => (
                  <>
                    {row.path}
                    <br />
                    <span className="text-muted-foreground">
                      {row.status} · {row.multipart ? "Multipart" : "Direct"}
                    </span>
                  </>
                ),
              },
              {
                label: "Size / reserved",
                render: (row) =>
                  `${formatBytes(row.size)} / ${formatBytes(row.reservedBytes)}`,
              },
              {
                label: "Uploaded",
                render: (row) =>
                  row.uploadedBytes === null
                    ? "Not measured for direct upload"
                    : formatBytes(row.uploadedBytes),
              },
              {
                label: "Created / expires (UTC)",
                render: (row) => (
                  <>
                    {operationTime(row.createdAt)}
                    <br />
                    {operationTime(row.expiresAt)}
                  </>
                ),
              },
              { label: "Token", render: (row) => row.tokenId ?? "Web session" },
            ]}
          />
          <MoreOperations
            page={page.page}
            busy={busy}
            load={() => void load(true)}
          />
          <Button
            variant="outline"
            disabled={busy || !selected.length}
            onClick={() =>
              void action.preview(
                scope,
                { ids: [...selected] },
                (signal) =>
                  client.request("/operations/uploads/abandon", {
                    method: "POST",
                    body: {
                      ids: selectedOperationIds(selected, 20),
                      dryRun: true,
                    },
                    signal,
                  }),
                (value) => ({
                  ids: value.results
                    .filter((row) => row.status === "would-abandon")
                    .map((row) => row.id),
                }),
              )
            }
          >
            Preview abandonment
          </Button>
        </>
      ) : null}
      <OperationFeedback action={action} />
      {action.value ? (
        <>
          <h3 className="font-semibold">
            {action.value.dryRun
              ? "Abandonment preview"
              : "Abandonment outcomes"}
          </h3>
          <OperationTable
            label="Abandonment outcomes"
            rows={action.value.results}
            rowKey={(row) => row.id}
            columns={[
              { label: "Reservation", render: (row) => row.path ?? row.id },
              { label: "Outcome", render: (row) => row.status },
              {
                label: "Cleanup after (UTC)",
                render: (row) => operationTime(row.cleanupAfter),
              },
            ]}
          />
          <p className="text-sm text-muted-foreground">
            Daily upload budget is not refunded. Changed or ineligible
            reservations are reported individually.
          </p>
          {action.review?.value.dryRun && action.review.scope === scope ? (
            <Button
              disabled={
                busy ||
                !action.review.value.results.some(
                  (row) => row.status === "would-abandon",
                )
              }
              onClick={() =>
                void action.apply(scope, (saved) =>
                  client.request("/operations/uploads/abandon", {
                    method: "POST",
                    body: { ...saved, dryRun: false },
                    mutation: true,
                  }),
                )
              }
            >
              Abandon eligible reviewed reservations
            </Button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
