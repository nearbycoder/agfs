// @ts-nocheck
import { FileProperties } from "~/components/platform/FileProperties";
import { Select, SelectItem } from "~/components/ui/select";
import { directoryView, type DirectorySort } from "~/lib/directory-view";
import { ActionMenu, ActionMenuItem } from "~/components/ui/action-menu";
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { LoadingState, DetailSurface } from "~/components/platform/shared";
import type { ChangeEvent, FormEvent } from "react";
import {
  startTransition,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowUp,
  Copy,
  Download,
  FileImage,
  FileText,
  FileCode,
  FileSpreadsheet,
  FileArchive,
  Folder,
  FolderPlus,
  Link2,
  MoveRight,
  Trash2,
  Upload,
} from "lucide-react";
import {
  uploadResumable,
  listEntriesResponseSchema,
  successResponseSchema,
} from "@agfs/contracts";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button, buttonVariants } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { FolderUpload } from "~/components/platform/FolderUpload";
import { FolderReadme } from "~/components/platform/FolderReadme";
import { BatchRename } from "~/components/platform/BatchRename";
import { formatBytes } from "~/lib/format";
import { NOINDEX_ROBOTS, buildSeoHead, pageTitle } from "~/lib/seo";
import { cn } from "~/lib/utils";

export const Route = createFileRoute("/app/files")({
  validateSearch: (search: Record<string, unknown>): { path?: string } => ({
    path:
      typeof search.path === "string" && search.path.startsWith("/")
        ? search.path
        : "/",
  }),
  head: () =>
    buildSeoHead({
      title: pageTitle("Files"),
      description:
        "Browse private AGFS folders, upload artifacts, and create expiring download links from one workspace.",
      robots: NOINDEX_ROBOTS,
    }),
  component: FilesPage,
});

function joinPath(base: string, name: string) {
  return base === "/" ? `/${name}` : `${base}/${name}`;
}

function getDownloadHref(path: string) {
  return `/api/v1/fs/download?path=${encodeURIComponent(path)}`;
}

function triggerDownload(path: string) {
  const link = document.createElement("a");
  link.href = getDownloadHref(path);
  link.rel = "noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function EntryIcon({ name }: { name: string }) {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const Icon = ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"].includes(
    extension,
  )
    ? FileImage
    : ["csv", "tsv", "xlsx"].includes(extension)
      ? FileSpreadsheet
      : ["json", "js", "ts", "py", "html", "css", "yaml", "yml"].includes(
            extension,
          )
        ? FileCode
        : ["zip", "gz", "tar", "7z"].includes(extension)
          ? FileArchive
          : FileText;
  return <Icon className="size-4 text-foreground" />;
}

