import { FolderOpen, LoaderCircle } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  const request = useRef<AbortController | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const data = await platform(path, "GET", undefined, controller.signal);
      if (!controller.signal.aborted) {
        setItems(data[key]);
        setNextCursor(data.nextCursor ?? null);
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Could not load items");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [path, key]);
  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    void refresh();
    return () => request.current?.abort();
  }, [refresh]);
  async function loadMore() {
    if (!nextCursor || loading) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const data = await platform(
        path +
          (path.includes("?") ? "&" : "?") +
          "cursor=" +
          encodeURIComponent(nextCursor),
        "GET",
        undefined,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setItems((old) => {
          const seen = new Set(old.map((item) => item.id));
          return [
            ...old,
            ...data[key].filter((item: any) => {
              if (seen.has(item.id)) return false;
              seen.add(item.id);
              return true;
            }),
          ];
        });
        setNextCursor(data.nextCursor ?? null);
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Could not load page");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
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
export function LoadingState({
  label = "Loading workspace",
}: {
  label?: string;
}) {
  return (
    <div
      role="status"
      className="loading-state rounded-xl border bg-muted/20 p-6"
    >
      <span className="mb-5 flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 motion-safe:animate-spin" />
        {label}…
      </span>
      <div aria-hidden="true" className="space-y-3">
        {["w-3/4", "w-full", "w-1/2"].map((width) => (
          <div
            key={width}
            className={
              "h-3 rounded bg-muted motion-safe:animate-pulse " + width
            }
          />
        ))}
      </div>
    </div>
  );
}
export function Empty({ loading, text }: { loading: boolean; text: string }) {
  if (loading) return <LoadingState />;
  return (
    <div className="empty-state flex flex-col items-center rounded-xl border border-dashed bg-muted/20 px-6 py-10 text-center">
      <span className="mb-4 rounded-xl border bg-card p-3 shadow-sm">
        <FolderOpen className="size-5 text-muted-foreground" />
      </span>
      <p className="max-w-md text-sm leading-6 text-muted-foreground">{text}</p>
    </div>
  );
}

export function DetailSurface({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView({ block: "nearest" });
  }, []);
  return (
    <section
      ref={panel}
      tabIndex={-1}
      aria-label={label}
      className="detail-surface space-y-5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </section>
  );
}
