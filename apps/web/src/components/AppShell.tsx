import type { ReactNode } from "react";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { authClient } from "~/lib/auth-client";

export function AppShell() {
  const location = useLocation();
  const session = authClient.useSession();

  async function handleSignOut() {
    await authClient.signOut();
    window.location.href = "/";
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div>
          <p className="eyebrow">AgentFilesystem</p>
          <h1>Control plane</h1>
          <p className="muted">Private storage for agents, browsers, and headless machines.</p>
        </div>
        <nav className="app-nav">
          <Link className={location.pathname.startsWith("/app/files") ? "active" : ""} to="/app/files">
            Files
          </Link>
          <Link className={location.pathname.startsWith("/app/tokens") ? "active" : ""} to="/app/tokens">
            Tokens
          </Link>
          <Link className={location.pathname.startsWith("/app/shares") ? "active" : ""} to="/app/shares">
            Shares
          </Link>
        </nav>
        <div className="session-block">
          <p className="label">Signed in as</p>
          <strong>{session.data?.user.email ?? "unknown"}</strong>
          <button className="button button-secondary" onClick={handleSignOut} type="button">
            Sign out
          </button>
        </div>
      </aside>
      <section className="app-content">
        <Outlet />
      </section>
    </div>
  );
}
