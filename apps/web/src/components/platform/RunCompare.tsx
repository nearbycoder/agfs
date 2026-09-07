import { useState } from "react";
import { Button } from "~/components/ui/button";
import { platform, useAction, selectClass } from "./shared";
import { runSnapshot, compareArtifacts } from "~/lib/run-comparison";
import { formatBytes } from "~/lib/format";
export function RunCompare({ runs }: { runs: any[] }) {
  const [left, setLeft] = useState(""),
    [right, setRight] = useState(""),
    [result, setResult] = useState<{
      a: ReturnType<typeof runSnapshot>;
      b: ReturnType<typeof runSnapshot>;
    } | null>(null),
    [onlyChanges, setOnlyChanges] = useState(false);
  const action = useAction();
  function table(title: string, rows: ReturnType<typeof compareArtifacts>) {
    const visible = rows.filter(
      (r) => !onlyChanges || r.status !== "unchanged",
    );
    return (
      <section className="space-y-2">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm">
          {rows.filter((r) => r.status === "added").length} added ·{" "}
          {rows.filter((r) => r.status === "removed").length} removed ·{" "}
          {rows.filter((r) => r.status === "changed").length} changed ·{" "}
          {rows.filter((r) => r.status === "unchanged").length} unchanged
        </p>
        <div className="max-h-80 overflow-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="p-2">Path</th>
                <th className="p-2">Change</th>
                <th className="p-2">Before</th>
                <th className="p-2">After</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.path} className="border-t">
                  <td className="break-all p-2 font-mono">{r.path}</td>
                  <td className="p-2">{r.status}</td>
                  <td className="p-2">
                    {r.before ? formatBytes(r.before.size ?? 0) : "—"}
                  </td>
                  <td className="p-2">
                    {r.after ? formatBytes(r.after.size ?? 0) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length ? (
          <p className="text-sm">No matching manifest entries.</p>
        ) : null}
      </section>
    );
  }
  return (
    <details className="rounded-xl border p-4">
      <summary className="cursor-pointer font-semibold">
        Compare agent runs
      </summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          Compare recorded inputs and completed output manifests. Outputs match
          by paths relative to each run folder; inputs match by full paths. This
          does not inspect current file contents or extend retention.
        </p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              setResult(null);
              const [a, b] = await Promise.all([
                platform("/runs/" + encodeURIComponent(left)),
                platform("/runs/" + encodeURIComponent(right)),
              ]);
              setResult({ a: runSnapshot(a), b: runSnapshot(b) });
            });
          }}
        >
          {[
            { label: "Baseline run", value: left, set: setLeft },
            { label: "Comparison run", value: right, set: setRight },
          ].map((f) => (
            <label key={f.label} className="grid gap-2 text-sm">
              {f.label}
              <select
                className={selectClass}
                required
                disabled={action.busy}
                value={f.value}
                onChange={(e) => f.set(e.target.value)}
              >
                <option value="">Choose a loaded run</option>
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.status} · {r.id.slice(-6)}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <Button disabled={action.busy || !left || !right || left === right}>
            Compare runs
          </Button>
        </form>
        {action.error ? <p role="alert">{action.error}</p> : null}
        {result ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {[result.a, result.b].map((r, i) => (
                <div key={i} className="space-y-2 rounded-lg border p-3">
                  <h3 className="font-semibold">
                    {r.name} · {r.status}
                  </h3>
                  <p className="break-all text-sm">{r.path}</p>
                  <p className="text-xs">
                    Created {new Date(r.createdAt).toLocaleString()}
                    <br />
                    Completed{" "}
                    {r.completedAt
                      ? new Date(r.completedAt).toLocaleString()
                      : "Not completed"}
                    <br />
                    Retention{" "}
                    {r.retainedUntil
                      ? new Date(r.retainedUntil).toLocaleString()
                      : "No completed manifest"}
                  </p>
                  <details>
                    <summary className="cursor-pointer text-sm">
                      Run metadata
                    </summary>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">
                      {JSON.stringify(r.metadata, null, 2)}
                    </pre>
                  </details>
                </div>
              ))}
            </div>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyChanges}
                onChange={(e) => setOnlyChanges(e.target.checked)}
              />
              Hide unchanged manifest entries
            </label>
            {table(
              "Inputs",
              compareArtifacts(result.a.inputs, result.b.inputs),
            )}
            {result.a.hasOutputs && result.b.hasOutputs ? (
              table(
                "Outputs",
                compareArtifacts(
                  result.a.outputs,
                  result.b.outputs,
                  result.a.path,
                  result.b.path,
                ),
              )
            ) : (
              <p role="status">
                Output comparison is available after both runs have completed
                manifests.
              </p>
            )}
          </>
        ) : null}
      </div>
    </details>
  );
}
