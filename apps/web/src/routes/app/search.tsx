import { createFileRoute } from "@tanstack/react-router";
import { SearchPage } from "~/components/platform/SearchPage";
export const Route = createFileRoute("/app/search")({ component: SearchPage });
