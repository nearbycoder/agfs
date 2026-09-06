import type { ErrorComponentProps } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

export function DefaultCatchBoundary(props: ErrorComponentProps) {
  return (
    <main className="status-shell">
      <Card className="max-w-2xl">
        <CardHeader>
          <Badge className="w-fit" variant="warning">
            System fault
          </Badge>
          <CardTitle className="flex items-center gap-3">
            <AlertTriangle className="size-5 text-amber-600" />
            {props.error instanceof Error ? props.error.message : "Request failed"}
          </CardTitle>
          <CardDescription>
            The request did not complete cleanly. Refresh the page or inspect the Worker logs.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
          AGFS is designed to stream files and metadata through the same control plane, so deployment mismatches and
          missing bindings usually surface quickly here.
        </CardContent>
      </Card>
    </main>
  );
}
