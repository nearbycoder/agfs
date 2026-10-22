import { useState } from "react";
import { Button } from "~/components/ui/button";

export function resultPage<T>(
  rows: readonly T[],
  requested: number,
  size = 100,
) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.max(0, Math.min(requested, pages - 1));
  return {
    rows: rows.slice(page * size, (page + 1) * size),
    page,
    pages,
    total: rows.length,
  };
}
export function useResultPage<T>(rows: readonly T[]) {
  const [selection, setSelection] = useState({ source: rows, page: 0 });
  const model = resultPage(
    rows,
    selection.source === rows ? selection.page : 0,
  );
  return {
    ...model,
    select: (page: number) => setSelection({ source: rows, page }),
  };
}
export function ResultPageControls({
  page,
  pages,
  select,
  label,
}: {
  page: number;
  pages: number;
  select: (page: number) => void;
  label: string;
}) {
  if (pages <= 1) return null;
  return (
    <nav
      aria-label={label + " pages"}
      className="flex flex-wrap items-center gap-3"
    >
      <Button
        variant="outline"
        disabled={!page}
        onClick={() => select(page - 1)}
      >
        Previous {label}
      </Button>
      <span role="status">
        Page {page + 1} of {pages}
      </span>
      <Button
        variant="outline"
        disabled={page + 1 >= pages}
        onClick={() => select(page + 1)}
      >
        Next {label}
      </Button>
    </nav>
  );
}
