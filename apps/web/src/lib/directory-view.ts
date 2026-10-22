export type DirectoryEntry = {
  name: string;
  path: string;
  kind: string;
  size?: number | null;
  updatedAt?: string;
};
export type DirectorySort = "name" | "name-desc" | "size" | "updated";
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
export function directoryView<T extends DirectoryEntry>(
  entries: T[],
  query: string,
  kind: string,
  sort: DirectorySort,
): T[] {
  return filterDirectory(prepareDirectory(entries, sort), query, kind);
}

/** Component-owned snapshot: rebuild only when entries or the sort changes. */
export function prepareDirectory<T extends DirectoryEntry>(
  entries: T[],
  sort: DirectorySort,
) {
  let folderCount = 0,
    fileCount = 0,
    totalBytes = 0;
  const byPath = new Map<string, T>();
  const ordered = entries.map((entry) => {
    if (entry.kind === "folder") folderCount++;
    if (entry.kind === "file") fileCount++;
    totalBytes += entry.size ?? 0;
    byPath.set(entry.path, entry);
    return {
      entry,
      searchText: (entry.name + " " + entry.path).toLowerCase(),
      updated: sort === "updated" ? Date.parse(entry.updatedAt ?? "") || 0 : 0,
    };
  });
  ordered.sort((a, b) => {
    if (a.entry.kind !== b.entry.kind)
      return a.entry.kind === "folder" ? -1 : 1;
    if (sort === "size")
      return (
        (b.entry.size ?? 0) - (a.entry.size ?? 0) ||
        collator.compare(a.entry.name, b.entry.name)
      );
    if (sort === "updated")
      return (
        b.updated - a.updated || collator.compare(a.entry.name, b.entry.name)
      );
    return (
      collator.compare(a.entry.name, b.entry.name) *
      (sort === "name-desc" ? -1 : 1)
    );
  });
  return { ordered, byPath, folderCount, fileCount, totalBytes };
}

/** Query changes scan cached search text without sorting or reparsing dates. */
export function filterDirectory<T extends DirectoryEntry>(
  prepared: ReturnType<typeof prepareDirectory<T>>,
  query: string,
  kind: string,
): T[] {
  const needle = query.trim().toLowerCase();
  const matches: T[] = [];
  for (const { entry, searchText } of prepared.ordered) {
    if (
      (!kind || entry.kind === kind) &&
      (!needle || searchText.includes(needle))
    )
      matches.push(entry);
  }
  return matches;
}
