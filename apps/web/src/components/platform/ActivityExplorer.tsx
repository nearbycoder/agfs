import { Select, SelectItem } from "~/components/ui/select";
import { useDeferredValue, useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Field } from "./shared";
import {
  filterActivity,
  activityCsv,
  type ActivityEvent,
} from "~/lib/activity-explorer";
const empty = { action: "", path: "", actor: "", from: "", to: "" };
export function ActivityExplorer({ events }: { events: ActivityEvent[] }) {
  const [filters, updateFilters] = useState(empty);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const deferred = useDeferredValue(filters);
  const pending = deferred !== filters;
  const invalid = !!(filters.from && filters.to && filters.from > filters.to);
  const matching = useMemo(
    () =>
      deferred.from && deferred.to && deferred.from > deferred.to
        ? []
        : filterActivity(events, deferred),
    [events, deferred],
  );
  const pages = Math.max(1, Math.ceil(matching.length / 100));
  const current = Math.min(page, pages - 1);
  function setFilters(next: typeof empty) {
    updateFilters(next);
    setPage(0);
  }
  function exportCsv() {
    try {
      const url = URL.createObjectURL(
        new Blob(["\ufeff", activityCsv(matching)], {
          type: "text/csv;charset=utf-8",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "agfs-activity.csv";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not export CSV");
    }
  }
  return (
    <section className="space-y-4" aria-label="Activity explorer">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-2 text-sm">
          Activity action
          <Select
            placeholder="All actions"
            aria-label="Activity action"
            value={filters.action}
            onValueChange={(value) => setFilters({ ...filters, action: value })}
          >
            <SelectItem value="">All actions</SelectItem>
            {Array.from(new Set(events.map((event) => event.action)))
              .sort()
              .map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
          </Select>
        </label>
        <Field
          label="Activity path contains"
          value={filters.path}
          onChange={(e) => setFilters({ ...filters, path: e.target.value })}
        />
        <Field
          label="Actor or token contains"
          value={filters.actor}
          onChange={(e) => setFilters({ ...filters, actor: e.target.value })}
        />
        <Field
          label="Activity from date"
          type="date"
          value={filters.from}
          onChange={(e) => setFilters({ ...filters, from: e.target.value })}
        />
        <Field
          label="Activity through date"
          type="date"
          value={filters.to}
          onChange={(e) => setFilters({ ...filters, to: e.target.value })}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {pending ? "Filtering… · " : ""}
        {matching.length} matching events from {events.length} loaded. Dates use
        your local timezone. Load older activity below to include more records
        in filters and exports.
      </p>
      {invalid || error ? (
        <p role="alert">
          {invalid
            ? "The start date must be on or before the end date."
            : error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => setFilters(empty)}>
          Reset activity filters
        </Button>
        <Button
          variant="outline"
          disabled={pending || invalid || !matching.length}
          onClick={exportCsv}
        >
          Export {matching.length} matching events
        </Button>
      </div>
      {matching.length ? (
        <ol
          className="activity-timeline max-h-[40rem] overflow-auto rounded-xl border bg-card p-4"
          aria-label="Activity timeline"
          tabIndex={0}
        >
          {matching.slice(current * 100, current * 100 + 100).map((event) => (
            <li
              key={event.id}
              className="relative border-l border-border py-4 pl-5"
            >
              <span
                aria-hidden="true"
                className="absolute -left-1 top-6 size-2 rounded-full border-2 border-card bg-muted-foreground"
              />
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">{event.action}</span>
                <time
                  className="text-sm text-muted-foreground"
                  dateTime={event.createdAt}
                >
                  {new Date(event.createdAt).toLocaleString()}
                </time>
              </div>
              <p className="mt-1 break-all font-mono text-sm">
                {event.path ?? "Account"}
              </p>
              <p className="section-copy">
                {event.actor}
                {event.tokenId ? " · " + event.tokenId : " · Web session"}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm">No loaded events match these filters.</p>
      )}
      {matching.length > 100 ? (
        <nav
          aria-label="Activity pages"
          className="flex flex-wrap items-center gap-3"
        >
          <Button
            variant="outline"
            disabled={pending || current === 0}
            onClick={() => setPage(current - 1)}
          >
            Previous events
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {current + 1} of {pages} · 100 events per page
          </span>
          <Button
            variant="outline"
            disabled={pending || current + 1 >= pages}
            onClick={() => setPage(current + 1)}
          >
            Next events
          </Button>
        </nav>
      ) : null}
    </section>
  );
}
