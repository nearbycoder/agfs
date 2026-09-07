import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { formatBytes } from "~/lib/format";
import { Page, Field, platform, useAction, useData, Empty } from "./shared";
export function BudgetsPage() {
  const data = useData("/budgets", "agents");
  return (
    <Page
      title="Agent budgets"
      description="Limit each token or OAuth connection. Daily operations and upload reservations reset at midnight UTC; storage includes retained versions until they are permanently removed."
      error={data.error}
    >
      <Button
        variant="outline"
        disabled={data.loading}
        onClick={() => void data.refresh()}
      >
        Refresh usage
      </Button>
      {data.items.length ? (
        <div className="space-y-5">
          {data.items.map((a) => (
            <AgentBudget key={a.id} agent={a} refresh={data.refresh} />
          ))}
        </div>
      ) : (
        <Empty
          loading={data.loading}
          text="Create a token or connect an MCP client to start managing its budget."
        />
      )}
    </Page>
  );
}
function AgentBudget({
  agent: a,
  refresh,
}: {
  agent: any;
  refresh: () => Promise<void>;
}) {
  const action = useAction(),
    [storage, setStorage] = useState(a.storage_limit ?? ""),
    [uploads, setUploads] = useState(a.upload_limit ?? ""),
    [ops, setOps] = useState(a.operation_limit ?? ""),
    [paused, setPaused] = useState(!!a.paused);
  const warning = [
    [a.storage_bytes, a.storage_limit],
    [a.upload_bytes, a.upload_limit],
    [a.operations, a.operation_limit],
  ].some(([used, limit]) => limit !== null && used >= limit * 0.8);
  return (
    <Disclosure>
      <DisclosureSummary>
        <span>
          <span className="block font-semibold">{a.label}</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {formatBytes(a.storage_bytes)} stored · {a.operations} operations
            today{a.paused ? " · Paused" : ""}
            {warning ? " · Near budget limit" : ""}
          </span>
        </span>
      </DisclosureSummary>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await platform("/budgets/" + a.id, "PUT", {
              paused,
              storageLimit: storage === "" ? null : Number(storage),
              uploadLimit: uploads === "" ? null : Number(uploads),
              operationLimit: ops === "" ? null : Number(ops),
            });
            await refresh();
            action.setNotice("Budget saved.");
          });
        }}
      >
        <div>
          <h2 className="font-semibold">{a.label}</h2>
          <p className="section-copy">
            {a.path_prefix} · {formatBytes(a.storage_bytes)} stored ·{" "}
            {formatBytes(a.upload_bytes)} uploaded today · {a.operations}{" "}
            operations today
          </p>
        </div>
        {warning ? (
          <p role="status" className="text-amber-700 dark:text-amber-400">
            At least one budget has reached 80% of its limit.
          </p>
        ) : null}
        <div className="grid gap-3 md:grid-cols-3">
          <Field
            label="Storage limit (bytes)"
            type="number"
            min={0}
            value={storage}
            placeholder="Unlimited"
            onChange={(e) => setStorage(e.target.value)}
          />
          <Field
            label="Daily uploads (bytes)"
            type="number"
            min={0}
            value={uploads}
            placeholder="Unlimited"
            onChange={(e) => setUploads(e.target.value)}
          />
          <Field
            label="Daily operations"
            type="number"
            min={0}
            value={ops}
            placeholder="Unlimited"
            onChange={(e) => setOps(e.target.value)}
          />
        </div>
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={paused}
            onChange={(e) => setPaused(e.target.checked)}
          />
          Pause this agent
        </label>
        {action.error ? (
          <p role="alert" className="text-red-600">
            {action.error}
          </p>
        ) : null}
        {action.notice ? <p role="status">{action.notice}</p> : null}
        <Button variant="outline" disabled={action.busy}>
          Save budget
        </Button>
      </form>
    </Disclosure>
  );
}
