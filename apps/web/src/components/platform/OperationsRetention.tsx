import { useMemo, useState } from "react";
import type {
  RetentionReference,
  RetentionReferencesResult,
  RetentionExpiryResult,
  WebhookCleanupResult,
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

function RetentionReferences({ client }: { client: OperationsClient }) {
  const [path, setPath] = useState(""),
    page = useOperationPage<RetentionReference, RetentionReferencesResult>();
  const load = (more = false) =>
    page.load(
      (signal) =>
        client.request("/operations/retention/references", {
          method: "POST",
          body: {
            path,
            cursor: more ? (page.page?.nextCursor ?? undefined) : undefined,
          },
          signal,
        }),
      more,
    );
  return (
    <section className="space-y-4">
      <p className="section-copy">
        Inspect references keeping a live file's object retained. Multiple kinds
        can refer to the same object; this view exposes references, never
        storage object keys.
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <Field
          label="Live file path"
          required
          maxLength={4096}
          value={path}
          placeholder="/outputs/report.json"
          disabled={page.busy}
          onChange={(event) => {
            setPath(event.target.value);
            page.clear();
          }}
        />
        <Button disabled={page.busy}>Inspect retention references</Button>
      </form>
      <OperationFeedback action={page} />
      {page.page ? (
        <>
          <p role="status" className="text-sm">
            {page.page.path} · ETag {page.page.etag ?? "unavailable"} · observed{" "}
            {operationTime(page.page.generatedAt)}
          </p>
          <OperationTable
            label="Retention references"
            rows={page.page.results}
            rowKey={(row) => row.kind + ":" + row.referenceId}
            columns={[
              { label: "Kind", render: (row) => row.kind },
              { label: "Reference", render: (row) => row.name },
              { label: "Reference ID", render: (row) => row.referenceId },
              {
                label: "Expires (UTC)",
                render: (row) =>
                  row.expiresAt === null
                    ? "No expiry"
                    : operationTime(row.expiresAt),
              },
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
function RetentionExpiry({ client }: { client: OperationsClient }) {
  const [days, setDays] = useState("30"),
    page = useOperationPage<
      RetentionExpiryResult["results"][number],
      RetentionExpiryResult
    >();
  const pins = useMemo(
    () =>
      page.page?.results.map((row, index) => ({
        ...row,
        localKey: String(index),
      })) ?? [],
    [page.page?.results],
  );
  const load = (more = false) =>
    page.load(
      (signal) =>
        client.request(
          operationQuery("/operations/retention/expiring", {
            days: operationInteger(days, "Expiry days", 1, 90),
            cursor: more ? (page.page?.nextCursor ?? undefined) : undefined,
          }),
          { signal },
        ),
      more,
    );
  return (
    <section className="space-y-4">
      <p className="section-copy">
        Each row represents an object pin. Expiration removes that reference;
        live files or other pins may retain the bytes. These are not guaranteed
        freed bytes.
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <Field
          label="Pins expiring within days"
          type="number"
          min={1}
          max={90}
          value={days}
          required
          disabled={page.busy}
          onChange={(event) => {
            setDays(event.target.value);
            page.clear();
          }}
        />
        <Button disabled={page.busy}>Inspect expiring pins</Button>
      </form>
      <OperationFeedback action={page} />
      {page.page ? (
        <>
          <p className="text-xs text-muted-foreground">
            {operationTime(page.page.from)} through{" "}
            {operationTime(page.page.through)}. {page.page.semantics}
          </p>
          <OperationTable
            label="Expiring object pins"
            rows={pins}
            rowKey={(row) => row.localKey}
            columns={[
              {
                label: "Name / kind",
                render: (row) => `${row.name} · ${row.kind}`,
              },
              { label: "Reference", render: (row) => row.referenceId },
              {
                label: "Expires (UTC)",
                render: (row) => operationTime(row.expiresAt),
              },
              {
                label: "Referenced bytes",
                render: (row) =>
                  formatBytes(row.bytes, { nullLabel: "Unknown" }),
              },
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
type Delivery = {
  id: string;
  status: string;
  attempts: number;
  created_at: number;
  last_error: string | null;
};
function DeliveryCleanup({ client }: { client: OperationsClient }) {
  const hooks = useOperation<{
      webhooks: { id: string; url: string; path_prefix: string }[];
    }>(),
    deliveries = useOperation<{ deliveries: Delivery[] }>(),
    action = useReviewedOperation<{ ids: string[] }, WebhookCleanupResult>();
  const [hook, setHook] = useState(""),
    [selected, setSelected] = useState<string[]>([]);
  const scope = JSON.stringify([client.namespace, hook, selected]),
    busy = hooks.busy || deliveries.busy || action.busy;
  const terminal =
    deliveries.value?.deliveries.filter(
      (row) => row.status === "delivered" || row.status === "failed",
    ) ?? [];
  const outcomes = action.value
    ? selected.map((id) => ({
        id,
        outcome: action.value!.dryRun
          ? action.value!.eligible.some((row) => row.id === id)
            ? "Eligible in preview"
            : "Not eligible in preview"
          : action.value!.deleted.includes(id)
            ? "Deleted"
            : "Not deleted; may have changed or become unavailable",
      }))
    : [];
  return (
    <section className="space-y-4">
      <p className="section-copy">
        Load a webhook's most recent 100 deliveries, then select up to 50
        terminal deliveries. Pending and sending deliveries cannot be selected.
        Removing failed terminal history prevents retrying those deliveries.
      </p>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() =>
          void hooks.read((signal) => client.request("/webhooks", { signal }))
        }
      >
        Load webhook endpoints
      </Button>
      <OperationFeedback action={hooks} />
      {hooks.value ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-2 text-sm">
            Webhook endpoint
            <Select
              aria-label="Webhook endpoint for cleanup"
              value={hook}
              disabled={busy}
              onValueChange={(value) => {
                setHook(value);
                deliveries.clear();
                action.clear();
                setSelected([]);
              }}
            >
              <SelectItem value="">Choose an endpoint</SelectItem>
              {hooks.value.webhooks.map((row) => (
                <SelectItem value={row.id} key={row.id}>
                  {row.url} · {row.path_prefix}
                </SelectItem>
              ))}
            </Select>
          </label>
          <Button
            variant="outline"
            disabled={busy || !hook}
            onClick={() => {
              action.clear();
              setSelected([]);
              void deliveries.read((signal) =>
                client.request(
                  "/webhooks/" + encodeURIComponent(hook) + "/deliveries",
                  { signal },
                ),
              );
            }}
          >
            Load terminal delivery history
          </Button>
        </div>
      ) : null}
      <OperationFeedback action={deliveries} />
      {deliveries.value ? (
        <>
          <p className="text-xs text-muted-foreground">
            {terminal.length} terminal deliveries among{" "}
            {deliveries.value.deliveries.length} loaded records ·{" "}
            {selected.length}/50 selected
          </p>
          <OperationTable
            label="Terminal webhook deliveries"
            rows={terminal}
            rowKey={(row) => row.id}
            disabled={busy}
            selected={selected}
            onSelect={(id, checked) => {
              setSelected(toggleOperationSelection(selected, id, checked, 50));
              action.clear();
            }}
            columns={[
              { label: "Delivery", render: (row) => row.id },
              {
                label: "State / attempts",
                render: (row) => `${row.status} · ${row.attempts}`,
              },
              {
                label: "Created (UTC)",
                render: (row) => operationTime(row.created_at),
              },
              { label: "Last error", render: (row) => row.last_error ?? "—" },
            ]}
          />
          <Button
            variant="outline"
            disabled={busy || !selected.length}
            onClick={() =>
              void action.preview(
                scope,
                { ids: [...selected] },
                (signal) =>
                  client.request("/operations/webhooks/cleanup", {
                    method: "POST",
                    body: {
                      ids: selectedOperationIds(selected, 50),
                      dryRun: true,
                    },
                    signal,
                  }),
                (value) => ({ ids: value.eligible.map((row) => row.id) }),
              )
            }
          >
            Preview terminal delivery cleanup
          </Button>
        </>
      ) : null}
      <OperationFeedback action={action} />
      {action.value ? (
        <>
          <p role="status">
            {action.value.dryRun
              ? `${action.value.eligible.length} terminal deliveries eligible; ${formatBytes(action.value.payloadBytes)} of payload text in this preview.`
              : `${action.value.deleted.length} delivery records deleted.`}{" "}
            {action.value.note}
          </p>
          <OperationTable
            label="Delivery cleanup outcomes"
            rows={outcomes}
            rowKey={(row) => row.id}
            columns={[
              { label: "Delivery", render: (row) => row.id },
              { label: "Outcome", render: (row) => row.outcome },
            ]}
          />
          {action.review?.value.dryRun && action.review.scope === scope ? (
            <Button
              disabled={busy || !action.review.request.ids.length}
              onClick={() =>
                void action.apply(scope, (saved) =>
                  client.request("/operations/webhooks/cleanup", {
                    method: "POST",
                    body: { ...saved, dryRun: false },
                    mutation: true,
                  }),
                )
              }
            >
              Delete eligible reviewed deliveries
            </Button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
export function OperationsRetention({ client }: { client: OperationsClient }) {
  return (
    <div className="space-y-4">
      <Disclosure lazy>
        <DisclosureSummary>Why is a file retained?</DisclosureSummary>
        <RetentionReferences client={client} />
      </Disclosure>
      <Disclosure lazy>
        <DisclosureSummary>Upcoming pin expiration</DisclosureSummary>
        <RetentionExpiry client={client} />
      </Disclosure>
      <Disclosure lazy>
        <DisclosureSummary>
          Clean up terminal webhook delivery history
        </DisclosureSummary>
        <DeliveryCleanup client={client} />
      </Disclosure>
    </div>
  );
}
