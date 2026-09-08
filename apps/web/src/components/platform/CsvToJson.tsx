import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Select, SelectItem } from "~/components/ui/select";
import { TextToolSource } from "./TextToolSource";
import { csvToJson } from "~/lib/csv-to-json";
import { parseCsv } from "~/lib/csv-inspector";
import { downloadText } from "~/lib/download-text";
import { useAction } from "./shared";
export function CsvToJson() {
  const [delimiter, setDelimiter] = useState(",");
  const [loaded, setLoaded] = useState<
    ({ path: string } & ReturnType<typeof csvToJson>) | null
  >(null);
  const action = useAction();
  return (
    <section aria-label="CSV to JSON" className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Convert a header-based CSV into JSON records. Values remain strings,
        preserving leading zeros and large numbers. Headers must be unique and
        nonempty; uneven rows are rejected. Output is limited to 1 MiB.
      </p>
      <label className="grid gap-2 text-sm">
        Conversion delimiter
        <Select
          aria-label="Conversion delimiter"
          value={delimiter}
          onValueChange={setDelimiter}
        >
          <SelectItem value=",">Comma</SelectItem>
          <SelectItem value=";">Semicolon</SelectItem>
          <SelectItem value={"\t"}>Tab</SelectItem>
        </Select>
      </label>
      <TextToolSource
        label="CSV conversion"
        onLoad={(file) =>
          setLoaded({
            path: file.path,
            ...csvToJson(parseCsv(file.text, delimiter)),
          })
        }
      />
      {loaded ? (
        <>
          <h3 className="font-mono break-all">{loaded.path}</h3>
          <p role="status">
            {loaded.rows} records · {loaded.columns} columns
          </p>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg border p-4 text-xs">
            {loaded.text.slice(0, 12000)}
          </pre>
          <p className="text-xs text-muted-foreground">
            Preview shows the first 12,000 characters. Downloads contain every
            record. Source file remains unchanged.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                downloadText(
                  "converted-records.json",
                  loaded.text,
                  "application/json",
                )
              }
            >
              Download JSON records
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void action.run(async () => {
                  await navigator.clipboard.writeText(loaded.text);
                  action.setNotice("JSON records copied.");
                })
              }
            >
              Copy JSON records
            </Button>
          </div>
        </>
      ) : null}
      {action.error ? <p role="alert">{action.error}</p> : null}
      {action.notice ? <p role="status">{action.notice}</p> : null}
    </section>
  );
}
