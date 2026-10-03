import { AdvancedSettings } from "~/components/ui/advanced-settings";
import { DetailSurface } from "./shared";
import { Badge } from "~/components/ui/badge";
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { RunCompare } from "./RunCompare";
import { useEffect, useRef, useState } from "react";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Select, SelectItem } from "~/components/ui/select";
import {
  decodeRunSelection,
  filterRuns,
  parseRunMetadata,
  replayRun,
  runReport,
} from "~/lib/run-workflows";
import { downloadText } from "~/lib/download-text";
import { AgentOutput } from "./AgentOutput";
import { Button } from "~/components/ui/button";
import { Page, Field, platform, useAction, useData, Empty } from "./shared";
export function RunsPage({
  initialInputs,
  initialFolder,
}: {
  initialInputs?: string;
  initialFolder?: string;
}) {
  const data = useData("/runs", "runs"),
    action = useAction(),
    [name, setName] = useState(""),
    [path, setPath] = useState("/"),
    [inputs, setInputs] = useState(""),
    [days, setDays] = useState("30"),
    [manifest, setManifest] = useState<any>(null),
    [metadata, setMetadata] = useState("{}"),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [report, setReport] = useState<string | null>(null),
    [selectionError, setSelectionError] = useState("");
  const creator = useRef<HTMLDetailsElement>(null);
  const visibleRuns = filterRuns(data.items, query, status);
  useEffect(() => {
    if (!initialInputs) return;
    try {
      setInputs(decodeRunSelection(initialInputs).join("\n"));
      setPath(
        initialFolder === "/" || !initialFolder
          ? "/runs/new-run"
          : initialFolder + "/run-output",
      );
      setSelectionError("");
      if (creator.current) creator.current.open = true;
    } catch (e) {
      setSelectionError(
        e instanceof Error ? e.message : "Invalid run selection",
      );
    }
  }, [initialInputs, initialFolder]);
  return (
    <Page
      title="Agent runs"
      description="Keep an agent’s work together. Start a run, add files, then save the result."
      error={action.error || data.error || selectionError}
      notice={action.notice}
    >
      <Disclosure ref={creator}>
        <DisclosureSummary>
          <span>
            <span className="block font-semibold">Start a new run</span>
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              Collect inputs and outputs in a retained manifest.
            </span>
          </span>
        </DisclosureSummary>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await platform("/runs", "POST", {
                name,
                path,
                retentionDays: Number(days),
                metadata: parseRunMetadata(metadata),
                inputs: inputs
                  .split("\n")
                  .map((v) => v.trim())
                  .filter(Boolean),
              });
              setName("");
              action.setNotice(
                "Run started. Write artifacts to its output folder, then complete it to capture the manifest.",
              );
              await data.refresh();
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Run name"
              maxLength={100}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Field
              label="Output folder"
              required
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
          </div>
          <AdvancedSettings
            summary={`${days ? days + " days retention" : "Choose a retention period"} · ${inputs.split("\n").filter((v) => v.trim()).length} input files`}
          >
            <label className="grid gap-2 text-sm">
              Input paths, one per line
              <Textarea
                rows={3}
                value={inputs}
                onChange={(e) => setInputs(e.target.value)}
                placeholder="/inputs/brief.txt"
              />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              Run metadata (JSON object of strings)
              <Textarea
                rows={4}
                maxLength={8192}
                value={metadata}
                disabled={action.busy}
                onChange={(e) => setMetadata(e.target.value)}
                placeholder={'{"model":"agent-v1","task":"review"}'}
              />
              <span className="text-xs font-normal text-muted-foreground">
                Record model, task, experiment, or revision labels. Up to 30
                fields.
              </span>
            </label>
            <Field
              label="Retain inputs and artifacts (days)"
              required
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </AdvancedSettings>
          <Button disabled={action.busy}>Start run</Button>
        </form>
      </Disclosure>
      <div className="run-overview" role="group" aria-label="Loaded run summary">
        <div>
          <span>Loaded runs</span>
          <strong>{data.items.length}</strong>
        </div>
        <div>
          <span>Running</span>
          <strong>
            {data.items.filter((r) => r.status === "running").length}
          </strong>
        </div>
        <div>
          <span>Completed</span>
          <strong>
            {data.items.filter((r) => r.status === "completed").length}
          </strong>
        </div>
      </div>
      <div className="agent-tool-finder">
        <label className="grid gap-2 text-sm font-medium">
          Find a run
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, path, run ID, or metadata…"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Run status
          <Select
            aria-label="Run status filter"
            value={status}
            onValueChange={setStatus}
          >
            <SelectItem value="">All statuses</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </Select>
        </label>
        <p role="status" className="text-xs text-muted-foreground">
          {visibleRuns.length} matching loaded runs
          {data.nextCursor ? " · Load more to search older runs" : ""}
        </p>
      </div>
      {data.nextCursor ? (
        <Button
          variant="outline"
          disabled={data.loading}
          onClick={() => void data.loadMore()}
        >
          Load more
        </Button>
      ) : null}
      {data.items.length ? (
        <ul className="divide-y">
          {visibleRuns.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap justify-between gap-3 py-4"
            >
              <div>
                <h2 className="font-medium">{r.name}</h2>
                <p className="section-copy">
                  {r.path_prefix} <Badge variant="secondary">{r.status}</Badge>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      const source = await platform("/runs/" + r.id),
                        next = replayRun(source);
                      setName(next.name);
                      setPath(next.path);
                      setInputs(next.inputs);
                      setMetadata(next.metadata);
                      setManifest(null);
                      setReport(null);
                      if (creator.current) {
                        creator.current.open = true;
                        creator.current.scrollIntoView({ block: "start" });
                      }
                      action.setNotice(
                        "Rerun prepared with the same input paths and metadata. Start it to capture the current file versions; retained versions are not copied.",
                      );
                    })
                  }
                >
                  Prepare rerun
                </Button>
                <Button
                  variant="outline"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      setReport(null);
                      if (r.status === "running") {
                        setManifest(
                          (
                            await platform(
                              "/runs/" + r.id + "/complete",
                              "POST",
                              {},
                            )
                          ).manifest,
                        );
                        await data.refresh();
                      } else {
                        const run = await platform("/runs/" + r.id);
                        setManifest(JSON.parse(run.manifest));
                      }
                    })
                  }
                >
                  {r.status === "running" ? "Complete run" : "View manifest"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty
          loading={data.loading}
          text="No runs yet. Start one, write files into its output folder, then complete it."
        />
      )}
      {data.items.length && !visibleRuns.length ? (
        <p className="section-copy">No loaded runs match these filters.</p>
      ) : null}
      <RunCompare runs={data.items} />
      {manifest ? (
        <DetailSurface key={manifest.runId} label="Run manifest">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Manifest</h2>
            <Button variant="ghost" size="sm" onClick={() => setManifest(null)}>
              Close manifest
            </Button>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              downloadText(
                manifest.runId + ".json",
                JSON.stringify(manifest, null, 2),
                "application/json",
              );
            }}
          >
            Download JSON
          </Button>
          <Button
            variant="outline"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => setReport(runReport(manifest)))
            }
          >
            Prepare Markdown run report
          </Button>
          {report ? (
            <AgentOutput
              result={{
                output: report,
                filename: manifest.runId + "-report.md",
                summary: "Run metadata, retained inputs, and output checksums",
              }}
            />
          ) : null}
          <p className="section-copy">
            Files retained until{" "}
            {new Date(manifest.retainedUntil).toLocaleString()}.
          </p>
          <ul className="space-y-2">
            {[
              ...(manifest.inputs ?? []).map((v: any) => ({
                ...v,
                kind: "input",
              })),
              ...(manifest.artifacts ?? []).map((v: any) => ({
                ...v,
                kind: "output",
              })),
            ].map((v: any) => (
              <li key={v.kind + v.path}>
                <a
                  className="text-sm underline"
                  href={
                    "/api/v1/platform/runs/" +
                    manifest.runId +
                    "/file?" +
                    new URLSearchParams({ path: v.path, kind: v.kind })
                  }
                  download
                >
                  {v.kind}: {v.path}
                </a>
              </li>
            ))}
          </ul>
          <Disclosure>
            <DisclosureSummary>Raw manifest JSON</DisclosureSummary>
            <pre className="max-h-96 overflow-auto rounded-xl border p-4 text-xs">
              {JSON.stringify(manifest, null, 2)}
            </pre>
          </Disclosure>
        </DetailSurface>
      ) : null}
    </Page>
  );
}
