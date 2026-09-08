export type PathCopyFormat = "lines" | "json" | "shell";
export function selectionCopy(paths: string[], format: PathCopyFormat) {
  const unique = [...new Set(paths)];
  if (
    unique.length > 5000 ||
    unique.some(
      (path) => !path.startsWith("/") || /[\u0000-\u001f\u007f]/.test(path),
    )
  )
    throw new Error("Choose at most 5,000 valid absolute paths.");
  const value =
    format === "json"
      ? JSON.stringify(unique, null, 2)
      : format === "shell"
        ? unique
            .map((path) => "'" + path.replace(/'/g, "'\"'\"'") + "'")
            .join(" ")
        : unique.join("\n");
  if (new TextEncoder().encode(value).length > 1048576)
    throw new Error(
      "This selection exceeds the 1 MiB clipboard limit. Select fewer files.",
    );
  return value;
}
