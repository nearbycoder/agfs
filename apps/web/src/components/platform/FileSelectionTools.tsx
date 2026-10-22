import type { FsEntry } from "@agfs/contracts";
import { Button } from "~/components/ui/button";
import { runInputSelection } from "~/lib/run-workflows";
import { ReleaseHandoff } from "./ReleaseHandoff";
import { SelectionClipboard } from "./SelectionClipboard";
import { BatchRename } from "./BatchRename";

export function FileSelectionTools({
  entries,
  paths,
  folder,
  busy,
  onSaved,
  onRenamed,
  onError,
}: {
  entries: FsEntry[];
  paths: string[];
  folder: string;
  busy: boolean;
  onSaved: () => Promise<void>;
  onRenamed: () => Promise<void>;
  onError: (error: string) => void;
}) {
  return (
    <>
      <Button
        variant="outline"
        disabled={busy || !paths.length || paths.length > 50}
        onClick={() => {
          try {
            const inputs = runInputSelection(paths);
            window.location.assign(
              "/app/runs?" + new URLSearchParams({ inputs, folder }),
            );
          } catch (error) {
            onError(
              error instanceof Error
                ? error.message
                : "Could not prepare run inputs",
            );
          }
        }}
      >
        Start agent run with {paths.length} selected inputs
      </Button>
      <ReleaseHandoff entries={entries} onSaved={onSaved} />
      {paths.length ? <SelectionClipboard paths={paths} /> : null}
      {paths.length ? (
        <BatchRename entries={entries} onComplete={onRenamed} />
      ) : null}
    </>
  );
}
