import { useEffect, useEffectEvent, useState } from "react";
import { accountSummarySchema, type AccountSummary } from "@agfs/contracts";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { ChevronRight, FolderKanban, HardDrive, KeyRound, Link2, LogOut, ShieldCheck, Sparkles } from "lucide-react";
import { authClient } from "~/lib/auth-client";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { formatBytes, formatMonthlyPrice } from "~/lib/format";
import { STORAGE_PLANS } from "~/lib/storage-plans";
import { cn } from "~/lib/utils";

export function AppShell() {
  const location = useLocation();
  const session = authClient.useSession();
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const navItems = [
    { href: "/app/files", icon: FolderKanban, label: "Files", match: "/app/files" },
    { href: "/app/tokens", icon: KeyRound, label: "Tokens", match: "/app/tokens" },
    { href: "/app/shares", icon: Link2, label: "Shares", match: "/app/shares" },
  ];
  const paidPlan = STORAGE_PLANS.paid;
  const usageRatio = account ? Math.min((account.storageUsedBytes / account.storageLimitBytes) * 100, 100) : 0;
  const overageBytes = account ? Math.max(account.storageUsedBytes - account.storageLimitBytes, 0) : 0;

  const refreshAccount = useEffectEvent(async () => {
    const response = await fetch("/api/v1/account");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load account details");
    }

    setAccount(accountSummarySchema.parse(payload));
  });

  useEffect(() => {
    setAccountError(null);
    void refreshAccount().catch((cause: unknown) => {
      setAccountError(cause instanceof Error ? cause.message : "Failed to load account details");
    });
  }, [refreshAccount]);

  async function handleSignOut() {
    await authClient.signOut();
    window.location.href = "/";
  }

  return (
    <div className="page-shell grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="surface-panel flex h-fit flex-col gap-6 p-5 lg:sticky lg:top-24">
        <div className="space-y-4">
          <Badge variant="secondary">Private namespace</Badge>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-[-0.04em] text-zinc-950 dark:text-zinc-50">AGFS control plane</h1>
            <p className="section-copy">Artifacts, preview links, and agent credentials for one account-scoped filesystem.</p>
          </div>
          <Card className="border-dashed bg-zinc-50/80 p-4 shadow-none dark:border-zinc-800 dark:bg-zinc-900/70">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 size-4 text-zinc-500 dark:text-zinc-400" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Isolated by owner</p>
                <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">D1 enforces ownership, and R2 objects stay namespaced per user.</p>
              </div>
            </div>
          </Card>

          <Card className="border-dashed bg-zinc-50/80 p-4 shadow-none dark:border-zinc-800 dark:bg-zinc-900/70">
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Plan and storage</p>
                  <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">Current quota and the upcoming paid tier.</p>
                </div>
                <HardDrive className="size-4 text-zinc-500 dark:text-zinc-400" />
              </div>

              {account ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <Badge variant={account.planId === "paid" ? "success" : "secondary"}>{account.planName}</Badge>
                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500">
                      {formatBytes(account.storageUsedBytes)} / {formatBytes(account.storageLimitBytes)}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                      <div
                        className={cn("h-full rounded-full", account.isOverLimit ? "bg-amber-500" : "bg-zinc-950 dark:bg-zinc-100")}
                        style={{ width: `${usageRatio}%` }}
                      />
                    </div>
                    <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                      {account.isOverLimit
                        ? `Over limit by ${formatBytes(overageBytes)}. Delete files or replace them with smaller ones to keep uploading.`
                        : `${formatBytes(account.storageRemainingBytes)} remaining on your ${account.planName.toLowerCase()} plan.`}
                    </p>
                  </div>

                  {account.planId === "free" ? (
                    <div className="rounded-xl border border-zinc-200 bg-white/90 p-3 dark:border-zinc-800 dark:bg-zinc-950/75">
                      <div className="flex items-center gap-2">
                        <Sparkles className="size-4 text-zinc-500 dark:text-zinc-400" />
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Paid plan coming soon</p>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                        {formatBytes(paidPlan.storageLimitBytes)} for {formatMonthlyPrice(paidPlan.priceMonthlyCents ?? 0)}/month via Stripe.
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                      You&apos;re on the Paid plan today. Self-serve Stripe billing is still coming soon.
                    </p>
                  )}
                </div>
              ) : accountError ? (
                <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">{accountError}</p>
              ) : (
                <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">Loading your current plan and storage usage.</p>
              )}
            </div>
          </Card>
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname.startsWith(item.match);

            return (
              <Link
                className={cn(
                  buttonVariants({ variant: isActive ? "secondary" : "ghost" }),
                  "h-11 w-full justify-between rounded-xl px-3",
                )}
                key={item.href}
                to={item.href}
              >
                <span className="flex items-center gap-3">
                  <item.icon className="size-4" />
                  {item.label}
                </span>
                <ChevronRight className="size-4 text-zinc-400 dark:text-zinc-500" />
              </Link>
            );
          })}
        </nav>

        <div className="rounded-xl border border-zinc-200 bg-white/90 p-4 dark:border-zinc-800 dark:bg-zinc-950/75">
          <p className="section-label">Signed in as</p>
          <p className="mt-2 text-sm font-medium text-zinc-950 dark:text-zinc-50">{session.data?.user.email ?? "unknown"}</p>
          <p className="mt-1 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            {session.data?.user.name ? `${session.data.user.name} is connected through GitHub.` : "GitHub session active."}
          </p>
          <Button className="mt-4 w-full" onClick={handleSignOut} type="button" variant="outline">
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      </aside>

      <section className="min-w-0">
        <Outlet />
      </section>
    </div>
  );
}
