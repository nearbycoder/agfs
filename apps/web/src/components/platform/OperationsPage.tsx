import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Page, Field, platform, useAction, useData, Empty } from "./shared";
export function OperationsPage() {
  const action = useAction(),
    snapshots = useData("/snapshots", "snapshots"),
    [health, setHealth] = useState<any>(null),
    [name, setName] = useState(""),
    [path, setPath] = useState("/"),
    [days, setDays] = useState("30"),
    [restore, setRestore] = useState<any>(null),
    [confirmation, setConfirmation] = useState("");
  const refresh = async () => setHealth(await platform("/health"));
  useEffect(() => {
    const c = new AbortController();
    platform("/health", "GET", undefined, c.signal)
      .then(setHealth)
      .catch(() => {});
    return () => c.abort();
  }, []);
  return (
    <Page
      title="Operations & recovery"
      description="Watch service health, keep recoverable snapshots, and act on issues before they interrupt your agents."
      error={action.error || snapshots.error}
      notice={action.notice}
    >
      <div className="flex justify-between gap-4">
        <h2 className="text-lg font-semibold">Last hour</h2>
        <Button
          variant="outline"
          disabled={action.busy}
          onClick={() => void action.run(refresh)}
        >
          Refresh health
        </Button>
      </div>
      {health ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              [
                "Requests",
                health.metrics.reduce((s: number, m: any) => s + m.requests, 0),
              ],
              ["Index backlog", health.indexing.pending],
              [
                "Active alerts",
                health.alerts.filter((a: any) => !a.resolved_at).length,
              ],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border p-5">
                <p className="text-sm text-zinc-500">{label}</p>
                <p className="mt-2 font-mono text-3xl">{value}</p>
              </div>
            ))}
          </div>
          <ul className="divide-y">
            {health.metrics.map((m: any) => (
              <li
                key={m.route}
                className="flex flex-wrap justify-between gap-2 py-3"
              >
                <strong>{m.route}</strong>
                <span>
                  {m.averageMs} ms average · {m.errors} errors · {m.rejections}{" "}
                  rejected
                </span>
              </li>
            ))}
          </ul>
          {health.alerts
            .filter((a: any) => !a.resolved_at)
            .map((a: any) => (
              <p
                key={a.id}
                role="alert"
                className="rounded-lg border border-amber-500 p-3"
              >
                {a.message}
              </p>
            ))}
          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer font-medium">
              Alert thresholds
            </summary>
            <form
              className="mt-4 grid gap-3 sm:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                void action.run(async () => {
                  await platform("/health/thresholds", "PUT", {
                    errorPercent: Number(d.get("errors")),
                    backlog: Number(d.get("backlog")),
                    latencyMs: Number(d.get("latency")),
                  });
                  await refresh();
                });
              }}
            >
              <Field
                label="Error percentage"
                name="errors"
                type="number"
                min={1}
                max={100}
                defaultValue={health.thresholds.error_percent}
              />
              <Field
                label="Pending index jobs"
                name="backlog"
                type="number"
                min={1}
                defaultValue={health.thresholds.backlog}
              />
              <Field
                label="Average latency (ms)"
                name="latency"
                type="number"
                min={100}
                defaultValue={health.thresholds.latency_ms}
              />
              <Button disabled={action.busy}>Save thresholds</Button>
            </form>
          </details>
          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer font-medium">
              Indexing jobs & repair
            </summary>
            <ul className="my-4 space-y-2">
              {health.jobs.map((j: any) => (
                <li key={j.path} className="break-all text-sm">
                  {j.path} · {j.attempts} failed attempts{" "}
                  {j.last_error ? `· ${j.last_error}` : ""}
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await platform("/search/reindex", "POST", {});
                  await refresh();
                  action.setNotice("Files queued for reindexing.");
                })
              }
            >
              Reindex workspace
            </Button>
          </details>
          {health.expiringCredentials.length ? (
            <section>
              <h2 className="font-semibold">
                Credentials expiring within seven days
              </h2>
              <ul>
                {health.expiringCredentials.map((t: any) => (
                  <li key={t.id}>
                    {t.label} · {new Date(t.expires_at).toLocaleDateString()} ·{" "}
                    <a className="underline" href="/app/tokens">
                      Manage token
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : (
        <p role="status">
          Use Refresh health to load operational metrics. Owner access is
          required.
        </p>
      )}
      <section className="space-y-4 border-t pt-6">
        <h2 className="text-lg font-semibold">Snapshots</h2>
        <p className="text-sm text-zinc-500">
          Preserve a folder’s current files for 1–90 days. Retained versions
          count toward storage. Restoring revokes existing shares in that
          folder.
        </p>
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await platform("/snapshots", "POST", {
                name,
                path,
                days: Number(days),
              });
              await snapshots.refresh();
              setName("");
            });
          }}
        >
          <Field
            label="Snapshot name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Field
            label="Folder"
            required
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
          <Field
            label="Retention (days)"
            type="number"
            min={1}
            max={90}
            required
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
          <Button disabled={action.busy}>Create snapshot</Button>
        </form>
        {snapshots.items.length ? (
          <ul className="divide-y">
            {snapshots.items.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap justify-between gap-3 py-4"
              >
                <div>
                  <strong>{s.name}</strong>
                  <p className="text-sm text-zinc-500">
                    {s.path_prefix} · expires{" "}
                    {new Date(s.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRestore(s);
                    setConfirmation("");
                  }}
                >
                  Restore…
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty loading={snapshots.loading} text="No snapshots yet." />
        )}
        {snapshots.nextCursor ? (
          <Button variant="outline" onClick={() => void snapshots.loadMore()}>
            Load more snapshots
          </Button>
        ) : null}
        {restore ? (
          <form
            className="space-y-3 rounded-xl border border-amber-500 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(async () => {
                await platform(
                  "/snapshots/" + restore.id + "/restore",
                  "POST",
                  {},
                );
                setRestore(null);
                action.setNotice(
                  "Snapshot restored. Previous files are available in recovery.",
                );
              });
            }}
          >
            <h3 className="font-semibold">Restore {restore.name}</h3>
            <p>
              This replaces the live contents of {restore.path_prefix}. Type the
              snapshot name to continue.
            </p>
            <Field
              label="Snapshot name confirmation"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
            <div className="flex gap-2">
              <Button disabled={action.busy || confirmation !== restore.name}>
                Restore snapshot
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRestore(null)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </section>
    </Page>
  );
}
