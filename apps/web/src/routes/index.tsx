// @ts-nocheck
import { Link, createFileRoute } from "@tanstack/react-router";
import { authClient } from "~/lib/auth-client";
import { CodeWindow } from "~/components/CodeWindow";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const session = authClient.useSession();

  async function handleSignIn() {
    await authClient.signIn.social({
      provider: "github",
      callbackURL: "/app/files",
    });
  }

  return (
    <main className="landing">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Cloudflare-native storage for agents</p>
          <h1>Your remote agent’s filesystem, but actually reachable.</h1>
          <p className="hero-body">
            AGFS gives every GitHub user a private file namespace backed by R2, surfaced through a browser control
            plane and an automation-friendly CLI. Agents can upload screenshots, logs, and artifacts, then hand back a
            live preview link you can open from anywhere.
          </p>
          <div className="hero-actions">
            <button className="button button-primary" onClick={handleSignIn} type="button">
              {session.data?.user ? "Open workspace" : "Sign in with GitHub"}
            </button>
            <Link className="button button-secondary" to="/cli">
              View CLI docs
            </Link>
          </div>
          <div className="metric-grid">
            <article>
              <strong>R2-backed</strong>
              <span>Direct uploads, streamed previews, no raw bucket links leaked.</span>
            </article>
            <article>
              <strong>CLI first</strong>
              <span>Device login, API tokens, and readable output for agents and humans.</span>
            </article>
            <article>
              <strong>User isolated</strong>
              <span>Owner-scoped metadata in D1 and namespaced object keys in R2.</span>
            </article>
          </div>
        </div>
        <CodeWindow title="Remote screenshot flow">
          {`$ agfs upload ./artifacts/screenshot.png screenshots/landing.png --share 1h
Uploaded /screenshots/landing.png
Share URL: https://agfs.dev/s/agfssh_4SCQm0...

$ agfs ls /screenshots
landing.png    381 kB    image/png`}
        </CodeWindow>
      </section>

      <section className="feature-band">
        <article className="feature-card">
          <p className="eyebrow">Preview links</p>
          <h2>Clickable URLs that agents can hand back immediately.</h2>
          <p>
            Share URLs stay on `agfs.dev`, expire automatically, and stream inline so screenshots and images open
            directly in the browser.
          </p>
        </article>
        <article className="feature-card">
          <p className="eyebrow">Device auth</p>
          <h2>Interactive where needed, headless where it counts.</h2>
          <p>
            Use the browser approval flow for a quick CLI login, then issue long-lived agent tokens for remote
            automation.
          </p>
        </article>
        <article className="feature-card">
          <p className="eyebrow">Filesystem model</p>
          <h2>Folders in D1, bytes in R2, stable IDs underneath.</h2>
          <p>
            Renames and moves update metadata without forcing object copies, and per-user isolation is enforced in both
            the object store and the database.
          </p>
        </article>
      </section>
    </main>
  );
}
