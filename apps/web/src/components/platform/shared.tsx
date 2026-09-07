import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Input } from "~/components/ui/input";
export async function platform(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
) {
  const response = await fetch("/api/v1/platform" + path, {
    method,
    signal,
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Request failed");
  return value;
}
export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, notice, setNotice, run };
}
export function useData(path: string, key: string) {
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const data = await platform(path, "GET", undefined, signal);
        if (!signal?.aborted) {
          setItems(data[key]);
          setNextCursor(data.nextCursor ?? null);
        }
      } catch (e) {
        if (!signal?.aborted)
          setError(e instanceof Error ? e.message : "Could not load items");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [path, key],
  );
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  async function loadMore() {
    if (!nextCursor || loading) return;
    setLoading(true);
    try {
      const data = await platform(
        path +
          (path.includes("?") ? "&" : "?") +
          "cursor=" +
          encodeURIComponent(nextCursor),
      );
      setItems((old) => [
        ...old,
        ...data[key].filter((r: any) => !old.some((v) => v.id === r.id)),
      ]);
      setNextCursor(data.nextCursor ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load page");
    } finally {
      setLoading(false);
    }
  }
  return { items, refresh, error, loading, nextCursor, loadMore };
}
export function Page({
  title,
  description,
  children,
  error,
  notice,
}: {
  title: string;
  description: string;
  children: ReactNode;
  error?: string;
  notice?: string;
}) {
  return (
    <section className="workspace-page">
      <header className="workspace-page-heading">
        <h1 className="dashboard-title">{title}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </header>
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="rounded-lg border border-primary/20 bg-accent p-4 text-sm break-all"
        >
          {notice}
        </p>
      ) : null}
      <div className="workspace-page-body">{children}</div>
    </section>
  );
}
export function Field({
  label,
  ...props
}: React.ComponentProps<typeof Input> & { label: string }) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      {label}
      <Input {...props} />
    </label>
  );
}
export function Empty({ loading, text }: { loading: boolean; text: string }) {
  return (
    <p className="rounded-lg border border-dashed bg-muted/40 px-6 py-12 text-center text-sm leading-6 text-muted-foreground">
      {loading ? "Loading…" : text}
    </p>
  );
}
