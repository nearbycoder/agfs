import { CsvProfile } from "./CsvProfile";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "~/components/ui/table";
import { Select, SelectItem } from "~/components/ui/select";
import { useDeferredValue, useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Field, platform, useAction } from "./shared";
import { parseCsv } from "~/lib/csv-inspector";
export function CsvInspector() {
  const [path, setPath] = useState(""),
    [delimiter, setDelimiter] = useState(","),
    [loaded, setLoaded] = useState<{ path: string; rows: string[][] } | null>(
      null,
    ),
    [query, setQuery] = useState(""),
    [column, setColumn] = useState(-1),
    [page, setPage] = useState(0),
    [header, setHeader] = useState(true);
  const action = useAction();
  const deferredQuery = useDeferredValue(query);
  const rows = loaded?.rows;
  const { width, headers, filtered } = useMemo(() => {
    const source = rows ?? [];
    const width = source.reduce((n, row) => Math.max(n, row.length), 0);
    const headers = Array.from({ length: width }, (_, i) =>
      header ? source[0]?.[i] || `Column ${i + 1}` : `Column ${i + 1}`,
    );
    const normalized = deferredQuery.toLowerCase();
    const filtered = source
      .slice(header ? 1 : 0)
      .map((cells, index) => ({ cells, index: index + (header ? 2 : 1) }))
      .filter((row) =>
        (column < 0 ? row.cells : [row.cells[column] ?? ""]).some((cell) =>
          cell.toLowerCase().includes(normalized),
        ),
      );
    return { width, headers, filtered };
  }, [rows, header, column, deferredQuery]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 50)),
    current = Math.min(page, pageCount - 1);
  return (
    <section className="space-y-4" aria-label="CSV inspector">
      <p className="text-sm text-muted-foreground">
        Read UTF-8 CSV up to 256 KiB, 5,000 rows and 200 columns. Quoted fields
        and multiline cells are supported. Filtering never changes the source
        file.
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            setLoaded(null);
            const file = await platform(
              "/text?path=" + encodeURIComponent(path),
            );
            const rows = parseCsv(file.text, delimiter);
            setLoaded({ path: file.path, rows });
            setPage(0);
            setColumn(-1);
            setQuery("");
          });
        }}
      >
        <Field
          label="CSV file path"
          required
          disabled={action.busy}
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <label className="grid gap-2 text-sm">
          Delimiter
          <Select
            aria-label="Delimiter"
            disabled={action.busy}
            value={delimiter}
            onValueChange={(value) => setDelimiter(value)}
          >
            <SelectItem value=",">Comma</SelectItem>
            <SelectItem value=";">Semicolon</SelectItem>
            <SelectItem value={"\t"}>Tab</SelectItem>
          </Select>
        </label>
        <Button disabled={action.busy}>Inspect CSV</Button>
      </form>
      {action.error ? <p role="alert">{action.error}</p> : null}
      {loaded ? (
        <>
          <h3 className="font-mono break-all">{loaded.path}</h3>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={header}
              onChange={(e) => {
                setHeader(e.target.checked);
                setPage(0);
              }}
            />
            First row contains headers
          </label>
          <div className="flex flex-wrap gap-3">
            <Field
              label="Filter CSV rows"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
            <label className="grid gap-2 text-sm">
              Filter column
              <Select
                aria-label="Filter column"
                value={column}
                onValueChange={(value) => {
                  setColumn(Number(value));
                  setPage(0);
                }}
              >
                <SelectItem value={-1}>All columns</SelectItem>
                {headers.map((h, i) => (
                  <SelectItem key={i} value={i}>
                    {h}
                  </SelectItem>
                ))}
              </Select>
            </label>
          </div>
          <p role="status" className="text-sm">
            {query !== deferredQuery ? "Filtering… · " : ""}
            {filtered.length} matching rows · {width} columns · Page{" "}
            {current + 1} of {pageCount}
          </p>
          {rows?.some((r) => r.length !== width) ? (
            <p className="text-sm">
              Rows have different column counts. Missing cells are shown empty.
            </p>
          ) : null}
          <CsvProfile
            rows={(rows ?? []).slice(header ? 1 : 0)}
            headers={headers}
          />
          <Table scrollClassName="max-h-96" aria-label="CSV preview">
            <TableHeader>
              <TableRow>
                <TableHead>Row</TableHead>
                {headers.map((h, i) => (
                  <TableHead key={i}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(current * 50, current * 50 + 50).map((r) => (
                <TableRow className="border-t" key={r.index}>
                  <TableHead scope="row">{r.index}</TableHead>
                  {headers.map((_, i) => (
                    <TableCell
                      key={i}
                      className="max-w-80 break-words whitespace-pre-wrap"
                    >
                      {r.cells[i] ?? ""}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              Previous CSV rows
            </Button>
            <Button
              variant="outline"
              disabled={current + 1 >= pageCount}
              onClick={() => setPage(current + 1)}
            >
              Next CSV rows
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
