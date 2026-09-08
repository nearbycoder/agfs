import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Field, platform, useAction } from "./shared";
export function TextToolSource({
  label,
  onLoad,
}: {
  label: string;
  onLoad: (file: { path: string; text: string }) => void;
}) {
  const [path, setPath] = useState("");
  const action = useAction();
  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            const file = await platform(
              "/text?path=" + encodeURIComponent(path),
            );
            onLoad(file);
          });
        }}
      >
        <Field
          label={label + " file path"}
          required
          value={path}
          disabled={action.busy}
          onChange={(e) => setPath(e.target.value)}
        />
        <Button disabled={action.busy}>Load {label}</Button>
      </form>
      {action.error ? (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      ) : null}
    </div>
  );
}
