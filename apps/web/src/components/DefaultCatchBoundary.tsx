import type { ErrorComponentProps } from "@tanstack/react-router";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardDescription } from "./ui/card";
export function DefaultCatchBoundary(props: ErrorComponentProps) {
  return (
    <main className="status-shell">
      <Card className="w-full max-w-md p-3">
        <CardHeader>
          <AlertTriangle className="mb-4 size-7 text-destructive" />
          <h1 className="dashboard-title">Something went wrong</h1>
          <CardDescription>
            We couldn't finish loading this page. Try again, or return to your
            workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={() => props.reset()}>
            <RotateCw />
            Try again
          </Button>
          <Button asChild variant="outline">
            <a href="/app/files">Go to workspace</a>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
