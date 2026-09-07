import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { platform, useAction, selectClass } from "./shared";
export function WorkspaceAdmin({ owner }: { owner: boolean }) {
  const action = useAction(),
    [invites, setInvites] = useState<any[]>([]),
    [members, setMembers] = useState<any[]>([]),
    [recipient, setRecipient] = useState(""),
    [transfer, setTransfer] = useState<any>(null),
    [independent, setIndependent] = useState(false);
  async function refresh(signal?: AbortSignal) {
    const [ownership, invitationData, memberData, policy] = await Promise.all([
      platform("/ownership", "GET", undefined, signal),
      owner ? platform("/invites", "GET", undefined, signal) : null,
      owner ? platform("/members", "GET", undefined, signal) : null,
      owner ? platform("/review-policy", "GET", undefined, signal) : null,
    ]);
    if (signal?.aborted) return;
    setTransfer(ownership.transfer);
    if (owner) {
      setInvites(invitationData.invites);
      setMembers(memberData.members);
      setIndependent(!!policy.independent_review);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void action.run(() => refresh(controller.signal));
    return () => controller.abort();
  }, [owner]);
  return (
    <section className="space-y-4 border-t pt-5">
      <h2 className="text-lg font-semibold">Access & review policies</h2>
      {action.error ? <p role="alert">{action.error}</p> : null}
      {owner ? (
        <>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={independent}
              disabled={action.busy}
              onChange={(e) => {
                const checked = e.target.checked;
                void action.run(async () => {
                  await platform("/review-policy", "PUT", {
                    independentReview: checked,
                  });
                  setIndependent(checked);
                });
              }}
            />
            Require another person to approve a draft
          </label>
          <h3 className="font-medium">Pending invitations</h3>
          <Button
            variant="outline"
            disabled={action.busy}
            onClick={() => void action.run(() => refresh())}
          >
            Refresh invitations
          </Button>
          <ul className="divide-y">
            {invites.map((i) => (
              <li
                className="flex flex-wrap justify-between gap-3 py-3"
                key={i.id}
              >
                <span>
                  {i.email} · {i.role} · expires{" "}
                  {new Date(i.expires_at).toLocaleDateString()}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void action.run(async () => {
                      await platform("/invites/" + i.id, "DELETE");
                      await refresh();
                    })
                  }
                >
                  Revoke invitation
                </Button>
              </li>
            ))}
          </ul>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(async () => {
                await platform("/ownership", "POST", { userId: recipient });
                await refresh();
              });
            }}
          >
            <label className="grid gap-2 text-sm">
              Transfer ownership to
              <select
                required
                className={selectClass}
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              >
                <option value="">Select a member</option>
                {members
                  .filter((m) => m.role !== "owner")
                  .map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.email}
                    </option>
                  ))}
              </select>
            </label>
            <p className="text-sm text-muted-foreground">
              The recipient must accept within 24 hours. You become an editor
              after acceptance.
            </p>
            <Button disabled={action.busy || !recipient} variant="outline">
              Request ownership transfer
            </Button>
          </form>
        </>
      ) : null}
      {transfer ? (
        <div className="space-y-3 rounded-xl border p-4">
          <p>Ownership transfer pending for {transfer.recipient}.</p>
          {owner ? (
            <Button
              variant="outline"
              onClick={() =>
                void action.run(async () => {
                  await platform("/ownership", "DELETE");
                  await refresh();
                })
              }
            >
              Cancel transfer
            </Button>
          ) : (
            <Button
              onClick={() =>
                void action.run(async () => {
                  await platform("/ownership/accept", "POST", {});
                  window.location.reload();
                })
              }
            >
              Accept ownership
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
