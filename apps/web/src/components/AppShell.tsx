import { Select, SelectItem } from "~/components/ui/select";
import { Brand } from "./Brand";
import { ThemeToggle } from "./ThemeToggle";
import { CommandPalette } from "./CommandPalette";
import { useEffect, useState, useRef } from "react";
import { accountSummarySchema, type AccountSummary } from "@agfs/contracts";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import {
  Menu,
  X,
  BookOpen,
  Folder,
  Star,
  Search,
  Users,
  Play,
  FileCheck,
  Webhook,
  Gauge,
  HardDrive,
  KeyRound,
  Link2,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { authClient } from "~/lib/auth-client";
import { Button } from "~/components/ui/button";
import { formatBytes } from "~/lib/format";
const groups = [
  {
    label: "Workspace",
    items: [
      { href: "/app/files", icon: Folder, label: "Files" },
      { href: "/app/library", icon: Star, label: "Library" },
      { href: "/app/search", icon: Search, label: "Search" },
      { href: "/app/tools", icon: FileCheck, label: "File tools" },
      { href: "/app/shares", icon: Link2, label: "Shares" },
    ],
  },
  {
    label: "Automation",
    items: [
      { href: "/app/runs", icon: Play, label: "Agent runs" },
      { href: "/app/drafts", icon: FileCheck, label: "Draft changes" },
      { href: "/app/tokens", icon: KeyRound, label: "Tokens" },
      { href: "/app/budgets", icon: Gauge, label: "Agent budgets" },
      { href: "/app/webhooks", icon: Webhook, label: "Webhooks" },
    ],
  },
  {
    label: "Manage",
    items: [
      { href: "/app/workspaces", icon: Users, label: "Workspaces" },
      { href: "/app/storage", icon: HardDrive, label: "Storage insights" },
      { href: "/app/activity", icon: ShieldCheck, label: "Activity" },
      { href: "/app/recovery", icon: HardDrive, label: "Trash & versions" },
      { href: "/app/operations", icon: Gauge, label: "Operations & recovery" },
    ],
  },
];
const navigation = groups.flatMap((group) => group.items);
export function AppShell() {
  const mobileNav = useRef<HTMLDialogElement>(null);
  const location = useLocation(),
    session = authClient.useSession();
  const [account, setAccount] = useState<AccountSummary | null>(null),
    [error, setError] = useState(""),
    [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]),
    [workspace, setWorkspace] = useState("personal"),
    [switching, setSwitching] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    async function get(url: string, optionalOwnerData = false) {
      const r = await fetch(url, { signal: c.signal });
      if (optionalOwnerData && r.status === 403) return null;
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
    // Account totals are owner-only. Their availability must not decide
    // whether an editor/viewer's selected workspace can be displayed.
    void get("/api/v1/account", true)
      .then((value) => {
        if (!c.signal.aborted)
          setAccount(value ? accountSummarySchema.parse(value) : null);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    void get("/api/v1/whoami")
      .then((value) => {
        if (!c.signal.aborted) setWorkspace(value.workspaceId ?? "personal");
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(e.message);
          setWorkspace("unavailable");
        }
      });
    return () => c.abort();
  }, [session.data?.user.id]);
  useEffect(() => {
    mobileNav.current?.close();
  }, [location.pathname, location.hash]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const close = () => {
      if (desktop.matches) mobileNav.current?.close();
    };
    desktop.addEventListener("change", close);
    return () => desktop.removeEventListener("change", close);
  }, []);
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
  function sidebar() {
    return (
      <>
        <div className="flex h-16 shrink-0 items-center justify-between border-b px-5">
          <Brand />
          <Button
            className="lg:hidden"
            variant="ghost"
            size="icon"
            aria-label="Close navigation"
            onClick={() => mobileNav.current?.close()}
          >
            <X />
          </Button>
        </div>
        <div className="px-4 pt-5">
          <label className="grid gap-2 text-xs font-medium text-muted-foreground">
            Workspace
            <Select
              aria-label="Active workspace"
              disabled={switching}
              value={workspace}
              onValueChange={(value) => void selectWorkspace(value)}
            >
              {workspace === "unavailable" ? (
                <SelectItem value="unavailable" disabled>
                  Choose a workspace
                </SelectItem>
              ) : null}
              <SelectItem value="personal">Personal workspace</SelectItem>
              {workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </Select>
          </label>
          {error ? (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <nav aria-label="Workspace navigation" className="workspace-nav">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="workspace-nav-label">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <Link
                    key={item.href}
                    to={item.href}
                    className="workspace-link"
                    aria-current={
                      location.pathname.startsWith(item.href)
                        ? "page"
                        : undefined
                    }
                  >
                    <item.icon className="size-4 shrink-0" />
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="shrink-0 border-t p-4">
          {account ? (
            <Link
              to="/app/storage"
              className="mb-4 block rounded-lg bg-muted/50 p-3"
            >
              <div className="flex justify-between text-xs">
                <span>Storage</span>
                <span>{Math.round(ratio)}%</span>
              </div>
              <div
                className="my-2 h-1 overflow-hidden rounded-full bg-border"
                role="meter"
                aria-label="Storage used"
                aria-valuenow={Math.round(ratio)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full bg-primary"
                  style={{ width: ratio + "%" }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {formatBytes(account.storageUsedBytes)} of{" "}
                {formatBytes(account.storageLimitBytes)} · {account.planName}
              </p>
            </Link>
          ) : null}
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground"
            >
              {(session.data?.user.name || session.data?.user.email || "A")
                .slice(0, 1)
                .toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">
                {session.data?.user.name || "Your account"}
              </p>
              <p className="truncate text-[10px] text-muted-foreground">
                {session.data?.user.email}
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Sign out"
              onClick={() =>
                void authClient.signOut().then(() => {
                  window.location.href = "/";
                })
              }
            >
              <LogOut />
            </Button>
          </div>
        </div>
      </>
    );
  }
  const activeGroup = groups.find((g) =>
    g.items.some((i) => location.pathname.startsWith(i.href)),
  );
  return (
    <div className="workspace-layout">
      <aside className="workspace-sidebar">{sidebar()}</aside>
      <dialog
        ref={mobileNav}
        aria-label="Workspace menu"
        className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-72 max-w-[90vw] border-r bg-card p-0 text-foreground open:flex open:flex-col"
        onClick={(e) => {
          if (e.target === mobileNav.current) mobileNav.current.close();
        }}
      >
        {sidebar()}
      </dialog>
      <header className="workspace-topbar">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            size="icon"
            variant="ghost"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => mobileNav.current?.showModal()}
          >
            <Menu />
          </Button>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {activeGroup?.label}
          </span>
          <span className="hidden text-border sm:inline">/</span>
          <span className="truncate text-sm font-medium">
            {navigation.find((i) => location.pathname.startsWith(i.href))
              ?.label ?? "Workspace"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <CommandPalette navigation={navigation} />
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="hidden sm:inline-flex"
          >
            <Link to="/cli" aria-label="CLI documentation">
              <BookOpen />
            </Link>
          </Button>
          <ThemeToggle />
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="workspace-content">
        <Outlet />
      </main>
    </div>
  );
}
