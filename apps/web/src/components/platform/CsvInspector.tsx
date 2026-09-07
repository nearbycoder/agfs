import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Field, platform, useAction, selectClass } from "./shared";
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
  const action = useAction(),
    rows = loaded?.rows ?? [],
    width = rows.reduce((n, r) => Math.max(n, r.length), 0),
    headers = Array.from({ length: width }, (_, i) =>
      header ? rows[0]?.[i] || `Column ${i + 1}` : `Column ${i + 1}`,
    );
  const filtered = rows
    .slice(header ? 1 : 0)
    .map((cells, index) => ({ cells, index: index + (header ? 2 : 1) }))
    .filter((r) =>
      (column < 0 ? r.cells : [r.cells[column] ?? ""]).some((c) =>
        c.toLowerCase().includes(query.toLowerCase()),
      ),
    );
  const pageCount = Math.max(1, Math.ceil(filtered.length / 50)),
    current = Math.min(page, pageCount - 1);
  return (
    <section className="space-y-4" aria-label="CSV inspector">
      <p className="text-sm text-zinc-500">
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
          <select
            className={selectClass}
            disabled={action.busy}
            value={delimiter}
            onChange={(e) => setDelimiter(e.target.value)}
          >
            <option value=",">Comma</option>
            <option value=";">Semicolon</option>
            <option value={"\t"}>Tab</option>
          </select>
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
              <select
                className={selectClass}
                value={column}
                onChange={(e) => {
                  setColumn(Number(e.target.value));
                  setPage(0);
                }}
              >
                <option value={-1}>All columns</option>
                {headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p role="status" className="text-sm">
            {filtered.length} matching rows · {width} columns · Page{" "}
            {current + 1} of {pageCount}
          </p>
          {rows.some((r) => r.length !== width) ? (
            <p className="text-sm">
              Rows have different column counts. Missing cells are shown empty.
            </p>
          ) : null}
          <div className="max-h-96 overflow-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2">Row</th>
                  {headers.map((h, i) => (
                    <th className="p-2" key={i}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(current * 50, current * 50 + 50).map((r) => (
                  <tr className="border-t" key={r.index}>
                    <th className="p-2">{r.index}</th>
                    {headers.map((_, i) => (
                      <td
                        key={i}
                        className="max-w-80 break-words whitespace-pre-wrap p-2"
                      >
                        {r.cells[i] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-3">
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
