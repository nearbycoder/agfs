import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Select, SelectItem } from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { TextToolSource } from "./TextToolSource";
import { useAction } from "./shared";
import { convertEncoding, type Encoding } from "~/lib/encoding-workbench";
import { downloadText } from "~/lib/download-text";
export function EncodingWorkbench() {
  const [input, setInput] = useState(""),
    [from, setFrom] = useState<Encoding>("utf8"),
    [to, setTo] = useState<Encoding>("base64"),
    [result, setResult] = useState<
      | ({ from: Encoding; to: Encoding } & ReturnType<typeof convertEncoding>)
      | null
    >(null);
  const action = useAction();
  return (
    <section aria-label="Encoding workbench" className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Convert UTF-8, standard padded Base64, or hexadecimal locally. Input is
        limited to 256 KiB. Whitespace in Base64 and hex is ignored; invalid
        bytes and padding are rejected.
      </p>
      <TextToolSource
        label="Encoding source"
        onLoad={(file) => {
          setInput(file.text);
          setResult(null);
        }}
      />
      <label className="grid gap-2 text-sm">
        Encoding input
        <Textarea
          rows={6}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setResult(null);
          }}
        />
      </label>
      <div className="flex flex-wrap gap-3">
        {[
          [
            "Decode from",
            from,
            (v: Encoding) => {
              setFrom(v);
              setResult(null);
            },
          ],
          [
            "Encode to",
            to,
            (v: Encoding) => {
              setTo(v);
              setResult(null);
            },
          ],
        ].map(([label, value, setter]) => (
          <label key={label as string} className="grid gap-2 text-sm">
            {label as string}
            <Select
              aria-label={label as string}
              value={value as string}
              onValueChange={(v) =>
                (setter as (v: Encoding) => void)(v as Encoding)
              }
            >
              <SelectItem value="utf8">UTF-8 text</SelectItem>
              <SelectItem value="base64">Base64</SelectItem>
              <SelectItem value="hex">Hexadecimal</SelectItem>
            </Select>
          </label>
        ))}
      </div>
      <Button
        onClick={() =>
          void action.run(async () => {
            setResult(null);
            setResult({ ...convertEncoding(input, from, to), from, to });
          })
        }
      >
        Convert encoding
      </Button>
      {result ? (
        <>
          <p role="status">
            {result.bytes} decoded bytes · {result.from} → {result.to}
          </p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg border p-4 text-xs">
            {result.output.slice(0, 12000) || "(empty)"}
          </pre>
          <p className="text-xs text-muted-foreground">
            Preview shows the first 12,000 characters. Copy and download include
            all output.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                downloadText(
                  "encoded-output." +
                    (result.to === "utf8" ? "txt" : result.to),
                  result.output,
                )
              }
            >
              Download encoding output
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void action.run(async () => {
                  await navigator.clipboard.writeText(result.output);
                  action.setNotice("Encoding output copied.");
                })
              }
            >
              Copy encoding output
            </Button>
            <Button
              variant="ghost"
              disabled={new TextEncoder().encode(result.output).length > 262144}
              onClick={() => {
                setInput(result.output);
                setFrom(result.to);
                setTo(result.from);
                setResult(null);
              }}
            >
              Use output as input
            </Button>
          </div>
        </>
      ) : null}
      {action.error ? <p role="alert">{action.error}</p> : null}
      {action.notice ? <p role="status">{action.notice}</p> : null}
    </section>
  );
}
