import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Field, platform } from "./shared";
import { useBrowserRead } from "~/lib/use-browser-read";
export function TextToolSource({
  label,
  onLoad,
  disabled = false,
}: {
  label: string;
  onLoad: (file: { path: string; text: string }) => void;
  disabled?: boolean;
}) {
  const [path, setPath] = useState("");
  const action = useBrowserRead();
  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(
            (signal) =>
              platform(
                "/text?path=" + encodeURIComponent(path),
                "GET",
                undefined,
                signal,
              ),
            onLoad,
          );
        }}
      >
        <Field
          label={label + " file path"}
          required
          value={path}
          disabled={action.busy || disabled}
          onChange={(e) => setPath(e.target.value)}
        />
        <Button disabled={action.busy || disabled}>Load {label}</Button>
        {action.busy ? (
          <Button type="button" variant="outline" onClick={action.cancel}>
            Cancel loading {label}
          </Button>
        ) : null}
      </form>
      {action.error ? (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      ) : null}
    </div>
  );
}
