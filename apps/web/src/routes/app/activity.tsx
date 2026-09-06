import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { buildSeoHead, NOINDEX_ROBOTS, pageTitle } from "~/lib/seo";
export const Route = createFileRoute("/app/activity")({
  component: ActivityPage,
  head: () =>
    buildSeoHead({
      title: pageTitle("Activity"),
      description: "Recent file and token activity.",
      robots: NOINDEX_ROBOTS,
    }),
});
type Event = {
  id: string;
  action: string;
  path: string | null;
  actor: string;
  tokenId: string | null;
  createdAt: string;
};
function ActivityPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load(next?: string, signal?: AbortSignal) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/activity${next ? `?cursor=${encodeURIComponent(next)}` : ""}`, { signal });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      setEvents((old) => (next ? [...old, ...value.events] : value.events));
      setCursor(value.nextCursor);
    } catch (error) {
      if (!signal?.aborted) setError(error instanceof Error ? error.message : "Could not load activity");
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(undefined, controller.signal);
    return () => controller.abort();
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="dashboard-title">Activity</CardTitle>
        <CardDescription>
          File changes, downloads, previews, and shares from the last 90 days, identified by user or agent token.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Button disabled={busy} variant="outline" onClick={() => void load()}>
          Refresh
        </Button>
        {error ? (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        ) : null}
        {!events.length ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-zinc-500">
            {busy ? "Loading activity…" : "No activity yet. File operations will appear here."}
          </p>
        ) : (
          <ol className="divide-y">
            {events.map((event) => (
              <li key={event.id} className="py-4">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{event.action}</span>
                  <time className="text-sm text-zinc-500" dateTime={event.createdAt}>
                    {new Date(event.createdAt).toLocaleString()}
                  </time>
                </div>
                <p className="break-all font-mono text-sm mt-1">{event.path ?? "Account"}</p>
                <p className="section-copy">
                  {event.actor}
                  {event.tokenId ? ` · ${event.tokenId}` : " · Web session"}
                </p>
              </li>
            ))}
          </ol>
        )}
        {cursor ? (
          <Button disabled={busy} variant="outline" onClick={() => void load(cursor)}>
            Load older activity
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
