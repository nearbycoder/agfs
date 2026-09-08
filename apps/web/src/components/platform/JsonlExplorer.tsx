import { useDeferredValue, useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Select, SelectItem } from "~/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "~/components/ui/table";
import { TextToolSource } from "./TextToolSource";
import { Field } from "./shared";
import { jsonlRecords, filterJsonl } from "~/lib/jsonl-explorer";
import { downloadText } from "~/lib/download-text";
export function JsonlExplorer() {
  const [loaded, setLoaded] = useState<{
      path: string;
      records: ReturnType<typeof jsonlRecords>;
    } | null>(null),
    [query, setQuery] = useState(""),
    [level, setLevel] = useState("all"),
    [page, setPage] = useState(0);
  const deferred = useDeferredValue(query);
  const filtered = useMemo(
    () =>
      filterJsonl(
        loaded?.records ?? [],
        deferred,
        level === "all" ? null : level.slice(6),
      ),
    [loaded, deferred, level],
  );
  const levels = useMemo(
    () => [...new Set(loaded?.records.map((r) => r.level))].sort(),
    [loaded],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 50)),
    current = Math.min(page, pages - 1);
  return (
    <section aria-label="JSONL log explorer" className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Explore up to 5,000 lines of JSONL. Blank lines are skipped; malformed
        lines remain visible with errors. Level uses a record’s string level or
        severity field. Downloads preserve each original line.
      </p>
      <TextToolSource
        label="JSONL"
        onLoad={(file) => {
          setLoaded({ path: file.path, records: jsonlRecords(file.text) });
          setQuery("");
          setLevel("all");
          setPage(0);
        }}
      />
      {loaded ? (
        <>
          <h3 className="font-mono break-all">{loaded.path}</h3>
          <div className="flex flex-wrap gap-3">
            <Field
              label="Search log lines"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
            <label className="grid gap-2 text-sm">
              Log level
              <Select
                aria-label="Log level"
                value={level}
                onValueChange={(v) => {
                  setLevel(v);
                  setPage(0);
                }}
              >
                <SelectItem value="all">All levels</SelectItem>
                {levels.map((l) => (
                  <SelectItem key={l} value={"level:" + l}>
                    {l || "(empty)"}
                  </SelectItem>
                ))}
              </Select>
            </label>
          </div>
          <p role="status">
            {filtered.length} matches ·{" "}
            {loaded.records.filter((r) => r.error).length} malformed lines ·
            Page {current + 1} of {pages}
            {query !== deferred ? " · Filtering…" : ""}
          </p>
          <Table aria-label="JSONL records" scrollClassName="max-h-96">
            <TableHeader>
              <TableRow>
                <TableHead>Line</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Record</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(current * 50, current * 50 + 50).map((r) => (
                <TableRow key={r.line}>
                  <TableHead scope="row">{r.line}</TableHead>
                  <TableCell>{r.level}</TableCell>
                  <TableCell className="max-w-xl whitespace-pre-wrap break-all font-mono text-xs">
                    {r.raw}
                    {r.error ? (
                      <p className="mt-2 text-destructive">{r.error}</p>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!filtered.length ? <p>No matching log records.</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!current}
              onClick={() => setPage(current - 1)}
            >
              Previous log records
            </Button>
            <Button
              variant="outline"
              disabled={current + 1 >= pages}
              onClick={() => setPage(current + 1)}
            >
              Next log records
            </Button>
            <Button
              disabled={!filtered.length || query !== deferred}
              onClick={() =>
                downloadText(
                  "filtered-records.jsonl",
                  filtered.map((r) => r.raw).join("\n") + "\n",
                  "application/x-ndjson",
                )
              }
            >
              Download matching JSONL
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Filtered downloads include malformed lines when they match. Source
            files are unchanged.
          </p>
        </>
      ) : null}
    </section>
  );
}
