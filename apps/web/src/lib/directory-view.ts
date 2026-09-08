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
  const needle = query.trim().toLowerCase();
  return entries
    .filter(
      (e) =>
        (!kind || e.kind === kind) &&
        (!needle || (e.name + " " + e.path).toLowerCase().includes(needle)),
    )
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      if (sort === "size")
        return (
          (b.size ?? 0) - (a.size ?? 0) || collator.compare(a.name, b.name)
        );
      if (sort === "updated")
        return (
          (Date.parse(b.updatedAt ?? "") || 0) -
            (Date.parse(a.updatedAt ?? "") || 0) ||
          collator.compare(a.name, b.name)
        );
      return collator.compare(a.name, b.name) * (sort === "name-desc" ? -1 : 1);
    });
}
