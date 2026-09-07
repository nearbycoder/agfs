import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Page, Field, platform, useAction, useData, Empty } from "./shared";
export function WebhooksPage() {
  const data = useData("/webhooks", "webhooks"),
    action = useAction(),
    [url, setUrl] = useState(""),
    [path, setPath] = useState("/"),
    [events, setEvents] = useState("upload.commit"),
    [deliveries, setDeliveries] = useState<any[] | null>(null),
    [selected, setSelected] = useState("");
  return (
    <Page
      title="Webhooks"
      description="Send signed file and run events to your service. Failed deliveries retry automatically up to eight attempts."
      error={action.error || data.error}
      notice={action.notice}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const hook = await platform("/webhooks", "POST", {
              url,
              path,
              events: events
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
            });
            action.setNotice("Save this signing secret now: " + hook.secret);
            setUrl("");
            await data.refresh();
          });
        }}
      >
        <Field
          label="Public HTTPS endpoint"
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-service.com/agfs-events"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Folder"
            required
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
          <Field
            label="Events, separated by commas (* for all)"
            required
            value={events}
            onChange={(e) => setEvents(e.target.value)}
          />
        </div>
        <p className="section-copy">
          Events include upload.commit, move, trash, mkdir, file.tag, run.start,
          run.complete, draft.apply, and recovery.restore. Creating a webhook
          enables delivery to this endpoint.
        </p>
        <Button disabled={action.busy}>Create webhook</Button>
      </form>
      {data.items.length ? (
        <ul className="divide-y">
          {data.items.map((h) => (
            <li key={h.id} className="space-y-3 py-4">
              <p className="break-all font-medium">{h.url}</p>
              <p className="section-copy">
                {h.path_prefix} · {JSON.parse(h.events).join(", ")} ·{" "}
                {h.enabled ? "Enabled" : "Paused"}
              </p>
              <p className="text-xs text-muted-foreground">
                Last delivery:{" "}
                {h.last_used_at
                  ? new Date(h.last_used_at).toLocaleString()
                  : "never"}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      const v = await platform(
                        "/webhooks/" + h.id + "/rotate",
                        "POST",
                        {},
                      );
                      action.setNotice(
                        "New secret: " +
                          v.secret +
                          " · Old signature remains valid for 15 minutes.",
                      );
                      await data.refresh();
                    })
                  }
                >
                  Rotate secret
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await platform("/webhooks/" + h.id, "PATCH", {
                        enabled: !h.enabled,
                      });
                      await data.refresh();
                    })
                  }
                >
                  {h.enabled ? "Pause" : "Enable"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      setSelected(h.id);
                      setDeliveries(
                        (await platform("/webhooks/" + h.id + "/deliveries"))
                          .deliveries,
                      );
                    })
                  }
                >
                  Delivery history
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty loading={data.loading} text="No webhooks configured." />
      )}
      {deliveries ? (
        <section>
          <h2 className="font-semibold">Delivery history</h2>
          {deliveries.length ? (
            <ul className="divide-y">
              {deliveries.map((d) => (
                <li key={d.id} className="space-y-2 py-3">
                  <p className="text-sm">
                    {d.status} · {d.attempts} attempts ·{" "}
                    {new Date(d.created_at).toLocaleString()}
                  </p>
                  <p className="section-copy">
                    {d.last_error ?? "Delivered successfully"}
                  </p>
                  {d.status === "failed" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(async () => {
                          await platform(
                            "/deliveries/" + d.id + "/retry",
                            "POST",
                            {},
                          );
                          setDeliveries(
                            (
                              await platform(
                                "/webhooks/" + selected + "/deliveries",
                              )
                            ).deliveries,
                          );
                        })
                      }
                    >
                      Retry delivery
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="section-copy mt-3">No matching events yet.</p>
          )}
        </section>
      ) : null}
      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer font-medium">
          Verify signatures
        </summary>
        <p className="section-copy mt-3">
          Compute HMAC-SHA256 with the signing secret over the timestamp, a
          period, and the exact request body. Compare it in constant time to the
          hex value after v1= in X-AGFS-Signature. Reject X-AGFS-Timestamp
          values older than five minutes and deduplicate X-AGFS-Event-ID.
        </p>
      </details>
    </Page>
  );
}
