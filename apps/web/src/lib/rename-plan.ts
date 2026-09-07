export type RenameEntry = {
  id: string;
  path: string;
  name: string;
  etag: string | null;
};
export function renamePlan(
  entries: RenameEntry[],
  options: {
    prefix: string;
    suffix: string;
    find: string;
    replacement: string;
    preserveExtension: boolean;
  },
) {
  if (!entries.length || entries.length > 50)
    throw new Error("Select between 1 and 50 files.");
  const changes = entries
    .map((entry) => {
      const dot = entry.name.lastIndexOf(".");
      const split =
        options.preserveExtension && dot > 0 ? dot : entry.name.length;
      let stem = entry.name.slice(0, split);
      if (options.find)
        stem = stem.split(options.find).join(options.replacement);
      const name =
        options.prefix + stem + options.suffix + entry.name.slice(split);
      if (
        !name ||
        name.trim() !== name ||
        name === "." ||
        name === ".." ||
        name.length > 255 ||
        /[/\\\x00-\x1f\x7f]/.test(name)
      )
        throw new Error(
          "Every resulting filename must be valid and at most 255 characters.",
        );
      return {
        from: entry.path,
        to: entry.path.slice(0, entry.path.lastIndexOf("/") + 1) + name,
        entryId: entry.id,
        etag: entry.etag,
      };
    })
    .filter((c) => c.from !== c.to);
  if (!changes.length)
    throw new Error("These options do not change any filenames.");
  if (new Set(changes.map((c) => c.to)).size !== changes.length)
    throw new Error("Two files would have the same name.");
  return changes;
}
