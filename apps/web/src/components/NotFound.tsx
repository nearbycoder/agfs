import { Link } from "@tanstack/react-router";
import { Compass } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

export function NotFound() {
  return (
    <main className="status-shell">
      <Card className="max-w-xl">
        <CardHeader>
          <Badge className="w-fit" variant="secondary">
            Route missing
          </Badge>
          <CardTitle className="flex items-center gap-3">
            <Compass className="size-5 text-zinc-500 dark:text-zinc-400" />
            Nothing lives at this address
          </CardTitle>
          <CardDescription>Jump back to the AGFS control plane and keep moving.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/">Return home</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
