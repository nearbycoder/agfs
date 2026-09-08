import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Select, SelectItem } from "~/components/ui/select";
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { exportCsv } from "~/lib/csv-download";
import { downloadText } from "~/lib/download-text";
import { useAction } from "./shared";
export function CsvDownload({
  rows,
  page,
  headers,
  hasHeader,
}: {
  rows: string[][];
  page: number;
  headers: string[];
  hasHeader: boolean;
}) {
  const [scope, setScope] = useState("all"),
    [delimiter, setDelimiter] = useState(","),
    [includeHeader, setIncludeHeader] = useState(true);
  const action = useAction();
  const chosen = scope === "all" ? rows : rows.slice(page * 50, page * 50 + 50);
  return (
    <Disclosure>
      <DisclosureSummary>Export filtered CSV</DisclosureSummary>
      <div className="flex flex-wrap gap-3">
        <label className="grid gap-2 text-sm">
          CSV export scope
          <Select
            aria-label="CSV export scope"
            value={scope}
            onValueChange={setScope}
          >
            <SelectItem value="all">All matching rows</SelectItem>
            <SelectItem value="page">Current page</SelectItem>
          </Select>
        </label>
        <label className="grid gap-2 text-sm">
          Export delimiter
          <Select
            aria-label="Export delimiter"
            value={delimiter}
            onValueChange={setDelimiter}
          >
            <SelectItem value=",">Comma</SelectItem>
            <SelectItem value=";">Semicolon</SelectItem>
            <SelectItem value={"\t"}>Tab</SelectItem>
          </Select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={includeHeader}
          onChange={(e) => setIncludeHeader(e.target.checked)}
        />
        Include {hasHeader ? "source" : "generated"} column headers
      </label>
      <p className="text-sm">
        {chosen.length} data rows. Cells beginning with spreadsheet formula
        characters receive a protective apostrophe. The source stays unchanged.
      </p>
      <Button
        disabled={action.busy || !headers.length}
        onClick={() =>
          void action.run(async () => {
            const text = exportCsv(
              includeHeader ? [headers, ...chosen] : chosen,
              delimiter,
            );
            downloadText("filtered-data.csv", text, "text/csv;charset=utf-8");
            action.setNotice("CSV download prepared.");
          })
        }
      >
        Download filtered CSV
      </Button>
      {action.error ? <p role="alert">{action.error}</p> : null}
      {action.notice ? <p role="status">{action.notice}</p> : null}
    </Disclosure>
  );
}
