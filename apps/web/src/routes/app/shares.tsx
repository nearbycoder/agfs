// @ts-nocheck
import { useEffect, useEffectEvent, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { shareListResponseSchema } from "@agfs/contracts";

export const Route = createFileRoute("/app/shares")({
  component: SharesPage,
});

function SharesPage() {
  const [shares, setShares] = useState<ReturnType<typeof shareListResponseSchema.parse>["shares"]>([]);
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
      setError(cause instanceof Error ? cause.message : "Failed to load shares");
    });
  }, [refresh]);

  async function handleRevoke(id: string) {
    const response = await fetch(`/api/v1/shares/${id}`, { method: "DELETE" });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "Failed to revoke share");
      return;
    }
    await refresh();
  }

  return (
    <div className="panel-stack">
      <section className="panel panel-header">
        <div>
          <p className="eyebrow">Share links</p>
          <h2>Preview URLs issued by AGFS.</h2>
        </div>
      </section>

      {error ? (
        <section className="panel panel-warning">
          <p>{error}</p>
        </section>
      ) : null}

      <section className="panel">
        <div className="table-head">
          <span>Path</span>
          <span>Expires</span>
          <span>Actions</span>
        </div>
        <div className="table-list">
          {shares.map((share) => (
            <article className="table-row" key={share.id}>
              <div>
                <strong>{share.path}</strong>
                <small>{share.url}</small>
              </div>
              <span>{share.revokedAt ? "Revoked" : share.expiresAt}</span>
              <div className="row-actions">
                <a className="button button-ghost" href={share.url} rel="noreferrer" target="_blank">
                  Open
                </a>
                {!share.revokedAt ? (
                  <button className="button button-ghost danger" onClick={() => handleRevoke(share.id)} type="button">
                    Revoke
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
