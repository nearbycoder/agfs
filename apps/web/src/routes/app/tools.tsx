import { createFileRoute } from "@tanstack/react-router";
import { FileToolsPage } from "~/components/platform/FileToolsPage";
export const Route = createFileRoute("/app/tools")({
  component: FileToolsPage,
});
