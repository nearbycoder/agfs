import { createFileRoute } from "@tanstack/react-router";
import { StoragePage } from "~/components/platform/StoragePage";
export const Route = createFileRoute("/app/storage")({
  component: StoragePage,
});
