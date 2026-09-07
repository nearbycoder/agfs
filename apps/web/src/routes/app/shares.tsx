// @ts-nocheck
import { ShareReview } from "~/components/platform/ShareReview";
import { shareStatus } from "~/lib/share-overview";
import { useEffect, useEffectEvent, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, Link2, ShieldOff } from "lucide-react";
import { shareListResponseSchema } from "@agfs/contracts";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { NOINDEX_ROBOTS, buildSeoHead, pageTitle } from "~/lib/seo";

export const Route = createFileRoute("/app/shares")({
  head: () =>
    buildSeoHead({
      title: pageTitle("Shares"),
      description:
        "Review signed AGFS preview links, open shared artifacts, and revoke access instantly when a task is done.",
      robots: NOINDEX_ROBOTS,
    }),
  component: SharesPage,
});

function SharesPage() {
  const [shares, setShares] = useState<
    ReturnType<typeof shareListResponseSchema.parse>["shares"]
  >([]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const [error, setError] = useState<string | null>(null);

  const refresh = useEffectEvent(async () => {
    const response = await fetch("/api/v1/shares");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load shares");
    }

    const parsed = shareListResponseSchema.parse(payload);
    setShares(parsed.shares);
  });

  useEffect(() => {
    void refresh().catch((cause: unknown) => {
      setError(
        cause instanceof Error ? cause.message : "Failed to load shares",
      );
    });
  }, []);

  const activeCount = shares.filter(
    (share) => shareStatus(share, now) === "active",
  ).length;

  return (
    <div className="space-y-6">
      <header className="workspace-page-heading">
        <h1 className="dashboard-title">Shares</h1>
        <p className="section-copy mt-2">
          Manage the links you've shared. Revoke access at any time.
        </p>
        <p className="mt-5 inline-flex items-center gap-2 text-sm font-medium">
          <span className="size-2 rounded-full bg-primary" />
          {activeCount} active links
        </p>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Share request failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Issued shares</CardTitle>
          <CardDescription>
            Find a link by file path, check its expiry, or revoke selected
            links.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ShareReview shares={shares} refresh={refresh} />
        </CardContent>
      </Card>
    </div>
  );
}
