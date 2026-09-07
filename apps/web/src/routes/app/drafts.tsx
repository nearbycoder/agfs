import { createFileRoute } from "@tanstack/react-router";
import { DraftsPage } from "~/components/platform/DraftsPage";
export const Route = createFileRoute("/app/drafts")({ component: DraftsPage });
