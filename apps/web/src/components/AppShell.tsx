import { useEffect, useState } from "react";
import { accountSummarySchema, type AccountSummary } from "@agfs/contracts";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import {
  Search,
  Users,
  Play,
  FileCheck,
  Webhook,
  Gauge,
  FolderKanban,
  HardDrive,
  KeyRound,
  Link2,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { authClient } from "~/lib/auth-client";
import { Button, buttonVariants } from "~/components/ui/button";
import { formatBytes } from "~/lib/format";
import { cn } from "~/lib/utils";
const navigation = [
  { href: "/app/library", icon: FolderKanban, label: "Library" },
  { href: "/app/files", icon: FolderKanban, label: "Files" },
  { href: "/app/search", icon: Search, label: "Search" },
  { href: "/app/workspaces", icon: Users, label: "Workspaces" },
  { href: "/app/runs", icon: Play, label: "Agent runs" },
  { href: "/app/drafts", icon: FileCheck, label: "Draft changes" },
  { href: "/app/tokens", icon: KeyRound, label: "Tokens" },
  { href: "/app/operations", icon: Gauge, label: "Operations & recovery" },
  { href: "/app/budgets", icon: Gauge, label: "Agent budgets" },
  { href: "/app/webhooks", icon: Webhook, label: "Webhooks" },
  { href: "/app/recovery", icon: HardDrive, label: "Trash & versions" },
  { href: "/app/activity", icon: ShieldCheck, label: "Activity" },
  { href: "/app/shares", icon: Link2, label: "Shares" },
];
export function AppShell() {
  const location = useLocation(),
    session = authClient.useSession();
  const [account, setAccount] = useState<AccountSummary | null>(null),
    [error, setError] = useState(""),
    [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]),
    [workspace, setWorkspace] = useState("personal"),
    [switching, setSwitching] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    async function get(url: string) {
      const r = await fetch(url, { signal: c.signal });
      const value = await r.json();
      if (!r.ok) throw new Error(value.error ?? "Could not load workspace");
      return value;
    }
    void get("/api/v1/platform/workspaces")
      .then((v) => {
        if (!c.signal.aborted) setWorkspaces(v.workspaces);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    void Promise.all([get("/api/v1/account"), get("/api/v1/whoami")])
      .then(([a, b]) => {
        if (!c.signal.aborted) {
          setAccount(accountSummarySchema.parse(a));
          setWorkspace(b.workspaceId ?? "personal");
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(e.message);
          setWorkspace("unavailable");
        }
      });
    return () => c.abort();
  }, [session.data?.user.id]);
  async function selectWorkspace(selected: string) {
    setSwitching(true);
    setError("");
    try {
      const r = await fetch("/api/v1/platform/workspaces/select", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace: selected }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not switch workspace");
      setSwitching(false);
    }
  }
  const ratio = account
    ? Math.min(
        100,
        (100 * account.storageUsedBytes) /
          Math.max(1, account.storageLimitBytes),
      )
    : 0;
  return (
    <div className="page-shell grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="surface-panel flex h-fit flex-col gap-5 p-5 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
        <label className="grid gap-2 text-sm font-medium">
          Workspace
          <select
            aria-label="Active workspace"
            className="w-full rounded-lg border bg-transparent p-2"
            disabled={switching}
            value={workspace}
            onChange={(e) => void selectWorkspace(e.target.value)}
          >
            {workspace === "unavailable" ? (
              <option value="unavailable" disabled>
                Choose a workspace
              </option>
            ) : null}
            <option value="personal">Personal</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}
        <nav
          aria-label="Workspace navigation"
          className="grid grid-cols-2 gap-1 lg:grid-cols-1"
        >
          {navigation.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                buttonVariants({
                  variant: location.pathname.startsWith(item.href)
                    ? "secondary"
                    : "ghost",
                }),
                "h-9 justify-start gap-3 rounded-lg px-3 text-sm",
              )}
            >
              <item.icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          ))}
        </nav>
        {account ? (
          <details className="rounded-xl border p-3">
            <summary className="cursor-pointer text-sm">
              {formatBytes(account.storageUsedBytes)} /{" "}
              {formatBytes(account.storageLimitBytes)}
            </summary>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-full bg-zinc-950 dark:bg-zinc-100"
                style={{ width: ratio + "%" }}
              />
            </div>
            <p className="mt-3 text-xs text-zinc-500">
              {account.planName} plan ·{" "}
              {formatBytes(account.storageRemainingBytes)} remaining. Retained
              versions count toward storage.
            </p>
          </details>
        ) : null}
        <div className="border-t pt-4">
          <p className="truncate text-xs text-zinc-500">
            {session.data?.user.email}
          </p>
          <Button
            className="mt-3 w-full"
            size="sm"
            variant="outline"
            onClick={() =>
              void authClient.signOut().then(() => {
                window.location.href = "/";
              })
            }
          >
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
