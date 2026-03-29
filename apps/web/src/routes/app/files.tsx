// @ts-nocheck
import type { ChangeEvent, FormEvent } from "react";
import { startTransition, useEffect, useEffectEvent, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { listEntriesResponseSchema, successResponseSchema } from "@agfs/contracts";

export const Route = createFileRoute("/app/files")({
  component: FilesPage,
});

function joinPath(base: string, name: string) {
  return base === "/" ? `/${name}` : `${base}/${name}`;
}

function formatBytes(value: number | null) {
  if (value == null) {
    return "Folder";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${Math.round(value / 102.4) / 10} kB`;
  }
  return `${Math.round(value / 104857.6) / 10} MB`;
}

function FilesPage() {
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<Array<ReturnType<typeof listEntriesResponseSchema.parse>["entries"][number]>>([]);
  const [folderName, setFolderName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const refreshEntries = useEffectEvent(async (nextPath: string) => {
    const response = await fetch(`/api/v1/fs/list?path=${encodeURIComponent(nextPath)}`);
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
      setError(cause instanceof Error ? cause.message : "Failed to load entries");
      setEntries([]);
    });
  }, [path, refreshEntries]);

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

  async function handleShare(targetPath: string) {
    const response = await fetch("/api/v1/shares", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: targetPath, ttl: "15m" }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "Failed to create share");
      return;
    }
    setShareUrl(payload.share.url);
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = event.currentTarget.files;
    if (!files?.length) {
      return;
    }

    await mutate(async () => {
      for (const file of Array.from(files)) {
        const remotePath = joinPath(path, file.name);
        const createResponse = await fetch("/api/v1/fs/upload-intents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            path: remotePath,
            contentType: file.type || "application/octet-stream",
            size: file.size,
          }),
        });
        const createPayload = await createResponse.json();
        if (!createResponse.ok) {
          throw new Error(createPayload.error ?? `Failed to create upload intent for ${file.name}`);
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
        const commitResponse = await fetch(`/api/v1/fs/uploads/${createPayload.uploadId}/commit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ etag }),
        });
        const commitPayload = await commitResponse.json();
        if (!commitResponse.ok) {
          throw new Error(commitPayload.error ?? `Failed to finalize ${file.name}`);
        }
      }
      event.currentTarget.value = "";
    });
  }

  return (
    <div className="panel-stack">
      <section className="panel panel-header">
        <div>
          <p className="eyebrow">File browser</p>
          <h2>{path}</h2>
        </div>
        <div className="toolbar">
          <button
            className="button button-secondary"
            disabled={path === "/" || isBusy}
            onClick={() => startTransition(() => setPath(path.slice(0, path.lastIndexOf("/")) || "/"))}
            type="button"
          >
            Up one level
          </button>
          <label className="button button-primary">
            Upload files
            <input hidden multiple onChange={handleUpload} type="file" />
          </label>
        </div>
      </section>

      {shareUrl ? (
        <section className="panel panel-accent">
          <p className="eyebrow">Latest share link</p>
          <a href={shareUrl} rel="noreferrer" target="_blank">
            {shareUrl}
          </a>
        </section>
      ) : null}

      {error ? (
        <section className="panel panel-warning">
          <p className="eyebrow">Request failed</p>
          <p>{error}</p>
        </section>
      ) : null}

      <section className="panel">
        <form className="inline-form" onSubmit={handleCreateFolder}>
          <input
            onChange={(event) => setFolderName(event.target.value)}
            placeholder="new-folder"
            value={folderName}
          />
          <button className="button button-secondary" disabled={isBusy} type="submit">
            Create folder
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="table-head">
          <span>Name</span>
          <span>Size</span>
          <span>Actions</span>
        </div>
        {entries.length === 0 ? (
          <p className="muted">This folder is empty.</p>
        ) : (
          <div className="table-list">
            {entries.map((entry) => (
              <article className="table-row" key={entry.id}>
                <button
                  className="linkish"
                  onClick={() => (entry.kind === "folder" ? setPath(entry.path) : undefined)}
                  type="button"
                >
                  <strong>{entry.name}</strong>
                  <small>{entry.kind}</small>
                </button>
                <span>{formatBytes(entry.size)}</span>
                <div className="row-actions">
                  {entry.kind === "file" ? (
                    <button className="button button-ghost" onClick={() => handleShare(entry.path)} type="button">
                      Share
                    </button>
                  ) : null}
                  <button className="button button-ghost" onClick={() => handleMove(entry.path)} type="button">
                    Move
                  </button>
                  <button
                    className="button button-ghost danger"
                    onClick={() => handleDelete(entry.path, entry.kind === "folder")}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
