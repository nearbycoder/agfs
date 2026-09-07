export type ActivityEvent = {
  id: string;
  action: string;
  path: string | null;
  actor: string;
  tokenId: string | null;
  createdAt: string;
};
export type ActivityFilters = {
  action: string;
  path: string;
  actor: string;
  from: string;
  to: string;
};
export function filterActivity(
  events: ActivityEvent[],
  filters: ActivityFilters,
) {
  const start = filters.from
    ? new Date(filters.from + "T00:00:00").getTime()
    : -Infinity;
  const end = filters.to
    ? new Date(filters.to + "T23:59:59.999").getTime()
    : Infinity;
  return events.filter((e) => {
    const at = new Date(e.createdAt).getTime();
    return (
      (!filters.action || e.action === filters.action) &&
      (!filters.path ||
        (e.path ?? "").toLowerCase().includes(filters.path.toLowerCase())) &&
      (!filters.actor ||
        (e.actor + " " + (e.tokenId ?? ""))
          .toLowerCase()
          .includes(filters.actor.toLowerCase())) &&
      at >= start &&
      at <= end
    );
  });
}
export function csvCell(value: string) {
  const safe =
    /^[\s]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value) ? "'" + value : value;
  return '"' + safe.replace(/"/g, '""') + '"';
}
export function activityCsv(events: ActivityEvent[]) {
  return (
    [
      ["Time", "Action", "Path", "Actor", "Token"],
      ...events.map((e) => [
        e.createdAt,
        e.action,
        e.path ?? "",
        e.actor,
        e.tokenId ?? "",
      ]),
    ]
      .map((r) => r.map(csvCell).join(","))
      .join("\r\n") + "\r\n"
  );
}
