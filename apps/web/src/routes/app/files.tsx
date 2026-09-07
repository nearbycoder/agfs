// @ts-nocheck
import type { ChangeEvent, FormEvent } from "react";
import {
  startTransition,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowUp,
  Copy,
  Download,
  FileImage,
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

function FilesPage() {
  const search = Route.useSearch();
  const [path, setPath] = useState(search.path ?? "/");
  const [entries, setEntries] = useState<
    Array<ReturnType<typeof listEntriesResponseSchema.parse>["entries"][number]>
  >([]);
  const [folderName, setFolderName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [sharePath, setSharePath] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const refreshEntries = useEffectEvent(async (nextPath: string) => {
    const response = await fetch(
      `/api/v1/fs/list?path=${encodeURIComponent(nextPath)}`,
    );
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Failed to load entries");
    }

    const parsed = listEntriesResponseSchema.parse(payload);
    setEntries(parsed.entries);
  });

  useEffect(() => {
    setError(null);
    void refreshEntries(path).catch((cause: unknown) => {
      setError(
        cause instanceof Error ? cause.message : "Failed to load entries",
      );
      setEntries([]);
    });
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
  const visibleFiles = entries.filter((entry) => entry.kind === "file");
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

    await navigator.clipboard.writeText(shareUrl);
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
      setSelectedPaths([]);
      return;
    }

    setSelectedPaths(visibleFiles.map((entry) => entry.path));
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
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <Card>
          <CardHeader className="space-y-5">
            <Badge className="w-fit" variant="secondary">
              Filesystem
            </Badge>
            <div className="space-y-3">
              <CardTitle className="dashboard-title">{path}</CardTitle>
              <CardDescription className="max-w-2xl">
                Browse your private files, upload artifacts with automatic
                resume, and create expiring download links.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              {breadcrumbItems.map((item, index) => (
                <div className="flex items-center gap-2" key={item.value}>
                  {index > 0 ? (
                    <span className="text-zinc-300 dark:text-zinc-700">/</span>
                  ) : null}
                  <button
                    className={cn(
                      "rounded-full px-2 py-1 transition-colors",
                      item.value === path
                        ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950"
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
                  "cursor-pointer",
                )}
              >
                <Upload className="size-4" />
                Upload files
                <input
                  disabled={isBusy}
                  hidden
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
          <CardContent>
            <div className="mini-grid">
              <div className="mini-stat">
                <p className="section-label">Folders</p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-zinc-950 dark:text-zinc-50">
                  {folderCount}
                </p>
              </div>
              <div className="mini-stat">
                <p className="section-label">Files</p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-zinc-950 dark:text-zinc-50">
                  {fileCount}
                </p>
              </div>
              <div className="mini-stat">
                <p className="section-label">Bytes in view</p>
                <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-zinc-950 dark:text-zinc-50">
                  {formatBytes(totalBytes)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Badge className="w-fit" variant="secondary">
              Operations
            </Badge>
            <CardTitle>Create a folder or hand back a download link.</CardTitle>
            <CardDescription>
              Keep the filesystem tidy and surface a fresh share URL whenever an
              agent uploads a new artifact.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
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

            <div className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
              <p className="section-label">Latest share link</p>
              {shareUrl ? (
                <div className="mt-3 space-y-3">
                  {sharePath ? (
                    <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                      {sharePath}
                    </p>
                  ) : null}
                  <a
                    className="block break-all text-sm leading-6 text-zinc-700 underline decoration-zinc-300 underline-offset-4 dark:text-zinc-200 dark:decoration-zinc-700"
                    href={shareUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {shareUrl}
                  </a>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleCopyShare}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Copy className="size-4" />
                      Copy
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
              ) : (
                <p className="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                  Generate a share from any file row to surface an expiring
                  download URL here.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <p className="section-copy" role="status">
        {uploadProgress ??
          "Uploads resume when you select the same file again. Up to 20 GB per file, within your available storage."}
      </p>
      {previewUrl ? (
        <a
          className="underline"
          href={previewUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open isolated preview (expires in 5 minutes)
        </a>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Request failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Directory contents</CardTitle>
          <CardDescription>
            Folders open in place. Files can be selected, downloaded, shared,
            renamed, or removed from the current path.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 px-6 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900/60">
              <Folder className="size-6 text-zinc-400 dark:text-zinc-500" />
              <p className="mt-4 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                This folder is empty
              </p>
              <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                Upload files, create a folder, or move back up to browse a
                different part of the namespace.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">
                    <input
                      aria-label="Select all files"
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
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
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
                    <TableCell className="min-w-[280px]">
                      {entry.kind === "folder" ? (
                        <button
                          className="flex items-start gap-3 text-left"
                          onClick={() => setPath(entry.path)}
                          type="button"
                        >
                          <span className="rounded-xl border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900">
                            <Folder className="size-4 text-zinc-700 dark:text-zinc-300" />
                          </span>
                          <span>
                            <span className="block font-medium text-zinc-950 dark:text-zinc-50">
                              {entry.name}
                            </span>
                            <span className="block text-sm text-zinc-500 dark:text-zinc-400">
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
                            <FileImage className="size-4 text-zinc-700 dark:text-zinc-300" />
                          </span>
                          <span>
                            <span className="block font-medium text-zinc-950 dark:text-zinc-50 underline decoration-transparent underline-offset-4 transition-colors group-hover:decoration-current">
                              {entry.name}
                            </span>
                            <span className="block text-sm text-zinc-500 dark:text-zinc-400">
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
                      <div className="flex justify-end gap-2">
                        {entry.kind === "file" ? (
                          <>
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
                            <Button asChild size="sm" variant="ghost">
                              <a
                                href={`/app/recovery?reason=version&path=${encodeURIComponent(entry.path)}`}
                              >
                                Versions
                              </a>
                            </Button>
                            <Button asChild size="sm" variant="ghost">
                              <a href={getDownloadHref(entry.path)}>
                                <Download className="size-4" />
                                Download
                              </a>
                            </Button>
                            <Button
                              onClick={() => handleShare(entry.path)}
                              size="sm"
                              type="button"
                              variant="ghost"
                            >
                              <Link2 className="size-4" />
                              Share
                            </Button>
                          </>
                        ) : null}
                        <Button
                          onClick={() => handleMove(entry.path)}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          <MoveRight className="size-4" />
                          Move
                        </Button>
                        <Button
                          onClick={() =>
                            handleDelete(entry.path, entry.kind === "folder")
                          }
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          <Trash2 className="size-4 text-red-500" />
                          Move to trash
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
