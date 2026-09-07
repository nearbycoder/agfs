import { createFileRoute } from "@tanstack/react-router";
import { OperationsPage } from "~/components/platform/OperationsPage";
export const Route = createFileRoute("/app/operations")({
  component: OperationsPage,
});
