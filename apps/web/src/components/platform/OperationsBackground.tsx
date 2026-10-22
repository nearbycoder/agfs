import { useState } from "react";
import type {
  BackgroundPolicyResult,
  MaintenanceStatusResult,
} from "@agfs/contracts";
import { Button } from "~/components/ui/button";
import { operationTime, type OperationsClient } from "~/lib/browser-operations";
import { OperationFeedback, useOperation } from "./OperationsShared";

export function OperationsBackground({ client }: { client: OperationsClient }) {
  const policy = useOperation<BackgroundPolicyResult>(),
    maintenance = useOperation<MaintenanceStatusResult>(),
    [indexingPaused, setIndexing] = useState(false),
    [webhooksPaused, setWebhooks] = useState(false);
  const setPolicy = (next: BackgroundPolicyResult) => {
    setIndexing(next.indexingPaused);
    setWebhooks(next.webhooksPaused);
  };
  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h3 className="font-semibold">Pause background dispatch</h3>
        <p className="section-copy">
          Pause indexing or webhook dispatch without deleting queued work.
          Retention maintenance continues. Load the current policy before
          changing it.
        </p>
        <Button
          variant="outline"
          disabled={policy.busy}
          onClick={() =>
            void policy.read(
              (signal) => client.request("/operations/background", { signal }),
              setPolicy,
            )
          }
        >
          Load background policy
        </Button>
        {policy.value ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void policy.write(
                () =>
                  client.request("/operations/background", {
                    method: "PUT",
                    body: { indexingPaused, webhooksPaused },
                    mutation: true,
                  }),
                setPolicy,
              );
            }}
          >
            <fieldset
              className="grid gap-3 sm:grid-cols-2"
              disabled={policy.busy}
            >
              <legend className="sr-only">Background dispatch settings</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={indexingPaused}
                  onChange={(event) => setIndexing(event.target.checked)}
                />
                Pause indexing dispatch
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={webhooksPaused}
                  onChange={(event) => setWebhooks(event.target.checked)}
                />
                Pause webhook dispatch
              </label>
            </fieldset>
            <Button disabled={policy.busy}>Save dispatch policy</Button>
            <p role="status" className="text-sm text-muted-foreground">
              Saved state: indexing{" "}
              {policy.value.indexingPaused ? "paused" : "running"}; webhooks{" "}
              {policy.value.webhooksPaused ? "paused" : "running"}. Maintenance
              continues.
            </p>
          </form>
        ) : null}
        <OperationFeedback action={policy} />
      </section>
      <section className="space-y-4 border-t pt-5">
        <h3 className="font-semibold">Maintenance progress</h3>
        <p className="section-copy">
          This is a bounded view of queued work, not a global backlog total.
          Counts are lower bounds; no billing or CPU estimate is inferred.
        </p>
        <Button
          variant="outline"
          disabled={maintenance.busy}
          onClick={() =>
            void maintenance.read((signal) =>
              client.request("/operations/maintenance", { signal }),
            )
          }
        >
          Load maintenance status
        </Button>
        <OperationFeedback action={maintenance} />
        {maintenance.value ? (
          <>
            <p className="text-xs text-muted-foreground">
              Snapshot at {operationTime(maintenance.value.generatedAt)}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["indexing", "webhooks"] as const).map((kind) => {
                const value = maintenance.value![kind];
                return (
                  <article key={kind} className="rounded-xl border p-4">
                    <h4 className="font-semibold capitalize">{kind}</h4>
                    <p className="mt-2">
                      At least {value.pendingAtLeast} pending · at least{" "}
                      {value.dueAtLeast} due
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {value.hasMore
                        ? "Additional queued candidates exist."
                        : "No additional candidates in this bounded snapshot."}{" "}
                      Next due: {operationTime(value.nextDueAt)}
                    </p>
                  </article>
                );
              })}
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Last dispatch (UTC)</dt>
                <dd>
                  {operationTime(maintenance.value.progress?.lastDispatchAt)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  Last health evaluation (UTC)
                </dt>
                <dd>
                  {operationTime(maintenance.value.progress?.lastHealthAt)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Health due (UTC)</dt>
                <dd>{operationTime(maintenance.value.health?.dueAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Per-turn limits</dt>
                <dd>
                  {maintenance.value.turnLimits.backgroundCandidates} background
                  candidates · {maintenance.value.turnLimits.healthOwners}{" "}
                  health owners
                </dd>
              </div>
            </dl>
            <p className="section-copy">{maintenance.value.continuation}</p>
          </>
        ) : null}
      </section>
    </div>
  );
}
