import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { formatBytes } from "~/lib/format";
import { buildSeoHead, NOINDEX_ROBOTS, pageTitle } from "~/lib/seo";
export const Route = createFileRoute("/app/recovery")({
  component: RecoveryPage,
  head: () =>
    buildSeoHead({
      title: pageTitle("Trash & versions"),
      description: "Recover deleted files and previous versions.",
      robots: NOINDEX_ROBOTS,
    }),
});
type Item = {
  id: string;
  path: string;
  kind: string;
  reason: string;
  size: number | null;
  retainedAt: string;
  expiresAt: string;
};
function RecoveryPage() {
  const [reason, setReason] = useState("trash");
  const [path, setPath] = useState("/");
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [destination, setDestination] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setReason(params.get("reason") === "version" ? "version" : "trash");
    setPath(params.get("path") ?? "/");
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    fetch(
      `/api/v1/recovery?reason=${reason}&path=${encodeURIComponent(path)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok) throw new Error(value.error);
        if (!controller.signal.aborted) {
          setItems((old) => (cursor ? [...old, ...value.items] : value.items));
          setNextCursor(value.nextCursor);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [reason, path, refresh, cursor]);
  async function act(item: Item, purge = false) {
    if (purge && !window.confirm(`Permanently remove ${item.path} from recovery? This cannot be undone.`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        purge ? `/api/v1/recovery?id=${encodeURIComponent(item.id)}` : "/api/v1/recovery/restore",
        {
          method: purge ? "DELETE" : "POST",
          headers: { "content-type": "application/json" },
          body: purge ? undefined : JSON.stringify({ id: item.id, path: destination }),
        },
      );
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      setNotice(purge ? "Permanently removed." : `Restored to ${value.path}.`);
      setSelected(null);
      setCursor(null);
      setRefresh((v) => v + 1);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Recovery failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="dashboard-title">Trash & versions</CardTitle>
        <CardDescription>
          Restore deleted files or earlier versions for 30 days. Retained files count toward storage. Restoring uses a
          vacant path and leaves existing files intact.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap gap-3">
          <Button
            variant={reason === "trash" ? "default" : "outline"}
            onClick={() => {
              setCursor(null);
              setReason("trash");
            }}
          >
            Trash
          </Button>
          <Button
            variant={reason === "version" ? "default" : "outline"}
            onClick={() => {
              setCursor(null);
              setReason("version");
            }}
          >
            Previous versions
          </Button>
        </div>
        <label className="block space-y-2">
          <span className="section-label">File or folder path</span>
          <Input
            value={path}
            onChange={(event) => {
              setCursor(null);
              setPath(event.target.value);
            }}
          />
        </label>
        {error ? (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
        {selected ? (
          <form
            className="rounded-xl border p-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void act(selected);
            }}
          >
            <p className="font-medium">Restore {selected.path}</p>
            <label className="block space-y-2">
              <span className="section-label">Restore to vacant path</span>
              <Input required value={destination} onChange={(event) => setDestination(event.target.value)} />
            </label>
            <div className="flex gap-2">
              <Button disabled={busy} type="submit">
                Restore
              </Button>
              <Button type="button" variant="ghost" onClick={() => setSelected(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
        {!items.length ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-zinc-500">
            No retained {reason === "trash" ? "deleted files" : "versions"} at this path.
          </p>
        ) : (
          <div className="divide-y">
            {items.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p className="font-mono text-sm break-all">{item.path}</p>
                  <p className="section-copy">
                    {formatBytes(item.size)} · Saved {new Date(item.retainedAt).toLocaleString()} · Expires{" "}
                    {new Date(item.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    disabled={busy}
                    variant="outline"
                    onClick={() => {
                      setSelected(item);
                      setDestination(item.reason === "version" ? `${item.path}.restored` : item.path);
                    }}
                  >
                    Restore…
                  </Button>
                  <Button disabled={busy} variant="ghost" onClick={() => void act(item, true)}>
                    Delete forever
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {nextCursor ? (
          <Button variant="outline" onClick={() => setCursor(nextCursor)}>
            Load older items
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
