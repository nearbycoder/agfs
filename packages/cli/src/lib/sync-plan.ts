export interface SyncVersion {
  local: string;
  remote: string;
}
export type SyncOperation =
  | "upload"
  | "download"
  | "delete-local"
  | "delete-remote"
  | "compare"
  | "conflict"
  | "unchanged";
export function syncOperation(
  local: string | undefined,
  remote: string | undefined,
  base: SyncVersion | undefined,
  propagateDeletes = false,
): SyncOperation {
  if (!base) {
    if (local && remote) return "compare";
    return local ? "upload" : remote ? "download" : "unchanged";
  }
  const localChanged = local !== base.local,
    remoteChanged = remote !== base.remote;
  if (!localChanged && !remoteChanged) return "unchanged";
  if (localChanged && remoteChanged)
    return !local && !remote ? "unchanged" : "conflict";
  if (!local) return propagateDeletes ? "delete-remote" : "unchanged";
  if (!remote) return propagateDeletes ? "delete-local" : "unchanged";
  return localChanged ? "upload" : "download";
}
export function ignoredPath(relative: string, patterns: string[]) {
  const parts = relative.split("/");
  if (
    parts.some(
      (p) =>
        p === ".git" ||
        p === "node_modules" ||
        p === ".agfsignore" ||
        p.startsWith(".agfs-") ||
        p === ".env" ||
        p.startsWith(".env."),
    )
  )
    return true;
  return patterns.some((pattern) => {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "\u0000")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/\u0000/g, ".*");
    return new RegExp(
      "^(?:" +
        (pattern.includes("/") ? "" : "(?:.*/)?") +
        escaped.replace(/\/$/, "") +
        ")(?:/.*)?$",
    ).test(relative);
  });
}
