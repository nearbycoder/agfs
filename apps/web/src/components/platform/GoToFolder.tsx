import { useEffect, useState } from "react";
import { FolderInput } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { Field, useAction } from "./shared";
import { folderTarget } from "~/lib/folder-target";
export function GoToFolder({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (path: string) => void;
}) {
  const [value, setValue] = useState(path);
  const action = useAction();
  useEffect(() => setValue(path), [path]);
  return (
    <Disclosure>
      <DisclosureSummary>
        <FolderInput className="size-4" />
        Go to a folder
      </DisclosureSummary>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            const target = folderTarget(value);
            if (target !== "/") {
              const parent = target.slice(0, target.lastIndexOf("/")) || "/";
              const response = await fetch(
                "/api/v1/fs/list?path=" + encodeURIComponent(parent),
              );
              const result = await response.json();
              if (!response.ok)
                throw new Error(result.error ?? "Could not open folder");
              const entry = result.entries.find(
                (entry: { path: string; kind: string }) =>
                  entry.path === target,
              );
              if (!entry)
                throw new Error("No accessible folder exists at that path.");
              if (entry.kind !== "folder")
                throw new Error(
                  "That path is a file. Enter its parent folder instead.",
                );
            }
            onNavigate(target);
          });
        }}
      >
        <Field
          label="Folder to open"
          required
          disabled={action.busy}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="/projects/release"
          maxLength={4096}
        />
        <div className="flex flex-wrap gap-2">
          <Button disabled={action.busy}>Open folder</Button>
          <Button
            type="button"
            variant="outline"
            disabled={action.busy || path === "/"}
            onClick={() =>
              onNavigate(path.slice(0, path.lastIndexOf("/")) || "/")
            }
          >
            Parent folder
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={action.busy || path === "/"}
            onClick={() => onNavigate("/")}
          >
            Workspace root
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Use a full path. Browser Back and Forward retrace folder navigation.
        </p>
        {action.error ? (
          <p role="alert" className="text-sm text-destructive">
            {action.error}
          </p>
        ) : null}
      </form>
    </Disclosure>
  );
}
