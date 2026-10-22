import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "~/components/ui/table";
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { Select, SelectItem } from "~/components/ui/select";
import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { platform, useAction } from "./shared";
import { runSnapshot, compareArtifacts } from "~/lib/run-comparison";
import { useResultPage, ResultPageControls } from "./ResultPage";
import { formatBytes } from "~/lib/format";
function RunMetadata({ value }: { value: unknown }) {
  const formatted = useMemo(() => JSON.stringify(value, null, 2), [value]);
  return (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">
      {formatted}
    </pre>
  );
}
export function RunMetadataDisclosure({ value }: { value: unknown }) {
  return (
    <Disclosure lazy>
      <DisclosureSummary>Run metadata</DisclosureSummary>
      <RunMetadata value={value} />
    </Disclosure>
  );
}
export function RunArtifactTable({
  title,
  rows,
  onlyChanges,
}: {
  title: string;
  rows: ReturnType<typeof compareArtifacts>;
  onlyChanges: boolean;
}) {
  const visible = useMemo(
    () => (onlyChanges ? rows.filter((r) => r.status !== "unchanged") : rows),
    [rows, onlyChanges],
  );
  const counts = useMemo(() => {
    const counts = { added: 0, removed: 0, changed: 0, unchanged: 0 };
    for (const row of rows) counts[row.status as keyof typeof counts]++;
    return counts;
  }, [rows]);
  const page = useResultPage(visible);
  return (
    <section className="space-y-2">
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm">
        {counts.added} added · {counts.removed} removed · {counts.changed}{" "}
        changed · {counts.unchanged} unchanged
      </p>
      <Table scrollClassName="max-h-80" aria-label={title + " comparison"}>
        <TableHeader>
          <TableRow>
            <TableHead>Path</TableHead>
            <TableHead>Change</TableHead>
            <TableHead>Before</TableHead>
            <TableHead>After</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.rows.map((r) => (
            <TableRow key={r.path} className="border-t">
              <TableCell className="break-all font-mono">{r.path}</TableCell>
              <TableCell>{r.status}</TableCell>
              <TableCell>
                {r.before ? formatBytes(r.before.size ?? 0) : "—"}
              </TableCell>
              <TableCell>
                {r.after ? formatBytes(r.after.size ?? 0) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ResultPageControls {...page} label={title.toLowerCase() + " entries"} />
      {!visible.length ? (
        <p className="text-sm">No matching manifest entries.</p>
      ) : null}
    </section>
  );
}
export function RunCompare({ runs }: { runs: any[] }) {
  const [left, setLeft] = useState(""),
    [right, setRight] = useState(""),
    [result, setResult] = useState<{
      a: ReturnType<typeof runSnapshot>;
      b: ReturnType<typeof runSnapshot>;
      inputs: ReturnType<typeof compareArtifacts>;
      outputs: ReturnType<typeof compareArtifacts>;
    } | null>(null),
    [onlyChanges, setOnlyChanges] = useState(false);
  const action = useAction();
  return (
    <Disclosure>
      <DisclosureSummary>Compare agent runs</DisclosureSummary>
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
              const baseline = runSnapshot(a),
                comparison = runSnapshot(b);
              setResult({
                a: baseline,
                b: comparison,
                inputs: compareArtifacts(baseline.inputs, comparison.inputs),
                outputs:
                  baseline.hasOutputs && comparison.hasOutputs
                    ? compareArtifacts(
                        baseline.outputs,
                        comparison.outputs,
                        baseline.path,
                        comparison.path,
                      )
                    : [],
              });
            });
          }}
        >
          {[
            { label: "Baseline run", value: left, set: setLeft },
            { label: "Comparison run", value: right, set: setRight },
          ].map((f) => (
            <label key={f.label} className="grid gap-2 text-sm">
              {f.label}
              <Select
                placeholder="Choose a loaded run"
                aria-label={f.label}
                required
                disabled={action.busy}
                value={f.value}
                onValueChange={(value) => f.set(value)}
              >
                <SelectItem value="">Choose a loaded run</SelectItem>
                {runs.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name} · {r.status} · {r.id.slice(-6)}
                  </SelectItem>
                ))}
              </Select>
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
                  <RunMetadataDisclosure value={r.metadata} />
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
            <RunArtifactTable
              title="Inputs"
              rows={result.inputs}
              onlyChanges={onlyChanges}
            />
            {result.a.hasOutputs && result.b.hasOutputs ? (
              <RunArtifactTable
                title="Outputs"
                rows={result.outputs}
                onlyChanges={onlyChanges}
              />
            ) : (
              <p role="status">
                Output comparison is available after both runs have completed
                manifests.
              </p>
            )}
          </>
        ) : null}
      </div>
    </Disclosure>
  );
}
