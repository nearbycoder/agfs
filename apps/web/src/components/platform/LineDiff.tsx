import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { prepareLineDiff, lineDiffPage } from "~/lib/line-diff";

export function LineDiff({ before, after }: { before: string; after: string }) {
  const model = useMemo(() => prepareLineDiff(before, after), [before, after]);
  const [view, setView] = useState({ model, page: 0 });
  // A changed proposal starts at its first page, never a stale page of another revision.
  const { rows, page, pages, start, end } = lineDiffPage(
    model,
    view.model === model ? view.page : 0,
  );
  return (
    <div className="space-y-3">
      <pre
        aria-label="Line changes"
        className="max-h-96 overflow-auto rounded-lg border p-3 text-xs"
      >
        {rows.map((r, i) => (
          <div
            key={start + i}
            className={
              r.sign === "+"
                ? "bg-success/10 text-success"
                : r.sign === "−"
                  ? "bg-destructive/10 text-destructive"
                  : ""
            }
          >
            <span className="inline-block w-14 select-none opacity-60">
              {r.sign} {r.line}
            </span>
            {r.text || " "}
          </div>
        ))}
      </pre>
      {pages > 1 ? (
        <nav
          aria-label="Line change pages"
          className="flex flex-wrap items-center gap-3"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setView({ model, page: page - 1 })}
          >
            Previous changes
          </Button>
          <span role="status" className="text-xs text-muted-foreground">
            Rows {start + 1}–{end} of {model.total} · Page {page + 1} of {pages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page + 1 >= pages}
            onClick={() => setView({ model, page: page + 1 })}
          >
            Next changes
          </Button>
        </nav>
      ) : null}
    </div>
  );
}
