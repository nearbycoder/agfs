import { createFileRoute } from "@tanstack/react-router";
import { RunsPage } from "~/components/platform/RunsPage";
import { normalizeRunSelection } from "~/lib/run-workflows";
export const Route = createFileRoute("/app/runs")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { inputs?: string; folder?: string } => ({
    inputs: normalizeRunSelection(search.inputs),
    folder:
      typeof search.folder === "string" && search.folder.startsWith("/")
        ? search.folder
        : undefined,
  }),
  component: RunRoute,
});
function RunRoute() {
  const search = Route.useSearch();
  return (
    <RunsPage initialInputs={search.inputs} initialFolder={search.folder} />
  );
}
