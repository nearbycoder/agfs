export function folderUploadPlan<
  T extends { webkitRelativePath: string; size: number; name: string },
>(files: T[], destination: string) {
  if (!files.length || files.length > 500)
    throw new Error("Choose a folder containing between 1 and 500 files.");
  if (
    !destination.startsWith("/") ||
    (destination !== "/" && destination.endsWith("/"))
  )
    throw new Error("Choose a valid destination folder.");
  if (
    destination !== "/" &&
    destination
      .slice(1)
      .split("/")
      .some(
        (s) =>
          !s ||
          s === "." ||
          s === ".." ||
          s.trim() !== s ||
          /[\\\x00-\x1f\x7f]/.test(s),
      )
  )
    throw new Error("Destination must use canonical folder names.");
  const seen = new Set<string>();
  return files.map((file) => {
    const relative = file.webkitRelativePath;
    const segments = relative.split("/");
    if (
      segments.length < 2 ||
      segments.some(
        (s) =>
          !s ||
          s === "." ||
          s === ".." ||
          s.trim() !== s ||
          s.length > 255 ||
          /[/\\\x00-\x1f\x7f]/.test(s),
      )
    )
      throw new Error(
        "Folder paths must have valid, unambiguous names (no relative segments, surrounding whitespace or control characters).",
      );
    const path = (destination === "/" ? "" : destination) + "/" + relative;
    if (
      path.length > 4096 ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > 20 * 1024 ** 3
    )
      throw new Error(
        "A file exceeds the supported path length or 20 GiB size limit.",
      );
    if (seen.has(path))
      throw new Error("Multiple files resolve to the same destination.");
    seen.add(path);
    return { file, path };
  });
}
