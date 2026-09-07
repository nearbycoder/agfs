type Artifact = {
  path: string;
  size?: number;
  etag?: string | null;
  checksum?: string | null;
  contentType?: string;
  content_type?: string;
};
export function runSnapshot(run: any) {
  const manifest = run.manifest ? JSON.parse(run.manifest) : null;
  return {
    id: run.id,
    name: run.name,
    status: run.status,
    path: run.path_prefix,
    createdAt: run.created_at,
    completedAt: run.completed_at,
    retainedUntil: manifest?.retainedUntil ?? null,
    metadata: manifest?.metadata ?? JSON.parse(run.metadata ?? "{}"),
    inputs: (manifest?.inputs ?? JSON.parse(run.inputs ?? "[]")) as Artifact[],
    outputs: (manifest?.artifacts ?? []) as Artifact[],
    hasOutputs: !!manifest,
  };
}
export function compareArtifacts(
  left: Artifact[],
  right: Artifact[],
  leftRoot?: string,
  rightRoot?: string,
) {
  const relative = (path: string, root?: string) =>
    root && (root === "/" || path.startsWith(root + "/"))
      ? path.slice(root === "/" ? 1 : root.length + 1)
      : path;
  const a = new Map(left.map((f) => [relative(f.path, leftRoot), f])),
    b = new Map(right.map((f) => [relative(f.path, rightRoot), f]));
  return Array.from(new Set([...a.keys(), ...b.keys()]))
    .sort()
    .map((path) => {
      const before = a.get(path),
        after = b.get(path);
      const same =
        before &&
        after &&
        before.etag === after.etag &&
        before.size === after.size &&
        (before.contentType ?? before.content_type) ===
          (after.contentType ?? after.content_type);
      return {
        path,
        before,
        after,
        status: !before
          ? "added"
          : !after
            ? "removed"
            : same
              ? "unchanged"
              : "changed",
      };
    });
}
