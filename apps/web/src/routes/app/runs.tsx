import { createFileRoute } from "@tanstack/react-router";
import { RunsPage } from "~/components/platform/RunsPage";
export const Route = createFileRoute("/app/runs")({ component: RunsPage });
