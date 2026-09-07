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
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_320px]">
        <Card>
          <CardHeader>
            <Badge className="w-fit" variant="secondary">
              Share links
            </Badge>
            <CardTitle className="dashboard-title">
              Preview URLs issued by AGFS.
            </CardTitle>
            <CardDescription>
              Review what has been shared recently, open a preview in a new tab,
              or revoke links once they’ve served their purpose.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
              <div className="flex items-center gap-3">
                <Link2 className="size-4 text-zinc-600 dark:text-zinc-300" />
                <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                  Active links
                </p>
              </div>
              <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-zinc-950 dark:text-zinc-50">
                {activeCount}
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
              <div className="flex items-center gap-3">
                <ShieldOff className="size-4 text-zinc-600 dark:text-zinc-300" />
                <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                  Revocation
                </p>
              </div>
              <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                Revoked links stop resolving immediately, even if their original
                expiry has not elapsed.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Badge className="w-fit" variant="secondary">
              Behavior
            </Badge>
            <CardTitle>Inline previews, not bucket URLs.</CardTitle>
            <CardDescription>
              AGFS streams shared files through the Worker so screenshots and
              images open directly while remaining revocable.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

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
            Each row maps a private file path to a signed AGFS preview URL.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ShareReview shares={shares} refresh={refresh} />
        </CardContent>
      </Card>
    </div>
  );
}
