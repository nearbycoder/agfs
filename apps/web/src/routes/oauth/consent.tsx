import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AuthGate } from "~/components/AuthGate";
import { Button } from "~/components/ui/button";
import {
  Page,
  Field,
  platform,
  useAction,
  useData,
  selectClass,
} from "~/components/platform/shared";
export const Route = createFileRoute("/oauth/consent")({
  component: () => (
    <AuthGate message="Sign in to choose which files this MCP client can access.">
      <Consent />
    </AuthGate>
  ),
});
function Consent() {
  const data = useData("/workspaces", "workspaces"),
    action = useAction(),
    [query, setQuery] = useState(""),
    [workspace, setWorkspace] = useState("personal"),
    [path, setPath] = useState("/"),
    [permissions, setPermissions] = useState<string[]>(["read"]);
  useEffect(() => {
    setQuery(window.location.search.slice(1));
  }, []);
  const params = new URLSearchParams(query),
    requested = (params.get("scope") ?? "").split(" "),
    available = ["read", "write", "delete", "share"].filter((p) =>
      requested.includes("agfs:" + p),
    );
  async function consent(accept: boolean) {
    const result = await platform("/oauth/consent", "POST", {
      accept,
      oauthQuery: query,
      workspace,
      path,
      permissions: permissions.filter((p) => available.includes(p)),
    });
    if (!result.url) throw new Error("Authorization did not return a redirect");
    const target = new URL(result.url);
    if (!["https:", "http:"].includes(target.protocol))
      throw new Error("Unsupported redirect");
    window.location.assign(target.href);
  }
  return (
    <div className="page-shell max-w-3xl py-12 sm:py-16">
      <Page
        title="Connect an MCP client"
        description="Choose a workspace, folder, and permissions. You can pause or revoke this connection later in Tokens and Agent budgets."
        error={action.error || data.error}
      >
        <p className="break-all text-sm">
          Client ID:{" "}
          <code>
            {params.get("client_id") ??
              "Missing — start connecting from your MCP client."}
          </code>
        </p>
        <label className="grid gap-2 text-sm">
          Workspace
          <select
            className={selectClass}
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
          >
            <option value="personal">Personal workspace</option>
            {data.items.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.role})
              </option>
            ))}
          </select>
        </label>
        <Field
          label="Allowed folder"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <fieldset className="space-y-3">
          <legend className="mb-3 text-sm font-medium">
            Requested permissions
          </legend>
          {available.map((p) => (
            <label key={p} className="flex gap-3 text-sm">
              <input
                type="checkbox"
                checked={permissions.includes(p)}
                onChange={(e) =>
                  setPermissions((old) =>
                    e.target.checked ? [...old, p] : old.filter((v) => v !== p),
                  )
                }
              />
              {
                (
                  {
                    read: "Read files",
                    write: "Create and overwrite files",
                    delete: "Delete files",
                    share: "Create public share links",
                  } as Record<string, string>
                )[p]
              }
            </label>
          ))}
        </fieldset>
        <div className="flex gap-3">
          <Button
            disabled={
              action.busy || !permissions.some((p) => available.includes(p))
            }
            onClick={() => void action.run(() => consent(true))}
          >
            Allow access
          </Button>
          <Button
            variant="outline"
            disabled={action.busy || !query}
            onClick={() => void action.run(() => consent(false))}
          >
            Deny
          </Button>
        </div>
      </Page>
    </div>
  );
}
