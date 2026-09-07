import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Page, Field, platform, useAction, useData, Empty } from "./shared";
export function RunsPage() {
  const data = useData("/runs", "runs"),
    action = useAction(),
    [name, setName] = useState(""),
    [path, setPath] = useState("/"),
    [inputs, setInputs] = useState(""),
    [days, setDays] = useState("30"),
    [manifest, setManifest] = useState<any>(null);
  return (
    <Page
      title="Agent runs"
      description="Group outputs into a run and save a manifest with retained inputs, artifacts, versions, and provenance."
      error={action.error || data.error}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await platform("/runs", "POST", {
              name,
              path,
              retentionDays: Number(days),
              inputs: inputs
                .split("\n")
                .map((v) => v.trim())
                .filter(Boolean),
            });
            setName("");
            await data.refresh();
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Run name"
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
        <label className="grid gap-2 text-sm">
          Input paths, one per line
          <textarea
            className="rounded-md border bg-transparent p-3"
            rows={3}
            value={inputs}
            onChange={(e) => setInputs(e.target.value)}
            placeholder="/inputs/brief.txt"
          />
        </label>
        <Field
          label="Retain inputs and artifacts (days)"
          type="number"
          min={1}
          max={90}
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
        <Button disabled={action.busy}>Start run</Button>
      </form>
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
          {data.items.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap justify-between gap-3 py-4"
            >
              <div>
                <h2 className="font-medium">{r.name}</h2>
                <p className="section-copy">
                  {r.path_prefix} · {r.status}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
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
            </li>
          ))}
        </ul>
      ) : (
        <Empty
          loading={data.loading}
          text="No runs yet. Start one, write files into its output folder, then complete it."
        />
      )}
      {manifest ? (
        <section className="space-y-3">
          <h2 className="font-semibold">Manifest</h2>
          <Button
            variant="outline"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(manifest, null, 2)], {
                  type: "application/json",
                }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = manifest.runId + ".json";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Download JSON
          </Button>
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
          <pre className="max-h-96 overflow-auto rounded-xl border p-4 text-xs">
            {JSON.stringify(manifest, null, 2)}
          </pre>
        </section>
      ) : null}
    </Page>
  );
}
