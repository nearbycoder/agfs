import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Field, platform, useAction, selectClass } from "./shared";
import { inspectJson } from "~/lib/json-inspector";
export function JsonInspector() {
  const [path, setPath] = useState(""),
    [loaded, setLoaded] = useState<
      ({ path: string; raw: string } & ReturnType<typeof inspectJson>) | null
    >(null),
    [view, setView] = useState("tree"),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const action = useAction();
  const nodes = (loaded?.nodes ?? []).filter((n) =>
    query
      ? (n.path + " " + n.label + " " + n.value)
          .toLowerCase()
          .includes(query.toLowerCase())
      : !Array.from(collapsed).some(
          (p) => n.path !== p && (p === "" || n.path.startsWith(p + "/")),
        ),
  );
  const pages = Math.max(1, Math.ceil(nodes.length / 100)),
    current = Math.min(page, pages - 1);
  return (
    <section className="space-y-4" aria-label="JSON inspector">
      <p className="text-sm text-zinc-500">
        Validate JSON up to 256 KiB, 40 levels and 10,000 values. Inspect
        escaped JSON Pointer paths, search values, or copy the formatted
        document.
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            setLoaded(null);
            const file = await platform(
              "/text?path=" + encodeURIComponent(path),
            );
            setLoaded({
              path: file.path,
              raw: file.text,
              ...inspectJson(file.text),
            });
            setPage(0);
            setCollapsed(new Set());
            setQuery("");
          });
        }}
      >
        <Field
          label="JSON file path"
          required
          value={path}
          disabled={action.busy}
          onChange={(e) => setPath(e.target.value)}
        />
        <Button disabled={action.busy}>Inspect JSON</Button>
      </form>
      {action.error ? <p role="alert">{action.error}</p> : null}
      {action.notice ? <p role="status">{action.notice}</p> : null}
      {loaded ? (
        <>
          <h3 className="font-mono break-all">{loaded.path}</h3>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-2 text-sm">
              JSON view
              <select
                className={selectClass}
                value={view}
                onChange={(e) => setView(e.target.value)}
              >
                <option value="tree">Tree</option>
                <option value="formatted">Formatted</option>
                <option value="raw">Raw source</option>
              </select>
            </label>
            <Button
              variant="outline"
              onClick={() =>
                void action.run(async () => {
                  await navigator.clipboard.writeText(loaded.formatted);
                  action.setNotice("Formatted JSON copied.");
                })
              }
            >
              Copy formatted JSON
            </Button>
          </div>
          {view === "tree" ? (
            <>
              <Field
                label="Search JSON paths and values"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
              <p className="text-sm" role="status">
                Valid JSON · {loaded.nodes.length} values · {nodes.length}{" "}
                visible matches
              </p>
              <ul className="max-h-96 overflow-auto rounded-lg border p-3 font-mono text-xs">
                {nodes.slice(current * 100, current * 100 + 100).map((n) => (
                  <li
                    key={n.path}
                    style={{ paddingLeft: Math.min(n.depth, 8) * 12 }}
                    className="py-1 break-all"
                  >
                    {n.container ? (
                      <button
                        className="mr-2 underline"
                        aria-expanded={!collapsed.has(n.path)}
                        aria-label={"Toggle " + (n.path || "root")}
                        onClick={() => {
                          const next = new Set(collapsed);
                          next.has(n.path)
                            ? next.delete(n.path)
                            : next.add(n.path);
                          setCollapsed(next);
                        }}
                      >
                        {collapsed.has(n.path) ? "+" : "−"}
                      </button>
                    ) : null}
                    <span title={n.path || "/"}>{n.path || "(root)"}</span>:{" "}
                    <strong>{n.value}</strong>
                  </li>
                ))}
              </ul>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  disabled={current === 0}
                  onClick={() => setPage(current - 1)}
                >
                  Previous JSON values
                </Button>
                <span className="self-center text-sm">
                  {current + 1} / {pages}
                </span>
                <Button
                  variant="outline"
                  disabled={current + 1 >= pages}
                  onClick={() => setPage(current + 1)}
                >
                  Next JSON values
                </Button>
              </div>
            </>
          ) : (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg border p-3 text-xs">
              {view === "raw" ? loaded.raw : loaded.formatted}
            </pre>
          )}
        </>
      ) : null}
    </section>
  );
}
