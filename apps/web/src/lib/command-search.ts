export function fileSearchCommands(items: unknown) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 20).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { path, kind } = item as Record<string, unknown>;
    if (
      typeof path !== "string" ||
      !path.startsWith("/") ||
      path.length > 4096 ||
      /[\x00-\x1f\x7f\\]/.test(path) ||
      (kind !== "file" && kind !== "folder")
    )
      return [];
    const folder =
      kind === "folder" ? path : path.slice(0, path.lastIndexOf("/")) || "/";
    return [
      {
        label: (kind === "folder" ? "Open folder: " : "Locate file: ") + path,
        href: "/app/files?path=" + encodeURIComponent(folder),
        id: "file:" + path,
      },
    ];
  });
}
