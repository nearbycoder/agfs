import { useMemo, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Field, useAction } from "./shared";
import { sha256, compareDigest } from "~/lib/file-integrity";
import { downloadText } from "~/lib/download-text";
export function FileIntegrity() {
  const [result, setResult] = useState<{
      name: string;
      bytes: number;
      sha256: string;
      computedAt: string;
    } | null>(null),
    [expected, setExpected] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const action = useAction();
  const comparison = useMemo(() => {
    if (!result || !expected.trim()) return "";
    try {
      return compareDigest(result.sha256, expected)
        ? "Match — the SHA-256 digests are identical."
        : "Mismatch — these SHA-256 digests differ.";
    } catch (e) {
      return e instanceof Error ? e.message : "Invalid expected digest";
    }
  }, [result, expected]);
  return (
    <section aria-label="SHA-256 verification" className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Choose a local file up to 16 MiB to compute SHA-256 in your browser.
        File bytes are never uploaded. Compare with a digest from a trusted
        source to check integrity.
      </p>
      <label className="grid gap-2 text-sm">
        Local file to verify
        <input
          ref={input}
          type="file"
          disabled={action.busy}
          className="max-w-full rounded-lg border p-3 text-sm"
          onChange={(e) => {
            const file = e.target.files?.[0];
            setResult(null);
            if (!file) return;
            void action.run(async () => {
              if (file.size > 16 * 1024 * 1024)
                throw new Error("Choose a file of 16 MiB or less.");
              const digest = await sha256(await file.arrayBuffer());
              setResult({
                name: file.name,
                bytes: file.size,
                sha256: digest,
                computedAt: new Date().toISOString(),
              });
            });
          }}
        />
      </label>
      {action.busy ? <p role="status">Computing SHA-256…</p> : null}
      <Field
        label="Expected SHA-256 (optional)"
        maxLength={100}
        value={expected}
        onChange={(e) => setExpected(e.target.value)}
      />
      {result ? (
        <>
          <dl className="grid gap-3 rounded-lg border p-4">
            <div>
              <dt className="text-xs text-muted-foreground">File</dt>
              <dd className="break-all">
                {result.name} · {result.bytes.toLocaleString()} bytes
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">SHA-256</dt>
              <dd className="break-all font-mono text-sm">{result.sha256}</dd>
            </div>
          </dl>
          {comparison ? (
            <p role="status" className="text-sm">
              {comparison}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                void action.run(async () => {
                  await navigator.clipboard.writeText(result.sha256);
                  action.setNotice("SHA-256 copied.");
                })
              }
            >
              Copy SHA-256
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                downloadText(
                  "sha256-receipt.json",
                  JSON.stringify({ ...result, algorithm: "SHA-256" }, null, 2),
                  "application/json",
                )
              }
            >
              Download integrity receipt
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setResult(null);
                setExpected("");
                action.setNotice("");
                if (input.current) input.current.value = "";
              }}
            >
              Clear verification
            </Button>
          </div>
        </>
      ) : null}
      {action.error ? <p role="alert">{action.error}</p> : null}
      {action.notice ? <p role="status">{action.notice}</p> : null}
    </section>
  );
}
