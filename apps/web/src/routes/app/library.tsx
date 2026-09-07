import { createFileRoute } from "@tanstack/react-router";
import { LibraryPage } from "~/components/platform/LibraryPage";
export const Route = createFileRoute("/app/library")({
  component: LibraryPage,
});
