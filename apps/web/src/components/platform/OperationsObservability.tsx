import { useEffect, useState } from "react";
import type {
  AlertAttention,
  AlertAcknowledgementResult,
  AlertSnoozeResult,
  OperationMetricsResult,
} from "@agfs/contracts";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Select, SelectItem } from "~/components/ui/select";
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { Field } from "./shared";
import {
  metricWindow,
  operationInteger,
  operationQuery,
  operationTime,
  type OperationsClient,
} from "~/lib/browser-operations";
import {
  OperationFeedback,
  OperationTable,
  useOperation,
} from "./OperationsShared";

export type OperationAlert = AlertAttention & {
  id: string;
  message: string;
  resolved_at: number | null;
  created_at: number;
};
type AttentionUpdate = (
  alert: OperationAlert,
  path: "acknowledge" | "snooze",
  method: "PUT" | "DELETE",
  body: () => unknown,
) => Promise<void>;
function AlertControls({
  alert,
  busy,
  update,
}: {
  alert: OperationAlert;
  busy: boolean;
  update: AttentionUpdate;
}) {
  const [note, setNote] = useState(alert.note ?? ""),
    [minutes, setMinutes] = useState("60");
  useEffect(() => {
    setNote(alert.note ?? "");
  }, [alert.note, alert.acknowledgedAt]);
  return (
    <article className="space-y-3 rounded-xl border p-4">
      <h4 className="font-medium break-words">{alert.message}</h4>
      <p className="text-xs text-muted-foreground">
        {alert.resolved_at ? "Resolved" : "Unresolved"} ·{" "}
        {alert.visible === 0 ? "Hidden by snooze" : "Visible"} ·{" "}
        {alert.acknowledgedAt
          ? `Acknowledged ${operationTime(alert.acknowledgedAt)} by ${alert.acknowledgedBy ?? "unknown actor"}`
          : "Not acknowledged"}
        {alert.snoozedUntil
          ? ` · Snoozed until ${operationTime(alert.snoozedUntil)}`
          : ""}
      </p>
      <label className="grid gap-2 text-sm">
        Acknowledgement note
        <Textarea
          rows={2}
          maxLength={500}
          value={note}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void update(alert, "acknowledge", "PUT", () => ({ note }))
          }
        >
          {alert.acknowledgedAt
            ? "Update acknowledgement"
            : "Acknowledge alert"}
        </Button>
        {alert.acknowledgedAt ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void update(alert, "acknowledge", "DELETE", () => undefined)
            }
          >
            Clear acknowledgement
          </Button>
        ) : null}
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void update(alert, "snooze", "PUT", () => ({
            minutes: operationInteger(minutes, "Snooze minutes", 1, 10080),
          }));
        }}
      >
        <Field
          label="Snooze minutes"
          type="number"
          min={1}
          max={10080}
          value={minutes}
          required
          disabled={busy}
          onChange={(event) => setMinutes(event.target.value)}
        />
        <Button variant="outline" disabled={busy}>
          Snooze alert
        </Button>
        {alert.snoozedUntil ? (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void update(alert, "snooze", "PUT", () => ({ minutes: 0 }))
            }
          >
            Unsnooze alert
          </Button>
        ) : null}
      </form>
    </article>
  );
}
export function OperationsObservability({
  client,
  alerts,
  refresh,
}: {
  client: OperationsClient;
  alerts: OperationAlert[];
  refresh: () => Promise<void>;
}) {
  const attention = useOperation<{
      id: string;
      message: string;
      refreshError: string;
    }>(),
    [pendingId, setPendingId] = useState<string | null>(null);
  const update: AttentionUpdate = async (alert, path, method, body) => {
    await attention.write(async () => {
      attention.setValue(null);
      setPendingId(alert.id);
      await client.request<AlertAcknowledgementResult | AlertSnoozeResult>(
        "/operations/alerts/" + encodeURIComponent(alert.id) + "/" + path,
        { method, body: body(), mutation: true },
      );
      let refreshError = "";
      try {
        await refresh();
      } catch (error) {
        refreshError =
          "The alert action completed, but health refresh failed: " +
          (error instanceof Error
            ? error.message
            : "Refresh health to inspect the result.");
      }
      return { id: alert.id, message: alert.message, refreshError };
    });
  };
  const metrics = useOperation<OperationMetricsResult>(),
    [hours, setHours] = useState("24"),
    [bucket, setBucket] = useState("60"),
    [route, setRoute] = useState(""),
    [showAll, setShowAll] = useState(true);
  const shown = alerts.filter(
    (alert) =>
      showAll ||
      (attention.writing && alert.id === pendingId) ||
      (!alert.resolved_at && alert.visible !== 0 && !alert.acknowledgedAt),
  );
  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h3 className="font-semibold">Request history</h3>
        <p className="section-copy">
          Inspect up to seven days of request counts, errors, rejections and
          elapsed request latency. Average milliseconds are not CPU time. Limit
          the view to 168 buckets.
        </p>
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            void metrics.read((signal) =>
              client.request(
                operationQuery("/operations/metrics", {
                  ...metricWindow(hours, bucket),
                  route: route || undefined,
                }),
                { signal },
              ),
            );
          }}
        >
          <Field
            label="Metrics hours"
            type="number"
            min={1}
            max={168}
            required
            value={hours}
            disabled={metrics.busy}
            onChange={(event) => {
              setHours(event.target.value);
              metrics.clear();
            }}
          />
          <label className="grid gap-2 text-sm">
            Bucket size
            <Select
              aria-label="Metrics bucket minutes"
              value={bucket}
              disabled={metrics.busy}
              onValueChange={(value) => {
                setBucket(value);
                metrics.clear();
              }}
            >
              {["5", "15", "60"].map((value) => (
                <SelectItem value={value} key={value}>
                  {value} minutes
                </SelectItem>
              ))}
            </Select>
          </label>
          <label className="grid gap-2 text-sm">
            Route
            <Select
              aria-label="Metrics route"
              value={route}
              disabled={metrics.busy}
              onValueChange={(value) => {
                setRoute(value);
                metrics.clear();
              }}
            >
              <SelectItem value="">All routes</SelectItem>
              {["api", "mcp", "search", "upload", "download"].map((value) => (
                <SelectItem value={value} key={value}>
                  {value}
                </SelectItem>
              ))}
            </Select>
          </label>
          <Button disabled={metrics.busy}>Load request history</Button>
        </form>
        <OperationFeedback action={metrics} />
        {metrics.value ? (
          <>
            <p className="text-xs text-muted-foreground">
              {operationTime(metrics.value.from)} through{" "}
              {operationTime(metrics.value.through)} ·{" "}
              {metrics.value.retentionDays}-day retention
            </p>
            <OperationTable
              label="Request metric buckets"
              rows={metrics.value.results}
              rowKey={(row) => String(row.at)}
              columns={[
                {
                  label: "Bucket start (UTC)",
                  render: (row) => operationTime(row.at),
                },
                { label: "Requests", render: (row) => row.requests },
                { label: "Errors", render: (row) => row.errors },
                { label: "Rejected", render: (row) => row.rejections },
                {
                  label: "Average elapsed latency",
                  render: (row) =>
                    row.averageMs === null
                      ? "No requests"
                      : `${row.averageMs} ms`,
                },
              ]}
            />
          </>
        ) : null}
      </section>
      <section className="space-y-4 border-t pt-5">
        <h3 className="font-semibold">Alert attention</h3>
        <p className="section-copy">
          Acknowledgement records who is handling an alert; snoozing changes its
          visibility. Neither resolves the underlying condition nor stops
          evaluation. This list comes from the existing health snapshot.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(event) => setShowAll(event.target.checked)}
          />
          Include snoozed, acknowledged, and resolved alerts
        </label>
        <OperationFeedback action={attention} />
        {attention.writing ? (
          <p role="status" className="text-sm">
            Updating alert {pendingId}. Pending controls stay visible until
            completion.
          </p>
        ) : null}
        {attention.value ? (
          <p role="status" className="text-sm">
            Alert attention updated for {attention.value.message} (
            {attention.value.id}). Live evaluation continues.
          </p>
        ) : null}
        {attention.value?.refreshError ? (
          <p role="alert" className="text-sm text-destructive">
            {attention.value.refreshError}
          </p>
        ) : null}
        {shown.length ? (
          shown.slice(0, 50).map((alert) => (
            <Disclosure key={alert.id} lazy>
              <DisclosureSummary>
                <span className="min-w-0">
                  <span className="block break-words">{alert.message}</span>
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    {alert.resolved_at ? "Resolved" : "Unresolved"} ·{" "}
                    {alert.visible === 0 ? "Snoozed" : "Visible"} ·{" "}
                    {alert.acknowledgedAt ? "Acknowledged" : "Not acknowledged"}
                  </span>
                </span>
              </DisclosureSummary>
              <AlertControls
                alert={alert}
                busy={attention.busy}
                update={update}
              />
            </Disclosure>
          ))
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            No alerts match this view. Use Refresh health to update the
            snapshot.
          </p>
        )}
      </section>
    </div>
  );
}
