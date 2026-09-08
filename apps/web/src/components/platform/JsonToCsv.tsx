import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Select, SelectItem } from "~/components/ui/select";
import { TextToolSource } from "./TextToolSource";
import { parseExactJson } from "~/lib/lossless-json";
import { jsonToCsv } from "~/lib/json-to-csv";
import { downloadText } from "~/lib/download-text";
export function JsonToCsv() {
  const [delimiter, setDelimiter] = useState(",");
  const [loaded, setLoaded] = useState<
    ({ path: string } & ReturnType<typeof jsonToCsv>) | null
  >(null);
  return (
    <section aria-label="JSON to CSV" className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Convert an array of objects into a table with every distinct field.
        Exact number tokens and nested JSON are preserved; missing fields become
        empty cells and null becomes “null”. Spreadsheet formulas receive a
        protective apostrophe. Up to 5,000 records, 200 columns, and 1 MiB
        output.
      </p>
      <label className="grid gap-2 text-sm">
        JSON export delimiter
        <Select
          aria-label="JSON export delimiter"
          value={delimiter}
          onValueChange={(v) => {
            setDelimiter(v);
            setLoaded(null);
          }}
        >
          <SelectItem value=",">Comma</SelectItem>
          <SelectItem value=";">Semicolon</SelectItem>
          <SelectItem value={"\t"}>Tab</SelectItem>
        </Select>
      </label>
      <TextToolSource
        label="JSON conversion"
        onLoad={(file) =>
          setLoaded({
            path: file.path,
            ...jsonToCsv(parseExactJson(file.text), delimiter),
          })
        }
      />
      {loaded ? (
        <>
          <h3 className="font-mono break-all">{loaded.path}</h3>
          <p role="status">
            {loaded.rows} records · {loaded.headers.length} columns
          </p>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg border p-4 text-xs">
            {loaded.text.slice(0, 12000)}
          </pre>
          <p className="text-xs text-muted-foreground">
            First 12,000 characters shown. Download includes all records in the
            delimiter selected at load time. The source is unchanged.
          </p>
          <Button
            onClick={() =>
              downloadText(
                "converted-table.csv",
                loaded.text,
                "text/csv;charset=utf-8",
              )
            }
          >
            Download converted CSV
          </Button>
        </>
      ) : null}
    </section>
  );
}
