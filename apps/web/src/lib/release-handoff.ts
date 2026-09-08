export type HandoffArtifact = {
  path: string;
  name: string;
  size: number | null;
  contentType: string | null;
  etag: string | null;
};
function literal(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[\\`*_{}[\]()#+.!|~-]/g, "\\$&");
}
export function releaseHandoff(
  title: string,
  notes: string,
  artifacts: HandoffArtifact[],
  annotations: Record<string, string>,
) {
  if (!title.trim() || title.length > 120 || /[\r\n]/.test(title))
    throw new Error("Use a one-line title of 1–120 characters.");
  if (notes.length > 8000)
    throw new Error("Release notes are limited to 8,000 characters.");
  if (!artifacts.length || artifacts.length > 50)
    throw new Error("Select between 1 and 50 artifacts.");
  const parts = [
    "# " + literal(title.trim()),
    notes.trim() ? literal(notes.trim()) : "",
    `## Artifacts (${artifacts.length})`,
    ...artifacts.map((file) => {
      const annotation = annotations[file.path] ?? "";
      if (annotation.length > 2000)
        throw new Error("Artifact notes are limited to 2,000 characters each.");
      return [
        "### " + literal(file.name),
        "Path: " + literal(file.path),
        `Size: ${file.size ?? "unknown"} bytes`,
        "Content type: " + literal(file.contentType ?? "unknown"),
        "Revision: " + literal(file.etag ?? "unavailable"),
        annotation.trim() ? literal(annotation.trim()) : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    }),
  ];
  const text = parts.filter(Boolean).join("\n\n") + "\n";
  if (new TextEncoder().encode(text).length > 262144)
    throw new Error("Handoff exceeds 256 KiB. Shorten the notes or selection.");
  return text;
}
