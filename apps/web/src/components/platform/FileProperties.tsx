import type { FsEntry } from "@agfs/contracts";
import { Copy, FileSearch } from "lucide-react";
import { Button } from "~/components/ui/button";
import { DetailSurface, useAction } from "./shared";
import { formatBytes } from "~/lib/format";
export function FileProperties({
  entry,
  onClose,
}: {
  entry: FsEntry;
  onClose: () => void;
}) {
  const action = useAction();
  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    action.setNotice(label + " copied.");
  }
  return (
    <DetailSurface label="File properties">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <FileSearch className="size-4" />
            {entry.name}
          </h2>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
            {entry.path}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close properties
        </Button>
      </header>
      <dl className="grid gap-4 sm:grid-cols-2">
        {[
          ["Kind", entry.kind],
          [
            "Size",
            entry.kind === "folder"
              ? "Folder"
              : `${formatBytes(entry.size)} (${entry.size ?? 0} bytes)`,
          ],
          ["Content type", entry.contentType || "Not specified"],
          ["Entry ID", entry.id],
          ["Created", new Date(entry.createdAt).toLocaleString()],
          ["Updated", new Date(entry.updatedAt).toLocaleString()],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border bg-card p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-all text-sm">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">
          ETag · revision identifier
        </h3>
        <code className="block break-all rounded-lg bg-muted p-3 text-xs">
          {entry.etag || "No ETag for this entry"}
        </code>
        <p className="text-xs text-muted-foreground">
          Use the ETag to identify this stored revision. File tools check
          revisions before saving.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={action.busy}
          onClick={() => void action.run(() => copy(entry.path, "Path"))}
        >
          <Copy className="size-4" />
          Copy file path
        </Button>
        <Button
          variant="outline"
          disabled={action.busy || !entry.etag}
          onClick={() => void action.run(() => copy(entry.etag!, "ETag"))}
        >
          Copy ETag
        </Button>
        <Button
          variant="outline"
          disabled={action.busy}
          onClick={() =>
            void action.run(() =>
              copy(JSON.stringify(entry, null, 2), "Metadata"),
            )
          }
        >
          Copy metadata JSON
        </Button>
      </div>
      {action.notice ? (
        <p role="status" className="text-sm">
          {action.notice}
        </p>
      ) : null}
      {action.error ? (
        <p role="alert" className="text-sm text-destructive">
          Could not copy. Select the value and copy it manually.
        </p>
      ) : null}
    </DetailSurface>
  );
}
