import { Select, SelectItem } from "~/components/ui/select";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Field } from "./shared";
import {
  filterActivity,
  activityCsv,
  type ActivityEvent,
} from "~/lib/activity-explorer";
const empty = { action: "", path: "", actor: "", from: "", to: "" };
export function ActivityExplorer({ events }: { events: ActivityEvent[] }) {
  const [filters, setFilters] = useState(empty),
    [error, setError] = useState("");
  const invalid = !!(filters.from && filters.to && filters.from > filters.to),
    matching = invalid ? [] : filterActivity(events, filters);
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
          disabled={!matching.length}
          onClick={exportCsv}
        >
          Export {matching.length} matching events
        </Button>
      </div>
      {matching.length ? (
        <ol className="max-h-[40rem] divide-y overflow-auto">
          {matching.map((event) => (
            <li key={event.id} className="py-4">
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
    </section>
  );
}
