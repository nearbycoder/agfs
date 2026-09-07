import { useEffect, useState } from "react";
import { DuplicateFinder } from "./DuplicateFinder";
import { Button } from "~/components/ui/button";
import { formatBytes } from "~/lib/format";
import { Page, Field, platform, useAction } from "./shared";
type Insight = {
  path: string;
  summary: { bytes: number; files: number; folders: number };
  types: { type: string; bytes: number; files: number }[];
  largest: { id: string; path: string; size: number }[];
  folders: { path: string; bytes: number; files: number }[];
  generatedAt: number;
};
export function StoragePage() {
  const [path, setPath] = useState("/"),
    [data, setData] = useState<Insight | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const action = useAction();
  useEffect(() => {
    const controller = new AbortController();
    void platform("/storage/insights", "GET", undefined, controller.signal)
      .then((v) => {
        if (!controller.signal.aborted) setData(v);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  return (
    <Page
      title="Storage insights"
      description="Understand your live files. Retained versions, snapshots and unfinished uploads are excluded from this view; account usage includes retained storage."
      error={action.error || error}
    >
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const v = await platform(
              "/storage/insights?path=" + encodeURIComponent(path),
            );
            setData(v);
            setError("");
          });
        }}
      >
        <Field
          label="Folder path"
          required
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <Button disabled={action.busy || loading}>Refresh insights</Button>
      </form>
      {loading ? <p role="status">Loading storage insights…</p> : null}
      {data ? (
        <div className="space-y-6">
          <p className="text-sm text-zinc-500 break-all">
            {data.path} · Updated {new Date(data.generatedAt).toLocaleString()}
          </p>
          <dl className="grid gap-3 sm:grid-cols-3">
            {[
              ["Live file bytes", formatBytes(data.summary.bytes)],
              ["Files", data.summary.files],
              ["Folders", data.summary.folders],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border p-4">
                <dt className="text-sm text-zinc-500">{label}</dt>
                <dd className="mt-2 text-2xl font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          <section className="space-y-3">
            <h2 className="font-semibold">Content types · top 20 by bytes</h2>
            {data.types.map((t) => (
              <div key={t.type} className="space-y-1">
                <div className="flex flex-wrap justify-between gap-2 text-sm">
                  <span className="font-mono break-all">{t.type}</span>
                  <span>
                    {formatBytes(t.bytes)} · {t.files} files
                  </span>
                </div>
                <div className="h-2 rounded bg-zinc-200 dark:bg-zinc-800">
                  <div
                    className="h-2 rounded bg-zinc-700 dark:bg-zinc-300"
                    style={{
                      width: `${Math.min(100, (100 * t.bytes) / Math.max(1, data.summary.bytes))}%`,
                    }}
                  />
                </div>
              </div>
            ))}
            {!data.types.length ? (
              <p className="text-sm text-zinc-500">No files in this folder.</p>
            ) : null}
          </section>
          <section>
            <h2 className="font-semibold">Largest files · top 20</h2>
            <ul className="divide-y">
              {data.largest.map((f) => (
                <li
                  key={f.id}
                  className="flex flex-wrap justify-between gap-2 py-3"
                >
                  <a
                    className="font-mono text-sm underline break-all"
                    href={
                      "/api/v1/fs/download?path=" + encodeURIComponent(f.path)
                    }
                  >
                    {f.path}
                  </a>
                  <span>{formatBytes(f.size)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="font-semibold">
              Folders · top 20 by directly stored bytes
            </h2>
            <p className="text-sm text-zinc-500">
              Each file counts toward its immediate parent folder.
            </p>
            <ul className="divide-y">
              {data.folders.map((f) => (
                <li
                  key={f.path}
                  className="flex flex-wrap justify-between gap-2 py-3"
                >
                  <a
                    className="font-mono text-sm underline break-all"
                    href={"/app/files?path=" + encodeURIComponent(f.path)}
                  >
                    {f.path}
                  </a>
                  <span>
                    {formatBytes(f.bytes)} · {f.files} files
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <DuplicateFinder key={data.path} initialPath={data.path} />
        </div>
      ) : null}
    </Page>
  );
}
