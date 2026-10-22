import { lazy, Suspense, useState } from "react";
import { Button } from "~/components/ui/button";
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import {
  connectOperations,
  type OperationsClient,
} from "~/lib/browser-operations";
import { LoadingState } from "./shared";
import { OperationFeedback, useOperation } from "./OperationsShared";
import type { OperationAlert } from "./OperationsObservability";

const Indexing = lazy(() =>
  import("./OperationsIndexing").then((m) => ({
    default: m.OperationsIndexing,
  })),
);
const Background = lazy(() =>
  import("./OperationsBackground").then((m) => ({
    default: m.OperationsBackground,
  })),
);
const Uploads = lazy(() =>
  import("./OperationsUploads").then((m) => ({ default: m.OperationsUploads })),
);
const Budgets = lazy(() =>
  import("./OperationsBudgets").then((m) => ({ default: m.OperationsBudgets })),
);
const Retention = lazy(() =>
  import("./OperationsRetention").then((m) => ({
    default: m.OperationsRetention,
  })),
);
const Observability = lazy(() =>
  import("./OperationsObservability").then((m) => ({
    default: m.OperationsObservability,
  })),
);
export function OperationsControls({
  alerts,
  refreshHealth,
}: {
  alerts: OperationAlert[];
  refreshHealth: () => Promise<void>;
}) {
  const connection = useOperation<OperationsClient>(),
    [invalid, setInvalid] = useState(false);
  const client = invalid ? null : connection.value;
  const sections = [
    {
      id: "indexing",
      title: "Search & indexing",
      description:
        "Set content policy, inspect coverage, preview reindex work and retry failures.",
      component: Indexing,
    },
    {
      id: "background",
      title: "Background dispatch & maintenance",
      description: "Pause dispatch and inspect bounded queue progress.",
      component: Background,
    },
    {
      id: "uploads",
      title: "Upload reservations",
      description:
        "Review incomplete uploads and abandon selected reservations safely.",
      component: Uploads,
    },
    {
      id: "budgets",
      title: "Budget planning & batch edits",
      description:
        "Inspect daily usage, check a proposed workload and edit selected limits.",
      component: Budgets,
    },
    {
      id: "retention",
      title: "Retention & delivery history",
      description:
        "Understand retained objects and preview terminal delivery cleanup.",
      component: Retention,
    },
  ];
  return (
    <section className="space-y-4" aria-label="Resource controls">
      <p className="section-copy">
        Load the workspace identity once, then open the task you need. Views
        refresh only when requested. Actual changes recheck the account and
        workspace before applying.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {!client ? (
          <Button
            variant="outline"
            disabled={connection.busy}
            onClick={() => {
              setInvalid(false);
              connection.clear();
              void connection.read((signal) =>
                connectOperations(signal, () => setInvalid(true)),
              );
            }}
          >
            Connect workspace controls
          </Button>
        ) : null}
        {client ? (
          <p role="status" className="text-xs text-muted-foreground">
            Bound to{" "}
            {client.namespace.workspace === "personal"
              ? "your personal workspace"
              : client.namespace.workspace}
            .
          </p>
        ) : null}
      </div>
      <OperationFeedback action={connection} />
      {invalid ? (
        <p role="alert" className="text-sm text-destructive">
          Account or workspace changed. Reconnect controls and review the
          selected scope again.
        </p>
      ) : null}
      {client ? (
        <div
          key={client.namespace.actor + ":" + client.namespace.workspace}
          className="space-y-4"
        >
          {sections.map((section) => (
            <Disclosure key={section.id} lazy id={"operations-" + section.id}>
              <DisclosureSummary>
                <span>
                  <span className="block font-semibold">{section.title}</span>
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    {section.description}
                  </span>
                </span>
              </DisclosureSummary>
              <Suspense
                fallback={<LoadingState label={"Opening " + section.title} />}
              >
                <section.component client={client} />
              </Suspense>
            </Disclosure>
          ))}
          <Disclosure lazy>
            <DisclosureSummary>
              <span>
                <span className="block font-semibold">
                  Request metrics & alert attention
                </span>
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  Inspect elapsed latency, acknowledge alerts, and manage
                  snoozes.
                </span>
              </span>
            </DisclosureSummary>
            <Suspense
              fallback={<LoadingState label="Opening metrics and alerts" />}
            >
              <Observability
                client={client}
                alerts={alerts}
                refresh={refreshHealth}
              />
            </Suspense>
          </Disclosure>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Connect to enable on-demand resource controls. Owner/manage
          authorization is checked by the service.
        </p>
      )}
    </section>
  );
}
