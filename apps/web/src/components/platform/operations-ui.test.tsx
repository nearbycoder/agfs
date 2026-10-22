import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OperationsControls } from "./OperationsControls";
import { OperationsIndexing } from "./OperationsIndexing";
import { OperationsBackground } from "./OperationsBackground";
import { OperationsUploads } from "./OperationsUploads";
import { BudgetTokenPage, OperationsBudgets } from "./OperationsBudgets";
import { OperationsRetention } from "./OperationsRetention";
import { OperationsObservability } from "./OperationsObservability";
import {
  MoreOperations,
  OperationFeedback,
  OperationTable,
  toggleOperationSelection,
} from "./OperationsShared";
import type { OperationsClient } from "~/lib/browser-operations";
import type { BudgetTokenSummary } from "@agfs/contracts";

afterEach(() => vi.unstubAllGlobals());
it("does not fan out endpoint requests or perform mutations when controls render", () => {
  const fetch = vi.fn(() => {
    throw new Error("Unexpected automatic request");
  });
  vi.stubGlobal("fetch", fetch);
  const request = vi.fn(() => {
    throw new Error("Unexpected automatic operation");
  });
  const client: OperationsClient = {
    namespace: { actor: "actor", workspace: "personal" },
    request,
  };
  const refresh = vi.fn(async () => {});
  const controls = renderToStaticMarkup(
    <OperationsControls alerts={[]} refreshHealth={refresh} />,
  );
  expect(controls).toContain("Connect workspace controls");
  expect(controls).not.toContain("Apply reviewed");
  for (const element of [
    <OperationsIndexing client={client} />,
    <OperationsBackground client={client} />,
    <OperationsUploads client={client} />,
    <OperationsBudgets client={client} />,
    <OperationsRetention client={client} />,
    <OperationsObservability client={client} alerts={[]} refresh={refresh} />,
  ])
    renderToStaticMarkup(element);
  expect(fetch).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});
it("keeps next-page navigation visible after an empty filtered page", () => {
  const html = renderToStaticMarkup(
    <MoreOperations
      page={{ results: [], nextCursor: "more" }}
      busy={false}
      load={() => {}}
    />,
  );
  expect(html).toContain("Load next page");
  expect(html).not.toContain('disabled=""');
  expect(
    renderToStaticMarkup(
      <MoreOperations
        page={{ results: [], nextCursor: null }}
        busy={false}
        load={() => {}}
      />,
    ),
  ).toBe("");
});
it("bounds table rendering, exposes selection labels and escapes untrusted errors", () => {
  const rows = Array.from({ length: 500 }, (_, id) => ({
    id: String(id),
    error: "<script>unsafe</script>",
  }));
  const html = renderToStaticMarkup(
    <OperationTable
      label="Failure review"
      rows={rows}
      rowKey={(row) => row.id}
      columns={[{ label: "Error", render: (row) => row.error }]}
      selected={["0"]}
      onSelect={() => {}}
    />,
  );
  expect(html.match(/<tr\b/g)).toHaveLength(101);
  expect(html).toContain("Page 1 of 5");
  expect(html).toContain('aria-label="Select 0"');
  expect(html).not.toContain("<script>");
  expect(toggleOperationSelection(["a"], "b", true, 1)).toEqual(["a"]);
  expect(toggleOperationSelection(["a"], "a", false, 1)).toEqual([]);
});
it("labels lower-bound, advisory, latency and retained-byte semantics honestly", () => {
  const client: OperationsClient = {
    namespace: { actor: "actor", workspace: "personal" },
    request: async () => {
      throw new Error("not called");
    },
  };
  expect(
    renderToStaticMarkup(<OperationsBackground client={client} />),
  ).toContain("Counts are lower bounds");
  expect(renderToStaticMarkup(<OperationsBudgets client={client} />)).toContain(
    "preflight is advisory",
  );
  expect(
    renderToStaticMarkup(
      <OperationsObservability
        client={client}
        alerts={[]}
        refresh={async () => {}}
      />,
    ),
  ).toContain("not CPU time");
  expect(renderToStaticMarkup(<OperationsUploads client={client} />)).toContain(
    "never refunds the daily upload budget",
  );
});

it("keeps alert controls lazy while exposing snoozed and acknowledged states", () => {
  const request = vi.fn(async () => {
    throw new Error("Unexpected request");
  });
  const html = renderToStaticMarkup(
    <OperationsObservability
      client={{ namespace: { actor: "actor", workspace: "personal" }, request }}
      alerts={[
        {
          id: "alert_a",
          message: "Index backlog",
          resolved_at: null,
          created_at: 1,
          acknowledgedAt: 2,
          acknowledgedBy: "actor",
          note: "Investigating",
          snoozedUntil: 100,
          visible: 0,
        },
      ]}
      refresh={async () => {}}
    />,
  );
  expect(html).toContain("Index backlog");
  expect(html).toContain("Snoozed");
  expect(html).toContain("Acknowledged");
  expect(html).not.toContain("Acknowledgement note");
  expect(html).not.toContain("Snooze minutes");
  expect(request).not.toHaveBeenCalled();
});

it("offers cancellation only for reads and exposes focusable authorization errors", () => {
  const feedback = (reading: boolean, writing: boolean, error = "") =>
    renderToStaticMarkup(
      <OperationFeedback
        action={{ reading, writing, error, cancel: () => {} }}
      />,
    );
  expect(feedback(true, false)).toContain("Cancel loading");
  expect(feedback(false, true)).not.toContain("Cancel loading");
  expect(feedback(false, true)).toContain("Keep this page open");
  const denied = feedback(
    false,
    false,
    "Access denied. Owner/manage permission is required.",
  );
  expect(denied).toContain('role="alert"');
  expect(denied).toContain('tabindex="-1"');
  expect(denied).toContain("Owner/manage permission is required");
});

it("offers next-token-page navigation even when the metadata page is empty", () => {
  const html = renderToStaticMarkup(
    <BudgetTokenPage
      page={{ results: [], nextCursor: "next" }}
      selected={["off_page_draft"]}
      busy={false}
      choose={() => {}}
      select={() => {}}
      next={() => {}}
    />,
  );
  expect(html).toContain("No non-revoked agent tokens");
  expect(html).toContain("Load next token page");
  expect(html).toContain("1/20 selected");
  expect(html).not.toContain('disabled=""');
});

it("renders one 50-token metadata page with distinct unlimited and zero limits", () => {
  const results: BudgetTokenSummary[] = Array.from({ length: 50 }, (_, i) => ({
    id: "tok_" + i,
    label: "Agent " + i,
    pathPrefix: "/work",
    paused: i === 0,
    storageLimit: null,
    uploadLimit: 0,
    operationLimit: 0,
  }));
  const html = renderToStaticMarkup(
    <BudgetTokenPage
      page={{ results, nextCursor: "next" }}
      selected={["tok_0", "off_page"]}
      busy={false}
      choose={() => {}}
      select={() => {}}
      next={() => {}}
    />,
  );
  expect(html.match(/<tr\b/g)).toHaveLength(51);
  expect(html).toContain("Budget paused");
  expect(html).toContain("Budget enabled");
  expect(html).toContain("Storage: Unlimited");
  expect(html).toContain("Daily uploads: 0 B");
  expect(html).toContain("Daily operations: 0");
  expect(html).toContain(
    'aria-label="Use Agent 0 (tok_0) for history and planning"',
  );
  expect(html).not.toContain("Operations today");
  expect(html).not.toContain("Active");
});
