import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Field, platform, useAction } from "./shared";
import { renamePlan, type RenameEntry } from "~/lib/rename-plan";
export function BatchRename({
  entries,
  onComplete,
}: {
  entries: RenameEntry[];
  onComplete: () => Promise<void>;
}) {
  const [options, setOptions] = useState({
    prefix: "",
    suffix: "",
    find: "",
    replacement: "",
    preserveExtension: true,
  });
  const [preview, setPreview] = useState<{
    signature: string;
    changes: ReturnType<typeof renamePlan>;
  } | null>(null);
  const action = useAction(),
    signature = JSON.stringify({ entries, options });
  const ready = preview?.signature === signature ? preview : null;
  return (
    <Disclosure>
      <DisclosureSummary>
        Rename selected files ({entries.length})
      </DisclosureSummary>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          Preview up to 50 files in this folder. Existing names and swaps are
          rejected. The whole batch succeeds or no files change.
        </p>
        {action.error ? <p role="alert">{action.error}</p> : null}
        {action.notice ? <p role="status">{action.notice}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {(["prefix", "suffix", "find", "replacement"] as const).map((key) => (
            <Field
              key={key}
              label={"Rename " + key}
              maxLength={255}
              disabled={action.busy}
              value={options[key]}
              onChange={(e) =>
                setOptions({ ...options, [key]: e.target.value })
              }
            />
          ))}
        </div>
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={options.preserveExtension}
            disabled={action.busy}
            onChange={(e) =>
              setOptions({ ...options, preserveExtension: e.target.checked })
            }
          />
          Preserve filename extensions
        </label>
        <Button
          disabled={action.busy}
          variant="outline"
          onClick={() =>
            void action.run(async () => {
              setPreview(null);
              const changes = renamePlan(entries, options);
              await platform("/batch-rename", "POST", {
                changes,
                dryRun: true,
              });
              setPreview({ signature, changes });
            })
          }
        >
          Preview renames
        </Button>
        {ready ? (
          <>
            <ul className="max-h-64 space-y-2 overflow-auto text-sm">
              {ready.changes.map((c) => (
                <li key={c.entryId} className="break-all">
                  <span>{c.from}</span> → <strong>{c.to}</strong>
                </li>
              ))}
            </ul>
            <Button
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  const result = await platform("/batch-rename", "POST", {
                    changes: ready.changes,
                    dryRun: false,
                  });
                  setPreview(null);
                  action.setNotice(`Renamed ${result.renamed.length} files.`);
                  await onComplete();
                })
              }
            >
              Apply {ready.changes.length} renames
            </Button>
          </>
        ) : null}
      </div>
    </Disclosure>
  );
}
