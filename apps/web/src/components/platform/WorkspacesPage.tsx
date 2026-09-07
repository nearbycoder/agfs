import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { Select, SelectItem } from "~/components/ui/select";
import { WorkspaceAdmin } from "./WorkspaceAdmin";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Page, Field, platform, useAction, useData, Empty } from "./shared";
export function WorkspacesPage() {
  const data = useData("/workspaces", "workspaces"),
    action = useAction();
  const [name, setName] = useState(""),
    [current, setCurrent] = useState<string | null>(null),
    [members, setMembers] = useState<any[]>([]),
    [email, setEmail] = useState(""),
    [role, setRole] = useState("viewer"),
    [invite, setInvite] = useState(""),
    [sendEmail, setSendEmail] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/v1/whoami", { signal: c.signal })
      .then((r) => r.json())
      .then((d) => {
        if (!c.signal.aborted) setCurrent(d.workspaceId);
      })
      .catch(() => {});
    const t = new URLSearchParams(window.location.search).get("invite");
    if (t) setInvite(t);
    return () => c.abort();
  }, []);
  const active = data.items.find((w) => w.id === current);
  return (
    <Page
      title="Workspaces"
      description="Share a filesystem with your team. Owners manage access, editors change files, and viewers can read."
      error={action.error || data.error}
      notice={action.notice}
    >
      <Disclosure>
        <DisclosureSummary>
          <span>
            <span className="block font-semibold">Create a workspace</span>
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              Give a project its own files, members, and permissions.
            </span>
          </span>
        </DisclosureSummary>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await platform("/workspaces", "POST", { name });
              setName("");
              await data.refresh();
              action.setNotice(
                "Workspace created. Select it to start adding files.",
              );
            });
          }}
        >
          <Field
            label="Workspace name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
          />
          <Button disabled={action.busy}>Create workspace</Button>
        </form>
      </Disclosure>
      {data.items.length ? (
        <ul className="divide-y">
          {data.items.map((w) => (
            <li
              key={w.id}
              className="flex flex-wrap justify-between gap-3 py-4"
            >
              <div>
                <h2 className="font-medium">{w.name}</h2>
                <p className="section-copy">
                  {w.role}
                  {w.paused ? " · Writes paused" : ""}
                  {w.id === current ? " · Selected" : ""}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={action.busy || w.id === current}
                onClick={() =>
                  void action.run(async () => {
                    await platform("/workspaces/select", "POST", {
                      workspace: w.id,
                    });
                    window.location.reload();
                  })
                }
              >
                Open
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty
          loading={data.loading}
          text="No team workspaces yet. Your personal files are available in the workspace selector."
        />
      )}
      {active ? <WorkspaceAdmin owner={active.role === "owner"} /> : null}
      {active?.role === "owner" ? (
        <section className="space-y-4 border-t pt-5">
          <h2 className="text-lg font-semibold">Manage {active.name}</h2>
          <WorkspaceSettings
            key={active.id}
            workspace={active}
            refresh={data.refresh}
          />
          <form
            className="grid gap-3 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(async () => {
                const result = await platform("/invites", "POST", {
                  email,
                  role,
                  sendEmail,
                });
                action.setNotice(
                  "Invitation link (valid 7 days): " +
                    window.location.origin +
                    "/app/workspaces?invite=" +
                    result.token +
                    (result.emailSent
                      ? " · Email sent."
                      : result.emailError
                        ? " · " + result.emailError
                        : ""),
                );
              });
            }}
          >
            <Field
              label="Invite by email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <label className="grid gap-2 text-sm">
              Role
              <Select
                aria-label="Member role"
                value={role}
                onValueChange={(value) => setRole(value)}
              >
                <SelectItem value="viewer">Viewer</SelectItem>
                <SelectItem value="editor">Editor</SelectItem>
              </Select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
              />
              Also send invitation by email
            </label>
            <Button className="self-end" disabled={action.busy}>
              Create invite link
            </Button>
          </form>
          <Button
            variant="outline"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () =>
                setMembers((await platform("/members")).members),
              )
            }
          >
            Load members
          </Button>
          <ul className="divide-y">
            {members.map((m) => (
              <li
                key={m.user_id}
                className="flex flex-wrap gap-3 justify-between py-3"
              >
                <span>
                  {m.email} · {m.role}
                </span>
                {m.role !== "owner" ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(async () => {
                          await platform("/members", "PATCH", {
                            userId: m.user_id,
                            role: m.role === "editor" ? "viewer" : "editor",
                          });
                          setMembers((await platform("/members")).members);
                        })
                      }
                    >
                      Make {m.role === "editor" ? "viewer" : "editor"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(async () => {
                          await platform("/members", "PATCH", {
                            userId: m.user_id,
                            role: null,
                          });
                          setMembers((await platform("/members")).members);
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <form
        className="space-y-3 border-t pt-5"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await platform("/invites/accept", "POST", { token: invite });
            setInvite("");
            window.history.replaceState(null, "", "/app/workspaces");
            await data.refresh();
            action.setNotice("Invitation accepted. Open the workspace above.");
          });
        }}
      >
        <Field
          label="Accept invitation code"
          value={invite}
          onChange={(e) => setInvite(e.target.value)}
          required
        />
        <p className="section-copy">
          Sign in with the email the invitation was issued to.
        </p>
        <Button disabled={action.busy}>Accept invitation</Button>
      </form>
    </Page>
  );
}
function WorkspaceSettings({
  workspace,
  refresh,
}: {
  workspace: any;
  refresh: () => Promise<void>;
}) {
  const action = useAction(),
    [name, setName] = useState(workspace.name),
    [limit, setLimit] = useState(String(workspace.storage_limit)),
    [paused, setPaused] = useState(!!workspace.paused);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async () => {
          await platform("/workspace", "PATCH", {
            name,
            paused,
            storageLimit: Number(limit),
          });
          await refresh();
          action.setNotice("Workspace settings saved.");
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Field
          label="Storage budget (bytes)"
          type="number"
          min={0}
          required
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
        />
      </div>
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={paused}
          onChange={(e) => setPaused(e.target.checked)}
        />
        Pause file changes and new shares
      </label>
      {action.error ? <p role="alert">{action.error}</p> : null}
      {action.notice ? <p role="status">{action.notice}</p> : null}
      <Button variant="outline" disabled={action.busy}>
        Save workspace
      </Button>
    </form>
  );
}