function FilesPage() {
  const propertiesOpened = useRef(false);
  const [propertyPath, setPropertyPath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [sort, setSort] = useState<DirectorySort>("name");
  const [page, setPage] = useState(0);
  const search = Route.useSearch();
  const path = search.path ?? "/";
  const navigate = Route.useNavigate();
  const setPath = (nextPath: string) => {
    void navigate({ search: { path: nextPath } });
  };
  const request = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<
    Array<ReturnType<typeof listEntriesResponseSchema.parse>["entries"][number]>
  >([]);
  const [folderName, setFolderName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copiedShare, setCopiedShare] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharePath, setSharePath] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const refreshEntries = useEffectEvent(async (nextPath: string) => {
    // A completed mutation must not replace a newer directory's contents.
    if (nextPath !== path) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/fs/list?path=${encodeURIComponent(nextPath)}`,
        { signal: controller.signal },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Failed to load entries");
      const parsed = listEntriesResponseSchema.parse(payload);
      if (!controller.signal.aborted) setEntries(parsed.entries);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(
          cause instanceof Error ? cause.message : "Failed to load entries",
        );
        setEntries([]);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  });

  useEffect(() => {
    setEntries([]);
    setQuery("");
    setPage(0);
    setSelectedPaths([]);
    void refreshEntries(path);
    return () => request.current?.abort();
  }, [path]);

  useEffect(() => {
    const currentFilePaths = new Set(
      entries
        .filter((entry) => entry.kind === "file")
        .map((entry) => entry.path),
    );
    setSelectedPaths((current) => {
      const next = current.filter((entryPath) =>
        currentFilePaths.has(entryPath),
      );
      return next.length === current.length ? current : next;
    });
  }, [entries]);

  const breadcrumbItems = useMemo(() => {
    const segments = path.split("/").filter(Boolean);

    return [
      { label: "root", value: "/" },
      ...segments.map((segment, index) => ({
        label: segment,
        value: `/${segments.slice(0, index + 1).join("/")}`,
      })),
    ];
  }, [path]);

  const folderCount = entries.filter((entry) => entry.kind === "folder").length;
  const fileCount = entries.filter((entry) => entry.kind === "file").length;
  const totalBytes = entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
  const matchingEntries = useMemo(
    () => directoryView(entries, query, kindFilter, sort),
    [entries, query, kindFilter, sort],
  );
  const pages = Math.max(1, Math.ceil(matchingEntries.length / 100));
  const currentPage = Math.min(page, pages - 1);
  const pageEntries = matchingEntries.slice(
    currentPage * 100,
    currentPage * 100 + 100,
  );
  const visibleFiles = pageEntries.filter((entry) => entry.kind === "file");
  const allVisibleFilesSelected =
    visibleFiles.length > 0 &&
    visibleFiles.every((entry) => selectedPaths.includes(entry.path));

  async function mutate(action: () => Promise<void>) {
    setIsBusy(true);
    setError(null);
    try {
      await action();
      await refreshEntries(path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleCreateFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!folderName.trim()) {
      return;
    }

    await mutate(async () => {
      const response = await fetch("/api/v1/fs/mkdir", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: joinPath(path, folderName.trim()) }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to create folder");
      }
      successResponseSchema.parse(payload);
      setFolderName("");
    });
  }

  async function handleDelete(targetPath: string, recursive = false) {
    await mutate(async () => {
      const response = await fetch("/api/v1/fs/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: targetPath, recursive }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete entry");
      }
      successResponseSchema.parse(payload);
    });
  }

  async function handleMove(from: string) {
    const to = window.prompt("Move to path", from);
    if (!to || to === from) {
      return;
    }

    await mutate(async () => {
      const response = await fetch("/api/v1/fs/move", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to move entry");
      }
      successResponseSchema.parse(payload);
    });
  }

  async function handleShare(targetPath: string, approvedEtag?: string) {
    const response = await fetch("/api/v1/shares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: targetPath, ttl: "15m", approvedEtag }),
    });
    const payload = await response.json();
    if (!response.ok) {
      if (payload.code === "secret_review_required") {
        const findings = payload.findings
          .map((f: any) => f.type + " at line " + f.line)
          .join("\n");
        if (
          window.confirm(
            "Potential secrets in " +
              targetPath +
              "\n" +
              findings +
              "\n\nReview the file first. Do you explicitly approve making this version public?",
          )
        ) {
          await handleShare(targetPath, payload.etag);
          return;
        }
      }
      setError(payload.error ?? "Failed to create share");
      return;
    }
    setCopiedShare(false);
    setShareUrl(payload.share.url);
    setSharePath(targetPath);
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const inputElement = event.currentTarget;
    const files = inputElement.files;
    if (!files?.length) {
      return;
    }

    await mutate(async () => {
      for (const file of Array.from(files)) {
        const remotePath = joinPath(path, file.name);
        const ifMatch =
          entries.find((entry) => entry.path === remotePath)?.etag ?? null;
        if (file.size > 0) {
          await uploadResumable({
            path: remotePath,
            ifMatch,
            contentType: file.type || "application/octet-stream",
            size: file.size,
            fingerprint: `${file.size}:${file.lastModified}:${file.name}`,
            request: fetch,
            read: (start, end) => file.slice(start, end).arrayBuffer(),
            progress: (bytes) =>
              setUploadProgress(
                `${file.name}: ${Math.round((bytes / file.size) * 100)}%`,
              ),
          });
          continue;
        }
        const createResponse = await fetch("/api/v1/fs/upload-intents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            path: remotePath,
            ifMatch,
            contentType: file.type || "application/octet-stream",
            size: file.size,
          }),
        });
        const createPayload = await createResponse.json();
        if (!createResponse.ok) {
          throw new Error(
            createPayload.error ??
              `Failed to create upload intent for ${file.name}`,
          );
        }

        const uploadResponse = await fetch(createPayload.url, {
          method: createPayload.method,
          headers: createPayload.headers,
          body: file,
        });
        if (!uploadResponse.ok) {
          throw new Error(`Failed to upload ${file.name} to R2`);
        }

        const etag = uploadResponse.headers.get("etag") ?? "uploaded";
        const commitResponse = await fetch(
          `/api/v1/fs/uploads/${createPayload.uploadId}/commit`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ etag }),
          },
        );
        const commitPayload = await commitResponse.json();
        if (!commitResponse.ok) {
          throw new Error(
            commitPayload.error ?? `Failed to finalize ${file.name}`,
          );
        }
      }
      inputElement.value = "";
      setUploadProgress(null);
    });
  }

  async function handleCopyShare() {
    if (!shareUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedShare(true);
    } catch {
      setError("Could not copy the link. Select and copy the URL instead.");
    }
  }

  function toggleSelection(targetPath: string) {
    setSelectedPaths((current) =>
      current.includes(targetPath)
        ? current.filter((entryPath) => entryPath !== targetPath)
        : [...current, targetPath],
    );
  }

  function toggleSelectAll() {
    if (allVisibleFilesSelected) {
      setSelectedPaths((old) =>
        old.filter((p) => !visibleFiles.some((e) => e.path === p)),
      );
      return;
    }

    setSelectedPaths((old) => [
      ...new Set([...old, ...visibleFiles.map((entry) => entry.path)]),
    ]);
  }

  function handleDownloadSelected() {
    if (!selectedPaths.length) {
      return;
    }

    selectedPaths.forEach((entryPath, index) => {
      window.setTimeout(() => {
        triggerDownload(entryPath);
      }, index * 180);
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-5">
        <div>
          <CardHeader className="space-y-5 p-0">
            <div className="space-y-3">
              <h1 className="dashboard-title">Files</h1>
              <CardDescription className="max-w-2xl">
                All your agent artifacts, organized in one place.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2 break-all text-sm text-muted-foreground">
              {breadcrumbItems.map((item, index) => (
                <div className="flex items-center gap-2" key={item.value}>
                  {index > 0 ? (
                    <span className="text-zinc-300 dark:text-zinc-700">/</span>
                  ) : null}
                  <button
                    className={cn(
                      "rounded-md px-2 py-1 transition-colors",
                      item.value === path
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-zinc-100 hover:text-zinc-950 dark:hover:bg-zinc-900 dark:hover:text-zinc-50",
                    )}
                    onClick={() => setPath(item.value)}
                    type="button"
                  >
                    {item.label}
                  </button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={path === "/" || isBusy}
                onClick={() =>
                  startTransition(() =>
                    setPath(path.slice(0, path.lastIndexOf("/")) || "/"),
                  )
                }
                type="button"
                variant="outline"
              >
                <ArrowUp className="size-4" />
                Up one level
              </Button>
              <label
                className={cn(
                  buttonVariants({ variant: "default" }),
                  "cursor-pointer relative focus-within:ring-2 focus-within:ring-ring",
                )}
              >
                <Upload className="size-4" />
                Upload files
                <input
                  disabled={isBusy}
                  className="sr-only"
                  multiple
                  onChange={handleUpload}
                  type="file"
                />
              </label>
              <Button
                disabled={!selectedPaths.length}
                onClick={handleDownloadSelected}
                type="button"
                variant="outline"
              >
                <Download className="size-4" />
                Download selected
                {selectedPaths.length ? ` (${selectedPaths.length})` : ""}
              </Button>
            </div>
          </CardHeader>
          <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
            {folderCount} folders <span className="mx-2">·</span> {fileCount}{" "}
            files <span className="mx-2">·</span> {formatBytes(totalBytes)} in
            this folder
          </p>
        </div>
      </div>

      {uploadProgress ? (
        <p className="section-copy" role="status">
          {uploadProgress}
        </p>
      ) : null}
      {previewUrl ? (
        <DetailSurface key={previewUrl} label="Preview ready">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <a
              className="underline"
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open isolated preview (expires in 5 minutes)
            </a>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPreviewUrl(null)}
            >
              Dismiss preview
            </Button>
          </div>
        </DetailSurface>
      ) : null}
      {shareUrl ? (
        <DetailSurface key={shareUrl} label="Share link ready">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">Share link ready</h2>
            <Button variant="ghost" size="sm" onClick={() => setShareUrl(null)}>
              Dismiss link
            </Button>
          </div>
          <div className="mt-3 space-y-3">
            {sharePath ? (
              <p className="text-sm font-medium text-foreground">{sharePath}</p>
            ) : null}
            <a
              className="block break-all text-sm leading-6 text-zinc-700 underline decoration-zinc-300 underline-offset-4 dark:text-zinc-200 dark:decoration-zinc-700"
              href={shareUrl}
              rel="noreferrer"
              target="_blank"
            >
              {shareUrl}
            </a>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={handleCopyShare}
                size="sm"
                type="button"
                variant="outline"
              >
                <Copy className="size-4" />
                {copiedShare ? "Copied" : "Copy link"}
              </Button>
              {sharePath ? (
                <Button asChild size="sm" type="button" variant="outline">
                  <a href={getDownloadHref(sharePath)}>
                    <Download className="size-4" />
                    Download file
                  </a>
                </Button>
              ) : null}
              <Button asChild size="sm" variant="ghost">
                <a href={shareUrl} rel="noreferrer" target="_blank">
                  Open
                </a>
              </Button>
            </div>
          </div>
        </DetailSurface>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Request failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {entries.find((e) => e.path === propertyPath) ? (
        <FileProperties
          key={propertyPath}
          entry={entries.find((e) => e.path === propertyPath)!}
          onClose={() => {
            const entry = entries.find((e) => e.path === propertyPath);
            setPropertyPath(null);
            if (entry)
              document.getElementById("file-menu-" + entry.id)?.focus();
          }}
        />
      ) : null}
      {selectedPaths.length ? (
        <BatchRename
          entries={entries.filter(
            (e) => e.kind === "file" && selectedPaths.includes(e.path),
          )}
          onComplete={async () => {
            await refreshEntries(path);
            setSelectedPaths([]);
          }}
        />
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Directory contents</CardTitle>
          <CardDescription>
            Select a file, or open its actions to preview, share, and manage it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_12rem]">
            <label className="grid gap-2 text-sm">
              Filter this folder
              <Input
                value={query}
                placeholder="Name or path…"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </label>
            <label className="grid gap-2 text-sm">
              Show
              <Select
                aria-label="Entry types"
                value={kindFilter}
                onValueChange={(value) => {
                  setKindFilter(value);
                  setPage(0);
                }}
              >
                <SelectItem value="">All entries</SelectItem>
                <SelectItem value="file">Files</SelectItem>
                <SelectItem value="folder">Folders</SelectItem>
              </Select>
            </label>
            <label className="grid gap-2 text-sm">
              Sort
              <Select
                aria-label="Sort entries"
                value={sort}
                onValueChange={(value) => {
                  setSort(value as DirectorySort);
                  setPage(0);
                }}
              >
                <SelectItem value="name">Name A–Z</SelectItem>
                <SelectItem value="name-desc">Name Z–A</SelectItem>
                <SelectItem value="size">Largest first</SelectItem>
                <SelectItem value="updated">Recently updated</SelectItem>
              </Select>
            </label>
          </div>
          <p role="status" className="text-xs text-muted-foreground">
            {matchingEntries.length} matching entries · {selectedPaths.length}{" "}
            files selected across pages · Folders sort first
          </p>
          {loading ? (
            <LoadingState label="Loading folder" />
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/70 px-6 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900/60">
              <Folder className="size-6 text-zinc-400 dark:text-zinc-500" />
              <p className="mt-4 text-sm font-medium text-foreground">
                {error ? "Folder could not be loaded" : "This folder is empty"}
              </p>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                Upload files, create a folder, or move back up to browse a
                different part of the namespace.
              </p>
            </div>
          ) : (
            <Table className="file-table" aria-label="Directory contents">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">
                    <input
                      aria-label="Select all files on this page"
                      checked={allVisibleFilesSelected}
                      className="size-4 rounded border-zinc-300 accent-zinc-950 dark:border-zinc-700 dark:accent-zinc-100"
                      onChange={toggleSelectAll}
                      type="checkbox"
                    />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageEntries.map((entry) => (
                  <TableRow
                    key={entry.id}
                    data-selected={selectedPaths.includes(entry.path)}
                  >
                    <TableCell>
                      {entry.kind === "file" ? (
                        <input
                          aria-label={`Select ${entry.name}`}
                          checked={selectedPaths.includes(entry.path)}
                          className="size-4 rounded border-zinc-300 accent-zinc-950 dark:border-zinc-700 dark:accent-zinc-100"
                          onChange={() => toggleSelection(entry.path)}
                          type="checkbox"
                        />
                      ) : null}
                    </TableCell>
                    <TableCell className="min-w-[160px]">
                      {entry.kind === "folder" ? (
                        <button
                          className="flex items-start gap-3 text-left"
                          onClick={() => setPath(entry.path)}
                          type="button"
                        >
                          <span className="rounded-xl border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900">
                            <Folder className="size-4 text-foreground" />
                          </span>
                          <span>
                            <span className="block font-medium text-foreground">
                              {entry.name}
                            </span>
                            <span className="entry-path block text-xs text-muted-foreground">
                              {entry.path}
                            </span>
                          </span>
                        </button>
                      ) : (
                        <a
                          className="group flex items-start gap-3 rounded-xl transition-colors hover:text-zinc-950 dark:hover:text-zinc-50"
                          href={getDownloadHref(entry.path)}
                        >
                          <span className="rounded-xl border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900">
                            <EntryIcon name={entry.name} />
                          </span>
                          <span>
                            <span className="block font-medium text-foreground underline decoration-transparent underline-offset-4 transition-colors group-hover:decoration-current">
                              {entry.name}
                            </span>
                            <span className="entry-path block text-xs text-muted-foreground">
                              {entry.path}
                            </span>
                          </span>
                        </a>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          entry.kind === "folder" ? "secondary" : "outline"
                        }
                      >
                        {entry.kind}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {formatBytes(entry.size, { nullLabel: "Folder" })}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <ActionMenu
                          triggerId={"file-menu-" + entry.id}
                          onCloseAutoFocus={(event) => {
                            if (propertiesOpened.current) {
                              event.preventDefault();
                              propertiesOpened.current = false;
                              document
                                .querySelector<HTMLElement>(
                                  '[aria-label="File properties"]',
                                )
                                ?.focus({ preventScroll: true });
                            }
                          }}
                          label={`Actions for ${entry.name}`}
                          disabled={isBusy}
                        >
                          <ActionMenuItem
                            onSelect={() => {
                              propertiesOpened.current = true;
                              setPropertyPath(entry.path);
                            }}
                          >
                            Properties
                          </ActionMenuItem>
                          {entry.kind === "file" ? (
                            <>
                              <ActionMenuItem asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={isBusy}
                                  onClick={() =>
                                    mutate(async () => {
                                      setPreviewUrl(null);
                                      const response = await fetch(
                                        "/api/v1/fs/preview",
                                        {
                                          method: "POST",
                                          headers: {
                                            "content-type": "application/json",
                                          },
                                          body: JSON.stringify({
                                            path: entry.path,
                                          }),
                                        },
                                      );
                                      const result = await response.json();
                                      if (!response.ok)
                                        throw new Error(result.error);
                                      setPreviewUrl(result.url);
                                    })
                                  }
                                >
                                  Preview
                                </Button>
                              </ActionMenuItem>
                              <ActionMenuItem asChild>
                                <Button asChild size="sm" variant="ghost">
                                  <a
                                    href={`/app/recovery?reason=version&path=${encodeURIComponent(entry.path)}`}
                                  >
                                    Versions
                                  </a>
                                </Button>
                              </ActionMenuItem>
                              <ActionMenuItem asChild>
                                <Button asChild size="sm" variant="ghost">
                                  <a href={getDownloadHref(entry.path)}>
                                    <Download className="size-4" />
                                    Download
                                  </a>
                                </Button>
                              </ActionMenuItem>
                              <ActionMenuItem asChild>
                                <Button
                                  onClick={() => handleShare(entry.path)}
                                  size="sm"
                                  type="button"
                                  variant="ghost"
                                >
                                  <Link2 className="size-4" />
                                  Share
                                </Button>
                              </ActionMenuItem>
                            </>
                          ) : null}
                          <ActionMenuItem asChild>
                            <Button
                              onClick={() => handleMove(entry.path)}
                              size="sm"
                              type="button"
                              variant="ghost"
                            >
                              <MoveRight className="size-4" />
                              Move
                            </Button>
                          </ActionMenuItem>
                          <ActionMenuItem asChild>
                            <Button
                              onClick={() =>
                                handleDelete(
                                  entry.path,
                                  entry.kind === "folder",
                                )
                              }
                              size="sm"
                              type="button"
                              variant="ghost"
                            >
                              <Trash2 className="size-4 text-red-500" />
                              Move to trash
                            </Button>
                          </ActionMenuItem>
                        </ActionMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!loading && !!entries.length && !matchingEntries.length ? (
            <p className="empty-state rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              No entries match. Clear the name or type filter to show more.
            </p>
          ) : null}
          {pages > 1 ? (
            <nav
              aria-label="Directory pages"
              className="flex flex-wrap items-center gap-3"
            >
              <Button
                variant="outline"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous entries
              </Button>
              <span className="text-sm">
                Page {currentPage + 1} of {pages}
              </span>
              <Button
                variant="outline"
                disabled={currentPage + 1 >= pages}
                onClick={() => setPage(currentPage + 1)}
              >
                Next entries
              </Button>
            </nav>
          ) : null}
        </CardContent>
      </Card>
      <div className="grid gap-5">
        <Disclosure>
          <DisclosureSummary>Create a folder</DisclosureSummary>
          <form className="space-y-3" onSubmit={handleCreateFolder}>
            <div className="space-y-2">
              <label className="section-label" htmlFor="folder-name">
                New folder
              </label>
              <Input
                id="folder-name"
                onChange={(event) => setFolderName(event.target.value)}
                placeholder="screenshots"
                value={folderName}
              />
            </div>
            <Button disabled={isBusy} type="submit" variant="outline">
              <FolderPlus className="size-4" />
              Create folder
            </Button>
          </form>
        </Disclosure>
        <FolderReadme entries={entries} />
        <FolderUpload
          destination={path}
          onComplete={async () => {
            await refreshEntries(path);
          }}
        />
      </div>
    </div>
  );
}
