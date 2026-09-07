import { createFileRoute } from "@tanstack/react-router";
import { BudgetsPage } from "~/components/platform/BudgetsPage";
export const Route = createFileRoute("/app/budgets")({
  component: BudgetsPage,
});
