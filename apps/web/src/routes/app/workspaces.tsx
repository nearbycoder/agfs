import { createFileRoute } from "@tanstack/react-router";
import { WorkspacesPage } from "~/components/platform/WorkspacesPage";
export const Route = createFileRoute("/app/workspaces")({
  component: WorkspacesPage,
});
