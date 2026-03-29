// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { CodeWindow } from "~/components/CodeWindow";

export const Route = createFileRoute("/cli")({
  component: CliPage,
});

function CliPage() {
  return (
    <main className="docs-page">
      <section className="docs-hero">
        <p className="eyebrow">CLI workflow</p>
        <h1>Use AGFS from a laptop, a CI job, or a remote agent host.</h1>
        <p>
          The v1 CLI is a Node package with device auth, token auth, upload/download, folder management, and share link
          generation built on the same `/api/v1` contract as the web app.
        </p>
      </section>

      <div className="docs-grid">
        <CodeWindow title="Install">
          {`pnpm add -g @agfs/cli
agfs login
agfs whoami`}
        </CodeWindow>
        <CodeWindow title="Core commands">
          {`agfs ls /
agfs tree /screenshots
agfs mkdir /sessions/run-42
agfs upload ./shot.png /sessions/run-42/shot.png --share 1h
agfs download /sessions/run-42 ./run-42
agfs download /sessions/run-42/shot.png ./shot.png
agfs rm /sessions/run-42 --recursive`}
        </CodeWindow>
      </div>
    </main>
  );
}
