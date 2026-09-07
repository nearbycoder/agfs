// @ts-nocheck
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { ActionMenu, ActionMenuItem } from "~/components/ui/action-menu";
import { LoadingState, DetailSurface } from "~/components/platform/shared";
import { Select, SelectItem } from "~/components/ui/select";
import type { FormEvent } from "react";
import { useEffect, useEffectEvent, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { tokenListResponseSchema } from "@agfs/contracts";
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
import { Input } from "~/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { NOINDEX_ROBOTS, buildSeoHead, pageTitle } from "~/lib/seo";

export const Route = createFileRoute("/app/tokens")({
  head: () =>
    buildSeoHead({
      title: pageTitle("Tokens"),
      description:
        "Create and revoke AGFS tokens for CI jobs, remote agents, and unattended automation without exposing bucket credentials.",
      robots: NOINDEX_ROBOTS,
    }),
  component: TokensPage,
});

function TokensPage() {
  const [tokens, setTokens] = useState<
    ReturnType<typeof tokenListResponseSchema.parse>["tokens"]
  >([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [ttl, setTtl] = useState("30d");
  const [pathPrefix, setPathPrefix] = useState("/");
  const [permissionPreset, setPermissionPreset] = useState("read");
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
    void refresh()
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error ? cause.message : "Failed to load tokens",
        );
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSecret(null);

    const response = await fetch("/api/v1/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label,
        ttl,
        pathPrefix,
        permissions:
          permissionPreset === "read"
            ? ["read"]
            : ["read", "write", "delete", "share"],
      }),
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

  async function handleCopy() {
    if (!secret) {
      return;
    }
    await navigator.clipboard.writeText(secret);
  }

  return (
    <div className="space-y-6">
      <header className="workspace-page-heading">
        <h1 className="dashboard-title">Tokens</h1>
        <p className="section-copy mt-2">
          Give each agent the access it needs, and keep control of every
          connection.
        </p>
      </header>
      <Disclosure key={secret ?? "create"} defaultOpen={!!secret}>
        <DisclosureSummary>
          <span>
            <span className="block font-semibold">Create a token</span>
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              Scoped access for your agents, with a one-time secret.
            </span>
          </span>
        </DisclosureSummary>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_380px]">
          <Card>
            <CardHeader>
              <CardTitle>Create a token</CardTitle>
              <CardDescription>
                Limit each agent to the access it needs. Tokens expire after 30
                days by default, with a maximum of 90 days.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <form
                className="grid gap-4 sm:grid-cols-2"
                onSubmit={handleCreate}
              >
                <div className="space-y-2">
                  <label className="section-label" htmlFor="token-label">
                    Label
                  </label>
                  <Input
                    id="token-label"
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="Build runner"
                    value={label}
                  />
                </div>
                <div className="space-y-2">
                  <label className="section-label" htmlFor="token-ttl">
                    TTL
                  </label>
                  <Input
                    id="token-ttl"
                    onChange={(event) => setTtl(event.target.value)}
                    placeholder="7d"
                    value={ttl}
                  />
                </div>
                <div className="space-y-2">
                  <label className="section-label" htmlFor="token-path">
                    Allowed folder
                  </label>
                  <Input
                    id="token-path"
                    value={pathPrefix}
                    onChange={(event) => setPathPrefix(event.target.value)}
                    placeholder="/project"
                  />
                </div>
                <div className="space-y-2">
                  <label className="section-label" htmlFor="token-permissions">
                    Access
                  </label>
                  <Select
                    aria-label="Access"
                    id="token-permissions"
                    value={permissionPreset}
                    onValueChange={(value) => setPermissionPreset(value)}
                  >
                    <SelectItem value="read">Read only</SelectItem>
                    <SelectItem value="edit">
                      Read, write, delete, share
                    </SelectItem>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button className="w-full sm:w-auto" type="submit">
                    <KeyRound className="size-4" />
                    Create token
                  </Button>
                </div>
              </form>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-border bg-muted/40 p-4">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="size-4 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">
                      Token hygiene
                    </p>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    AGFS stores token hashes in D1 and only reveals the raw
                    token once at creation time.
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-muted/40 p-4">
                  <p className="section-label">Current count</p>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">
                    {tokens.length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Badge className="w-fit" variant="secondary">
                Latest secret
              </Badge>
              <CardTitle>Copy this now.</CardTitle>
              <CardDescription>
                After this screen changes, the raw token value cannot be
                retrieved again.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {secret ? (
                <DetailSurface key={secret} label="New token secret">
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 break-all font-mono text-sm leading-6 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200">
                    {secret}
                  </div>
                  <Button onClick={handleCopy} type="button" variant="outline">
                    <Copy className="size-4" />
                    Copy token
                  </Button>
                </DetailSurface>
              ) : (
                <p className="text-sm leading-6 text-muted-foreground">
                  Create a token and the latest value will appear here for a
                  one-time copy.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </Disclosure>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Token request failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Issued tokens</CardTitle>
          <CardDescription>
            Keep labels clear so automation hosts are easy to identify and
            retire when they are no longer needed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingState label="Loading tokens" />
          ) : tokens.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 px-6 py-16 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
              No tokens issued yet. Create one above for CI, remote agents, or
              personal scripts.
            </div>
          ) : (
            <Table aria-label="Issued tokens">
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tokens.map((token) => (
                  <TableRow key={token.id}>
                    <TableCell className="font-medium text-foreground">
                      {token.label}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {token.pathPrefix}
                      <br />
                      {token.permissions.join(", ")}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          token.revokedAt ||
                          (token.expiresAt &&
                            Date.parse(token.expiresAt) <= Date.now())
                            ? "warning"
                            : "secondary"
                        }
                      >
                        {token.revokedAt
                          ? "Revoked"
                          : token.expiresAt
                            ? (Date.parse(token.expiresAt) <= Date.now()
                                ? "Expired "
                                : "Expires ") +
                              new Date(token.expiresAt).toLocaleDateString()
                            : "Active"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <ActionMenu
                          label={`Actions for ${token.label}`}
                          disabled={!!token.revokedAt}
                        >
                          {!token.revokedAt ? (
                            <ActionMenuItem asChild>
                              <Button
                                size="sm"
                                type="button"
                                variant="outline"
                                onClick={async () => {
                                  try {
                                    const r = await fetch(
                                      "/api/v1/platform/tokens/" +
                                        token.id +
                                        "/rotate",
                                      { method: "POST" },
                                    );
                                    const v = await r.json();
                                    if (!r.ok) throw new Error(v.error);
                                    setSecret(v.token);
                                    await refresh();
                                  } catch (e) {
                                    setError(e.message);
                                  }
                                }}
                              >
                                Rotate token
                              </Button>
                            </ActionMenuItem>
                          ) : null}
                          {!token.revokedAt ? (
                            <ActionMenuItem asChild>
                              <Button
                                onClick={() => handleRevoke(token.id)}
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                <Trash2 className="size-4 text-red-500" />
                                Revoke
                              </Button>
                            </ActionMenuItem>
                          ) : null}
                        </ActionMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
