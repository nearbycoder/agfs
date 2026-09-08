import { useMemo, useState } from "react";
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
import { parseExactJson, type JsonValue } from "~/lib/lossless-json";
import { compareJson } from "~/lib/json-compare";
import { downloadText } from "~/lib/download-text";
export function JsonCompare() {
  const [left, setLeft] = useState<{ path: string; value: JsonValue } | null>(
      null,
    ),
    [right, setRight] = useState<{ path: string; value: JsonValue } | null>(
      null,
    ),
    [filter, setFilter] = useState("all"),
    [page, setPage] = useState(0);
  const result = useMemo(() => {
    if (!left || !right) return null;
    try {
      return { changes: compareJson(left.value, right.value), error: "" };
    } catch (e) {
      return {
        changes: [],
        error: e instanceof Error ? e.message : "Cannot compare",
      };
    }
  }, [left, right]);
  const filtered =
    result?.changes.filter((c) => filter === "all" || c.kind === filter) ?? [];
  const pages = Math.max(1, Math.ceil(filtered.length / 50)),
    current = Math.min(page, pages - 1);
  return (
    <section aria-label="JSON structural comparison" className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Compare two JSON documents by structure. Object key order is ignored;
        arrays compare by index. Number spelling is exact, so 1 and 1.0 are
        reported as different. Up to 2,000 changes and 1 MiB of comparison data.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <TextToolSource
            label="Before JSON"
            onLoad={(file) => {
              setLeft({ path: file.path, value: parseExactJson(file.text) });
              setPage(0);
            }}
          />
          {left ? (
            <p className="break-all font-mono text-xs">Before: {left.path}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <TextToolSource
            label="After JSON"
            onLoad={(file) => {
              setRight({ path: file.path, value: parseExactJson(file.text) });
              setPage(0);
            }}
          />
          {right ? (
            <p className="break-all font-mono text-xs">After: {right.path}</p>
          ) : null}
        </div>
      </div>
      {result?.error ? (
        <p role="alert">{result.error}</p>
      ) : result ? (
        <>
          <label className="grid gap-2 text-sm">
            Change type
            <Select
              aria-label="Change type"
              value={filter}
              onValueChange={(v) => {
                setFilter(v);
                setPage(0);
              }}
            >
              {["all", "added", "removed", "changed"].map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </Select>
          </label>
          <p role="status">
            {result.changes.length} total changes · {filtered.length} shown ·
            Page {current + 1} of {pages}
          </p>
          {!result.changes.length ? (
            <p>Documents have the same structure and values.</p>
          ) : (
            <Table aria-label="JSON changes" scrollClassName="max-h-96">
              <TableHeader>
                <TableRow>
                  <TableHead>Pointer</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>Before</TableHead>
                  <TableHead>After</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(current * 50, current * 50 + 50).map((c) => (
                  <TableRow key={c.path}>
                    <TableHead scope="row" className="max-w-48 break-all">
                      {c.path || "(root)"}
                    </TableHead>
                    <TableCell>{c.kind}</TableCell>
                    <TableCell className="max-w-72 break-all whitespace-pre-wrap font-mono text-xs">
                      {c.before?.slice(0, 2000) ?? "—"}
                    </TableCell>
                    <TableCell className="max-w-72 break-all whitespace-pre-wrap font-mono text-xs">
                      {c.after?.slice(0, 2000) ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!current}
              onClick={() => setPage(current - 1)}
            >
              Previous JSON changes
            </Button>
            <Button
              variant="outline"
              disabled={current + 1 >= pages}
              onClick={() => setPage(current + 1)}
            >
              Next JSON changes
            </Button>
            <Button
              onClick={() =>
                downloadText(
                  "json-comparison.json",
                  JSON.stringify(
                    {
                      before: left?.path,
                      after: right?.path,
                      numberComparison: "exact token spelling",
                      changes: result.changes,
                    },
                    null,
                    2,
                  ),
                  "application/json",
                )
              }
            >
              Download full comparison
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Cell previews show 2,000 characters. The report contains all
            changes, independent of the filter, with complete values stored as
            JSON source strings.
          </p>
        </>
      ) : null}
    </section>
  );
}
