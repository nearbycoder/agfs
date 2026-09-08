import { useState } from "react";
import type { FsEntry } from "@agfs/contracts";
import { Download } from "lucide-react";
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { Select, SelectItem } from "~/components/ui/select";
import { Button } from "~/components/ui/button";
import { useAction } from "./shared";
import { directoryExport } from "~/lib/directory-export";
import { downloadText } from "~/lib/download-text";
export function DirectoryExport({
  entries,
  page,
  folder,
}: {
  entries: FsEntry[];
  page: FsEntry[];
  folder: string;
}) {
  const [scope, setScope] = useState("matching");
  const action = useAction();
  const chosen = scope === "page" ? page : entries;
  function save(format: "json" | "csv") {
    void action.run(async () => {
      const value = directoryExport(chosen, folder, format);
      downloadText(
        "agfs-inventory." + format,
        (format === "csv" ? "\ufeff" : "") + value,
        format === "csv" ? "text/csv;charset=utf-8" : "application/json",
      );
      action.setNotice(`Downloaded ${chosen.length} inventory entries.`);
    });
  }
  return (
    <Disclosure>
      <DisclosureSummary>
        <Download className="size-4" />
        Export directory inventory
      </DisclosureSummary>
      <label className="grid gap-2 text-sm">
        Inventory scope
        <Select
          aria-label="Inventory scope"
          value={scope}
          onValueChange={setScope}
        >
          <SelectItem value="matching">
            All matching entries ({entries.length})
          </SelectItem>
          <SelectItem value="page">Current page ({page.length})</SelectItem>
        </Select>
      </label>
      <p className="text-sm text-muted-foreground">
        Export names, paths, types, byte sizes, revisions and timestamps. This
        lists the current folder only; it does not include file contents or
        nested folders’ contents. Current filters and sorting apply.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={action.busy}
          onClick={() => save("json")}
        >
          Download inventory JSON
        </Button>
        <Button
          variant="outline"
          disabled={action.busy}
          onClick={() => save("csv")}
        >
          Download inventory CSV
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        CSV cells are quoted and protected against spreadsheet formulas. Limits:
        10,000 entries and 8 MiB.
      </p>
      {action.error ? (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      ) : null}
      {action.notice ? (
        <p role="status" className="text-sm">
          {action.notice}
        </p>
      ) : null}
    </Disclosure>
  );
}
