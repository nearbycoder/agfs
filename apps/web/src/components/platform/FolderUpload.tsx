import { useEffect, useRef, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import { uploadResumable } from "@agfs/contracts";
import { Button } from "~/components/ui/button";
import { folderUploadPlan } from "~/lib/folder-upload";
import { saveBrowserText } from "~/lib/browser-text";
import { formatBytes } from "~/lib/format";
type Item = {
  file: File;
  path: string;
  status: "queued" | "uploading" | "done" | "failed";
  bytes: number;
  error?: string;
};
export function FolderUpload({
  destination,
  onComplete,
}: {
  destination: string;
  onComplete: () => Promise<void>;
}) {
  const [items, setItems] = useState<Item[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [target, setTarget] = useState("");
  const pause = useRef(false),
    pauseReason = useRef(""),
    complete = useRef(onComplete);
  useEffect(() => {
    complete.current = onComplete;
  }, [onComplete]);
  const pending = items.some((i) => i.status !== "done");
  useBlocker({
    shouldBlockFn: () =>
      busy ||
      (pending &&
        !window.confirm(
          "Discard this folder upload selection? Completed files remain uploaded.",
        )),
    enableBeforeUnload: busy || pending,
    disabled: !busy && !pending,
  });
  function update(path: string, values: Partial<Item>) {
    setItems((old) =>
      old.map((i) => (i.path === path ? { ...i, ...values } : i)),
    );
  }
  async function run() {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    pause.current = false;
    pauseReason.current = "";
    const request: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      if ([401, 403, 429, 507].includes(response.status)) {
        pause.current = true;
        pauseReason.current =
          "Paused after an authentication, permission, rate-limit or storage response. Resolve the reported error before retrying.";
      }
      return response;
    };
    const queue = items.filter((i) => i.status !== "done");
    try {
      for (const item of queue) {
        if (pause.current) break;
        update(item.path, { status: "uploading", error: undefined, bytes: 0 });
        try {
          if (item.file.size === 0)
            await saveBrowserText(
              item.path,
              "",
              null,
              item.file.type || "application/octet-stream",
              request,
            );
          else
            await uploadResumable({
              path: item.path,
              contentType: item.file.type || "application/octet-stream",
              size: item.file.size,
              ifMatch: null,
              fingerprint: `${item.file.size}:${item.file.lastModified}:${item.path}`,
              request,
              read: (start, end) => item.file.slice(start, end).arrayBuffer(),
              progress: (bytes) => update(item.path, { bytes }),
            });
          update(item.path, { status: "done", bytes: item.file.size });
        } catch (e) {
          update(item.path, {
            status: "failed",
            error: e instanceof Error ? e.message : "Upload failed",
          });
        }
      }
      setNotice(
        pause.current
          ? pauseReason.current || "Paused. Resume pending uploads when ready."
          : "Upload pass finished. Failed files can be retried; completed files are skipped.",
      );
      await complete.current();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not refresh folder");
    } finally {
      setBusy(false);
    }
  }
  const total = items.reduce((n, i) => n + i.file.size, 0),
    uploaded = items.reduce((n, i) => n + i.bytes, 0),
    done = items.filter((i) => i.status === "done").length,
    failed = items.filter((i) => i.status === "failed").length;
  return (
    <details className="rounded-xl border p-4">
      <summary className="cursor-pointer font-semibold">
        Upload a folder
      </summary>
      <section className="mt-4 space-y-4" aria-label="Folder upload">
        <p className="text-sm text-zinc-500">
          Choose up to 500 files in one folder. The selected folder and
          subfolders are preserved under {destination}. Existing files are never
          replaced. Empty directories are not included by the browser. Keep this
          page open while uploading.
        </p>
        <label className="grid gap-2 text-sm">
          Choose folder
          <input
            type="file"
            multiple
            {...{ webkitdirectory: "" }}
            disabled={busy}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (!files.length) return;
              if (
                pending &&
                !window.confirm(
                  "Replace the pending folder selection? Completed files remain uploaded.",
                )
              )
                return;
              try {
                const plan = folderUploadPlan(files, destination);
                setItems(
                  plan.map((p) => ({ ...p, status: "queued", bytes: 0 })),
                );
                setTarget(destination);
                setError("");
                setNotice("");
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Invalid folder selection",
                );
              }
            }}
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
        {items.length ? (
          <>
            <p className="break-all text-sm">
              Destination fixed for this batch: {target} · {items.length} files
              · {formatBytes(total)}
            </p>
            <p role="status" className="text-sm">
              {done} completed · {failed} failed · {formatBytes(uploaded)} /{" "}
              {formatBytes(total)} transferred
            </p>
            <progress
              className="w-full"
              aria-label="Folder upload progress"
              max={Math.max(1, total)}
              value={uploaded}
            />
            <div className="flex flex-wrap gap-3">
              <Button disabled={busy || !pending} onClick={() => void run()}>
                {failed
                  ? "Retry failed and pending files"
                  : done
                    ? "Resume pending uploads"
                    : "Upload selected folder"}
              </Button>
              {busy ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    pause.current = true;
                    setNotice("Pausing after the current file finishes.");
                  }}
                >
                  Pause after current file
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    if (
                      !pending ||
                      window.confirm(
                        "Clear this upload selection? Uploaded files remain unchanged.",
                      )
                    ) {
                      setItems([]);
                      setNotice("");
                    }
                  }}
                >
                  Clear upload selection
                </Button>
              )}
            </div>
            <ul className="max-h-80 divide-y overflow-auto text-sm">
              {items.map((item) => (
                <li key={item.path} className="break-all py-2">
                  <strong>{item.path}</strong> · {item.status}
                  {item.status === "uploading"
                    ? " " +
                      Math.round(
                        (item.bytes / Math.max(1, item.file.size)) * 100,
                      ) +
                      "%"
                    : ""}
                  {item.error ? (
                    <p className="text-red-600">{item.error}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </details>
  );
}
