// @ts-nocheck
import type { FormEvent } from "react";
import { useEffect, useEffectEvent, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { tokenListResponseSchema } from "@agfs/contracts";

export const Route = createFileRoute("/app/tokens")({
  component: TokensPage,
});

function TokensPage() {
  const [tokens, setTokens] = useState<ReturnType<typeof tokenListResponseSchema.parse>["tokens"]>([]);
  const [label, setLabel] = useState("");
  const [ttl, setTtl] = useState("7d");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useEffectEvent(async () => {
    const response = await fetch("/api/v1/tokens");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load tokens");
    }

    const parsed = tokenListResponseSchema.parse(payload);
    setTokens(parsed.tokens);
  });

  useEffect(() => {
    void refresh().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Failed to load tokens");
    });
  }, [refresh]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSecret(null);
    const response = await fetch("/api/v1/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label, ttl }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "Failed to create token");
      return;
    }
    setSecret(payload.token);
    setLabel("");
    await refresh();
  }

  async function handleRevoke(id: string) {
    setError(null);
    const response = await fetch(`/api/v1/tokens/${id}`, { method: "DELETE" });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "Failed to revoke token");
      return;
    }
    await refresh();
  }

  return (
    <div className="panel-stack">
      <section className="panel panel-header">
        <div>
          <p className="eyebrow">Agent tokens</p>
          <h2>Headless access for remote workers.</h2>
        </div>
      </section>

      {secret ? (
        <section className="panel panel-accent">
          <p className="eyebrow">Copy this now</p>
          <code>{secret}</code>
        </section>
      ) : null}

      {error ? (
        <section className="panel panel-warning">
          <p>{error}</p>
        </section>
      ) : null}

      <section className="panel">
        <form className="inline-form" onSubmit={handleCreate}>
          <input onChange={(event) => setLabel(event.target.value)} placeholder="Build runner" value={label} />
          <input onChange={(event) => setTtl(event.target.value)} placeholder="7d" value={ttl} />
          <button className="button button-primary" type="submit">
            Create token
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="table-head">
          <span>Label</span>
          <span>Status</span>
          <span>Actions</span>
        </div>
        <div className="table-list">
          {tokens.map((token) => (
            <article className="table-row" key={token.id}>
              <div>
                <strong>{token.label}</strong>
                <small>{token.prefix}</small>
              </div>
              <span>{token.revokedAt ? "Revoked" : token.expiresAt ? `Expires ${token.expiresAt}` : "Active"}</span>
              <div className="row-actions">
                {!token.revokedAt ? (
                  <button className="button button-ghost danger" onClick={() => handleRevoke(token.id)} type="button">
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
