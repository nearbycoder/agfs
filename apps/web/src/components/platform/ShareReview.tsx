import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "~/components/ui/table";
import { Select, SelectItem } from "~/components/ui/select";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Field } from "./shared";
import {
  shareStatus,
  filterShares,
  type ReviewShare,
} from "~/lib/share-overview";
export function ShareReview({
  shares,
  refresh,
}: {
  shares: ReviewShare[];
  refresh: () => Promise<void>;
}) {
  const [filters, setFilters] = useState({ status: "", path: "", soon: false }),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [results, setResults] = useState<
      { path: string; ok: boolean; message: string }[]
    >([]),
    [error, setError] = useState(""),
    [now, setNow] = useState(Date.now),
    [page, setPage] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const visible = filterShares(shares, filters, now),
    eligible = visible.filter((s) => shareStatus(s, now) === "active"),
    chosen = eligible.filter((s) => selected.includes(s.id));
  const pages = Math.max(1, Math.ceil(visible.length / 50)),
    current = Math.min(page, pages - 1);
  function change(next: typeof filters) {
    setFilters(next);
    setSelected([]);
    setPage(0);
  }
  async function revoke(items: ReviewShare[]) {
    if (
      !items.length ||
      items.length > 50 ||
      !window.confirm(
        `Revoke ${items.length} selected share link${items.length === 1 ? "" : "s"}? These URLs will stop working immediately. Files remain unchanged.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    setResults([]);
    const outcomes: typeof results = [];
    const failed: string[] = [];
    try {
      for (const s of items) {
        try {
          const response = await fetch(
            "/api/v1/shares/" + encodeURIComponent(s.id),
            { method: "DELETE" },
          );
          if (!response.ok)
            throw new Error(
              (await response.json()).error ?? "Revocation failed",
            );
          outcomes.push({ path: s.path, ok: true, message: "Revoked" });
        } catch (e) {
          failed.push(s.id);
          outcomes.push({
            path: s.path,
            ok: false,
            message: e instanceof Error ? e.message : "Revocation failed",
          });
        }
        setResults([...outcomes]);
      }
      setSelected(failed);
      await refresh();
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not refresh shares");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4" aria-label="Share review">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Share path contains"
          disabled={busy}
          value={filters.path}
          onChange={(e) => change({ ...filters, path: e.target.value })}
        />
        <label className="grid gap-2 text-sm">
          Share status
          <Select
            placeholder="All statuses"
            aria-label="Share status"
            disabled={busy}
            value={filters.status}
            onValueChange={(value) => change({ ...filters, status: value })}
          >
            <SelectItem value="">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="revoked">Revoked</SelectItem>
          </Select>
        </label>
      </div>
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          disabled={busy}
          checked={filters.soon}
          onChange={(e) => change({ ...filters, soon: e.target.checked })}
        />
        Active links expiring within 24 hours
      </label>
      <p className="text-sm" role="status">
        {visible.length} matching of {shares.length} loaded links ·{" "}
        {shares.filter((s) => shareStatus(s, now) === "active").length} active ·{" "}
        {shares.filter((s) => shareStatus(s, now) === "expired").length} expired
      </p>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            void refresh()
              .then(() => setNow(Date.now()))
              .catch((e) =>
                setError(
                  e instanceof Error ? e.message : "Could not refresh shares",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          Refresh shares
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => change({ status: "", path: "", soon: false })}
        >
          Reset share filters
        </Button>
        <Button
          variant="outline"
          disabled={busy || !eligible.length}
          onClick={() => setSelected(eligible.slice(0, 50).map((s) => s.id))}
        >
          Select up to 50 active matches
        </Button>
        <Button
          disabled={busy || !chosen.length}
          onClick={() => void revoke(chosen)}
        >
          Revoke selected ({chosen.length})
        </Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {results.length ? (
        <ul aria-live="polite" className="rounded-lg border p-3 text-sm">
          {results.map((r, i) => (
            <li key={i} className="break-all">
              {r.ok ? "✓" : "Failed"} {r.path}: {r.message}
            </li>
          ))}
        </ul>
      ) : null}
      <Table scrollClassName="max-h-[40rem]" aria-label="Share review">
        <TableHeader>
          <TableRow>
            <TableHead>Select</TableHead>
            <TableHead>Path</TableHead>
            <TableHead>Expiry</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.slice(current * 50, current * 50 + 50).map((s) => {
            const status = shareStatus(s, now);
            return (
              <TableRow key={s.id} className="border-t">
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={"Select share " + s.path + " " + s.id.slice(-6)}
                    disabled={
                      busy ||
                      status !== "active" ||
                      (!selected.includes(s.id) && chosen.length >= 50)
                    }
                    checked={chosen.some((c) => c.id === s.id)}
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked
                          ? [...old, s.id]
                          : old.filter((id) => id !== s.id),
                      )
                    }
                  />
                </TableCell>
                <TableCell className="break-all font-mono">{s.path}</TableCell>
                <TableCell>
                  <time dateTime={s.expiresAt}>
                    {new Date(s.expiresAt).toLocaleString()}
                  </time>
                  {status === "active" ? (
                    <p className="text-xs text-muted-foreground">
                      {Math.ceil(
                        (new Date(s.expiresAt).getTime() - now) / 3600000,
                      )}{" "}
                      hours remaining
                    </p>
                  ) : null}
                </TableCell>
                <TableCell>{status}</TableCell>
                <TableCell>
                  {status === "active" ? (
                    <div className="flex gap-2">
                      <a
                        className="self-center underline"
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open
                      </a>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => void revoke([s])}
                      >
                        Revoke
                      </Button>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          disabled={busy || current === 0}
          onClick={() => setPage(current - 1)}
        >
          Previous shares
        </Button>
        <span className="self-center text-sm">
          Page {current + 1} of {pages}
        </span>
        <Button
          variant="outline"
          disabled={busy || current + 1 >= pages}
          onClick={() => setPage(current + 1)}
        >
          Next shares
        </Button>
      </div>
      {!visible.length ? (
        <p className="text-sm">No loaded shares match these filters.</p>
      ) : null}
    </section>
  );
}
