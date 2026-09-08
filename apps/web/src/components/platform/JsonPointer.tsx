import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { TextToolSource } from "./TextToolSource";
import { Field, useAction } from "./shared";
import {
  parseExactJson,
  stringifyExactJson,
  jsonKind,
  type JsonValue,
} from "~/lib/lossless-json";
import { resolvePointer } from "~/lib/json-pointer";
import { downloadText } from "~/lib/download-text";
export function JsonPointer() {
  const [loaded, setLoaded] = useState<{
      path: string;
      value: JsonValue;
    } | null>(null),
    [pointer, setPointer] = useState("");
  const action = useAction();
  const result = useMemo(() => {
    if (!loaded) return null;
    try {
      const r = resolvePointer(loaded.value, pointer);
      return r.found
        ? {
            text: stringifyExactJson(r.value),
            kind: jsonKind(r.value),
            error: "",
          }
        : { text: null, kind: "", error: "No value exists at this pointer." };
    } catch (e) {
      return {
        text: null,
        kind: "",
        error: e instanceof Error ? e.message : "Invalid pointer",
      };
    }
  }, [loaded, pointer]);
  return (
    <section aria-label="JSON Pointer extraction" className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Extract a value with JSON Pointer. Empty selects the root; /items/0
        selects an array item. Escape / as ~1 and ~ as ~0. Missing paths are
        distinct from null, and exact numeric tokens are preserved.
      </p>
      <TextToolSource
        label="JSON Pointer"
        onLoad={(file) => {
          setLoaded({ path: file.path, value: parseExactJson(file.text) });
          setPointer("");
        }}
      />
      <Field
        label="JSON Pointer expression"
        value={pointer}
        maxLength={4096}
        onChange={(e) => setPointer(e.target.value)}
      />
      {loaded ? <h3 className="font-mono break-all">{loaded.path}</h3> : null}
      {result?.error ? <p role="alert">{result.error}</p> : null}
      {result?.text !== null && result?.text !== undefined ? (
        <>
          <p role="status">
            Found {result.kind} · {new TextEncoder().encode(result.text).length}{" "}
            bytes
          </p>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg border p-4 text-xs">
            {result.text.slice(0, 12000)}
          </pre>
          <p className="text-xs text-muted-foreground">
            Preview shows the first 12,000 characters. Copy and download contain
            the complete value.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                downloadText(
                  "extracted-value.json",
                  result.text!,
                  "application/json",
                )
              }
            >
              Download extracted JSON
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void action.run(async () => {
                  await navigator.clipboard.writeText(result.text!);
                  action.setNotice("Extracted JSON copied.");
                })
              }
            >
              Copy extracted JSON
            </Button>
          </div>
        </>
      ) : null}
      {action.error ? <p role="alert">{action.error}</p> : null}
      {action.notice ? <p role="status">{action.notice}</p> : null}
    </section>
  );
}
