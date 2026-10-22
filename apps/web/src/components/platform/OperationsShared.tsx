import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Alert, AlertDescription } from "~/components/ui/alert";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "~/components/ui/table";
import { useBrowserRead } from "~/lib/use-browser-read";
import {
  appendOperationPage,
  createOperationReview,
  type OperationPage,
} from "~/lib/browser-operations";
import { ResultPageControls, useResultPage } from "./ResultPage";

export function useOperation<T>() {
  const reader = useBrowserRead(),
    [value, setValue] = useState<T | null>(null),
    [writing, setWriting] = useState(false),
    [writeError, setWriteError] = useState(""),
    [lane, setLane] = useState<"read" | "write">("read"),
    [showError, setShowError] = useState(false);
  const locked = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function clear() {
    reader.cancel();
    setValue(null);
    setWriteError("");
    setShowError(false);
  }
  async function read(
    load: (signal: AbortSignal) => Promise<T>,
    commit?: (value: T) => void,
  ) {
    if (locked.current) return;
    setLane("read");
    setShowError(true);
    await reader.run(load, (next) => {
      setValue(next);
      commit?.(next);
    });
  }
  async function write(load: () => Promise<T>, commit?: (value: T) => void) {
    if (locked.current) return;
    locked.current = true;
    reader.cancel();
    setWriting(true);
    setLane("write");
    setWriteError("");
    setShowError(true);
    try {
      const next = await load();
      if (mounted.current) {
        setValue(next);
        commit?.(next);
      }
    } catch (error) {
      if (mounted.current)
        setWriteError(
          error instanceof Error ? error.message : "Operation failed",
        );
    } finally {
      locked.current = false;
      if (mounted.current) setWriting(false);
    }
  }
  return {
    value,
    setValue,
    read,
    write,
    clear,
    busy: reader.busy || writing,
    reading: reader.busy,
    writing,
    cancel: reader.cancel,
    error: showError ? (lane === "read" ? reader.error : writeError) : "",
  };
}
export function useOperationPage<
  T,
  P extends OperationPage<T> = OperationPage<T>,
>() {
  const request = useOperation<P>();
  const [page, setPage] = useState<P | null>(null);
  function clear() {
    request.clear();
    setPage(null);
  }
  async function load(get: (signal: AbortSignal) => Promise<P>, more = false) {
    if (!more) {
      request.clear();
      setPage(null);
    }
    await request.read(async (signal) => {
      const next = await get(signal);
      return (more ? appendOperationPage(page, next) : next) as P;
    }, setPage);
  }
  return { ...request, page, clear, load };
}
export function useReviewedOperation<Q, T>() {
  const action = useOperation<T>(),
    [gate] = useState(() => createOperationReview<Q, T>()),
    [review, setReview] = useState<{
      scope: string;
      request: Q;
      value: T;
    } | null>(null);
  function clear() {
    gate.clear();
    setReview(null);
    action.clear();
  }
  async function preview(
    scope: string,
    request: Q,
    load: (signal: AbortSignal) => Promise<T>,
    reviewedRequest?: (value: T) => Q,
  ) {
    clear();
    await action.read(load, (value) =>
      setReview(
        gate.stage(
          scope,
          reviewedRequest ? reviewedRequest(value) : request,
          value,
        ),
      ),
    );
  }
  async function apply(scope: string, load: (request: Q) => Promise<T>) {
    await action.write(async () => {
      const saved = gate.consume(scope);
      setReview(null);
      return load(saved.request);
    });
  }
  function cancel() {
    gate.clear();
    setReview(null);
    action.cancel();
  }
  return { ...action, review, clear, preview, apply, cancel };
}
export function OperationFeedback({
  action,
}: {
  action: {
    error: string;
    reading: boolean;
    writing: boolean;
    cancel: () => void;
  };
}) {
  const error = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (action.error) error.current?.focus();
  }, [action.error]);
  return (
    <>
      {action.reading ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="status" className="text-sm">
            Loading requested view…
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={action.cancel}
          >
            Cancel loading
          </Button>
        </div>
      ) : null}
      {action.writing ? (
        <p role="status" className="text-sm">
          Applying operation… Keep this page open to see the result.
        </p>
      ) : null}
      {action.error ? (
        <Alert ref={error} tabIndex={-1} variant="destructive">
          <AlertDescription>{action.error}</AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}
export function OperationTable<T>({
  label,
  rows,
  columns,
  rowKey,
  selected,
  onSelect,
  disabled = false,
}: {
  label: string;
  rows: T[];
  columns: { label: string; render: (row: T) => ReactNode }[];
  rowKey: (row: T) => string;
  selected?: string[];
  onSelect?: (id: string, checked: boolean) => void;
  disabled?: boolean;
}) {
  const page = useResultPage(rows);
  return (
    <div className="space-y-3">
      {!rows.length ? (
        <p
          role="status"
          className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
        >
          No matches in the loaded page. If a next page is available, it may
          contain matches.
        </p>
      ) : (
        <Table aria-label={label} scrollClassName="max-h-96">
          <TableHeader>
            <TableRow>
              {onSelect ? <TableHead>Select</TableHead> : null}
              {columns.map((column) => (
                <TableHead key={column.label}>{column.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.rows.map((row) => (
              <TableRow key={rowKey(row)}>
                {onSelect ? (
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={"Select " + rowKey(row)}
                      checked={selected?.includes(rowKey(row)) ?? false}
                      disabled={disabled}
                      onChange={(event) =>
                        onSelect(rowKey(row), event.target.checked)
                      }
                    />
                  </TableCell>
                ) : null}
                {columns.map((column) => (
                  <TableCell
                    key={column.label}
                    className="max-w-96 break-words whitespace-pre-wrap"
                  >
                    {column.render(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <ResultPageControls {...page} label={label.toLowerCase()} />
    </div>
  );
}
export function MoreOperations({
  page,
  busy,
  load,
}: {
  page: OperationPage<unknown> | null;
  busy: boolean;
  load: () => void;
}) {
  return page?.nextCursor ? (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="outline"
        disabled={busy || page.results.length >= 500}
        onClick={load}
      >
        Load next page
      </Button>
      <p className="text-xs text-muted-foreground">
        More candidates remain. Up to 500 matching rows are retained in this
        view.
      </p>
    </div>
  ) : null;
}
export function toggleOperationSelection(
  ids: string[],
  id: string,
  checked: boolean,
  limit: number,
) {
  return checked
    ? ids.includes(id) || ids.length >= limit
      ? ids
      : [...ids, id]
    : ids.filter((item) => item !== id);
}
