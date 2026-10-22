import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { memo, useEffect, useRef, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import { folderUploadPlan } from "~/lib/folder-upload";
import {
  uploadFolderItems,
  type FolderTransferItem as Item,
} from "~/lib/browser-folder-transfer";
import { createFrameBatch } from "~/lib/browser-frame-batch";
import { formatBytes } from "~/lib/format";
const UploadRow = memo(function UploadRow({ item }: { item: Item }) {
  return (
    <li className="break-all py-2">
      <strong>{item.path}</strong> · {item.status}
      {item.status === "uploading"
        ? " " +
          Math.round((item.bytes / Math.max(1, item.file.size)) * 100) +
          "%"
        : ""}
      {item.error ? <p className="text-destructive">{item.error}</p> : null}
    </li>
  );
});
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
  const active = useRef<AbortController | null>(null);
  const updates = useRef<ReturnType<
    typeof createFrameBatch<string, Item>
  > | null>(null);
  useEffect(() => {
    updates.current = createFrameBatch<string, Item>((patches) =>
      setItems((old) =>
        old.map((item) =>
          patches.has(item.path)
            ? { ...item, ...patches.get(item.path) }
            : item,
        ),
      ),
    );
    return () => {
      active.current?.abort();
      updates.current?.dispose();
    };
  }, []);
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
    updates.current?.push(path, values);
  }
  async function run() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    pause.current = false;
    pauseReason.current = "";
    try {
      await uploadFolderItems(items, {
        signal: controller.signal,
        shouldStop: () => pause.current,
        pause: (reason) => {
          pause.current = true;
          pauseReason.current = reason;
        },
        update,
      });
      controller.signal.throwIfAborted();
      updates.current?.flush();
      setNotice(
        pause.current
          ? pauseReason.current || "Paused. Resume pending uploads when ready."
          : "Upload pass finished. Failed files can be retried; completed files are skipped.",
      );
      await complete.current();
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Could not refresh folder");
    } finally {
      if (active.current === controller) active.current = null;
      if (!controller.signal.aborted) {
        updates.current?.flush();
        setBusy(false);
      }
    }
  }
  const total = items.reduce((n, i) => n + i.file.size, 0),
    uploaded = items.reduce((n, i) => n + i.bytes, 0),
    done = items.filter((i) => i.status === "done").length,
    failed = items.filter((i) => i.status === "failed").length;
  return (
    <Disclosure>
      <DisclosureSummary>Upload a folder</DisclosureSummary>
      <section className="mt-4 space-y-4" aria-label="Folder upload">
        <p className="text-sm text-muted-foreground">
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
                    setNotice("Pausing after active files finish.");
                  }}
                >
                  Pause after active files
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
                <UploadRow key={item.path} item={item} />
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </Disclosure>
  );
}
