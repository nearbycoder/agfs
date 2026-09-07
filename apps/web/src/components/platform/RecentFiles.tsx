import { Button } from "~/components/ui/button";
import { Empty, platform, useAction, useData } from "./shared";
import { formatBytes } from "~/lib/format";
export function RecentFiles() {
  const data = useData("/recent-files", "recent"),
    action = useAction();
  return (
    <section className="space-y-4" aria-label="Recent files">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Recent files</h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={data.loading || action.busy}
            onClick={() => void data.refresh()}
          >
            Refresh recent files
          </Button>
          <Button
            variant="outline"
            disabled={!data.items.length || action.busy}
            onClick={() => {
              if (
                window.confirm(
                  "Clear your recent file history in this workspace? Files remain unchanged.",
                )
              )
                void action.run(async () => {
                  await platform("/recent-files", "DELETE", { clear: true });
                  await data.refresh();
                  action.setNotice("Recent history cleared.");
                });
            }}
          >
            Clear recent history
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Your last 100 files opened in text tools or downloaded through a web
        session, in this workspace. History follows renamed files; removed files
        disappear. Agent token activity is excluded.
      </p>
      {action.error || data.error ? (
        <p role="alert">{action.error || data.error}</p>
      ) : null}
      {action.notice ? <p role="status">{action.notice}</p> : null}
      <ul className="divide-y">
        {data.items.map((file) => (
          <li
            key={file.id}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0">
              <a
                className="break-all font-mono text-sm underline"
                href={
                  "/api/v1/fs/download?path=" + encodeURIComponent(file.path)
                }
              >
                {file.path}
              </a>
              <p className="text-xs text-muted-foreground">
                {formatBytes(file.size ?? 0)} · Opened{" "}
                {new Date(file.openedAt).toLocaleString()}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={action.busy}
              aria-label={"Remove recent " + file.path}
              onClick={() =>
                void action.run(async () => {
                  await platform("/recent-files", "DELETE", {
                    entryId: file.id,
                  });
                  await data.refresh();
                })
              }
            >
              Remove from history
            </Button>
          </li>
        ))}
      </ul>
      {!data.items.length ? (
        <Empty
          loading={data.loading}
          text="Files you open in text tools or download will appear here."
        />
      ) : null}
    </section>
  );
}
