import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { platform } from "./shared";
import { chooseReadme, readmeBlocks, type ReadmeBlock } from "~/lib/readme";
export function FolderReadme({
  entries,
}: {
  entries: { name: string; path: string; kind: string; etag?: string | null }[];
}) {
  const file = chooseReadme(entries),
    [open, setOpen] = useState(false),
    [raw, setRaw] = useState(false),
    [refresh, setRefresh] = useState(0),
    [data, setData] = useState<{
      path: string;
      text: string;
      blocks: ReadmeBlock[];
    } | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const path = file?.path,
    etag = entries.find((e) => e.path === path)?.etag;
  useEffect(() => {
    setData(null);
    setError("");
    if (!open || !path) return;
    const controller = new AbortController();
    setLoading(true);
    platform(
      "/text?path=" + encodeURIComponent(path),
      "GET",
      undefined,
      controller.signal,
    )
      .then((d) => {
        if (!controller.signal.aborted)
          setData({ path: d.path, text: d.text, blocks: readmeBlocks(d.text) });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "Could not load README");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, etag, open, refresh]);
  if (!file) return null;
  return (
    <details
      className="rounded-xl border p-5"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer font-semibold">
        Folder README · {file.name}
      </summary>
      <section aria-label="Folder README" className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <a
            className="text-sm underline"
            href={"/api/v1/fs/download?path=" + encodeURIComponent(file.path)}
          >
            Download README
          </a>
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => setRefresh((n) => n + 1)}
          >
            Reload README
          </Button>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={raw}
              onChange={(e) => setRaw(e.target.checked)}
            />
            Show source
          </label>
        </div>
        {loading ? <p role="status">Loading README…</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {data && data.path === path ? (
          <div className="max-h-96 overflow-auto break-words">
            {raw ? (
              <pre className="whitespace-pre-wrap font-mono text-xs">
                {data.text}
              </pre>
            ) : (
              <div className="space-y-3">
                {data.blocks.length ? (
                  data.blocks.map((b, i) =>
                    b.kind === "heading" ? (
                      <h3
                        key={i}
                        className={
                          b.level === 1
                            ? "text-xl font-semibold"
                            : "font-semibold"
                        }
                      >
                        {b.text}
                      </h3>
                    ) : b.kind === "code" ? (
                      <pre
                        key={i}
                        className="overflow-auto rounded-lg bg-zinc-100 p-3 text-xs dark:bg-zinc-900"
                      >
                        {b.text}
                      </pre>
                    ) : b.kind === "list" ? (
                      <p key={i} className="pl-4 text-sm">
                        • {b.text}
                      </p>
                    ) : (
                      <p key={i} className="whitespace-pre-wrap text-sm">
                        {b.text}
                      </p>
                    ),
                  )
                ) : (
                  <p className="text-sm">This README is empty.</p>
                )}
              </div>
            )}
          </div>
        ) : null}
        <p className="text-xs text-zinc-500">
          Basic Markdown headings, lists and code blocks. Embedded HTML, links
          and images are displayed as text.
        </p>
      </section>
    </details>
  );
}
