import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "~/components/ui/card";
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
  const [items, setItems] = useState<any[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const data = await platform(path, "GET", undefined, signal);
        if (!signal?.aborted) setItems(data[key]);
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
  return { items, refresh, error, loading };
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
    <Card>
      <CardHeader>
        <CardTitle className="dashboard-title">
          <h1>{title}</h1>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error ? (
          <p role="alert" className="text-red-600">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="rounded-xl border p-4 break-all">
            {notice}
          </p>
        ) : null}
        {children}
      </CardContent>
    </Card>
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
export const selectClass =
  "h-10 w-full rounded-md border bg-transparent px-3 text-sm";
export function Empty({ loading, text }: { loading: boolean; text: string }) {
  return (
    <p className="rounded-xl border border-dashed p-8 text-center text-zinc-500">
      {loading ? "Loading…" : text}
    </p>
  );
}
