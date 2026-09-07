import { Link } from "@tanstack/react-router";
import { Compass } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

export function NotFound() {
  return (
    <main className="status-shell">
      <Card className="max-w-xl">
        <CardHeader>
          <Badge className="w-fit" variant="secondary">
            404 · Page not found
          </Badge>
          <h1 className="flex items-center gap-3 text-xl font-semibold">
            <Compass className="size-5 text-zinc-500 dark:text-zinc-400" />
            Nothing lives at this address
          </h1>
          <CardDescription>
            This link may have moved. Head home to find your workspace or the
            setup guide.
          </CardDescription>
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
