import { Link } from "@tanstack/react-router";
import { FileText, Folder } from "lucide-react";
/** Router navigation for folders; ordinary download links for file responses. */
export function FileLink({ path, kind }: { path: string; kind: string }) {
  const content = (
    <>
      <span className="shrink-0 rounded-md bg-muted p-1.5" aria-hidden="true">
        {kind === "folder" ? (
          <Folder className="size-3.5" />
        ) : (
          <FileText className="size-3.5" />
        )}
      </span>
      <span className="min-w-0 break-all font-mono text-sm">{path}</span>
    </>
  );
  const className =
    "inline-flex max-w-full items-center gap-2 rounded-md text-foreground underline decoration-muted-foreground/30 underline-offset-4 hover:decoration-current";
  return kind === "folder" ? (
    <Link to="/app/files" search={{ path }} className={className}>
      {content}
    </Link>
  ) : (
    <a
      href={"/api/v1/fs/download?path=" + encodeURIComponent(path)}
      className={className}
    >
      {content}
    </a>
  );
}
