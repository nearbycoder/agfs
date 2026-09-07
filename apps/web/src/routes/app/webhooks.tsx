import { createFileRoute } from "@tanstack/react-router";
import { WebhooksPage } from "~/components/platform/WebhooksPage";
export const Route = createFileRoute("/app/webhooks")({
  component: WebhooksPage,
});
