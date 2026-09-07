import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { formatBytes } from "~/lib/format";
import { Field, platform, useAction } from "./shared";
type Group = {
  etag: string;
  size: number;
  count: number;
  extraBytes: number;
  files: { id: string; path: string }[];
};
export function DuplicateFinder({ initialPath }: { initialPath: string }) {
  const [path, setPath] = useState(initialPath),
    [searchedPath, setSearchedPath] = useState(""),
    [groups, setGroups] = useState<Group[]>([]),
    [next, setNext] = useState<string | null>(null);
  const action = useAction();
  async function scan(cursor?: string) {
    const folder = cursor ? searchedPath : path;
    const data = await platform(
      "/storage/duplicates?" +
        new URLSearchParams({ path: folder, ...(cursor ? { cursor } : {}) }),
    );
    setGroups((old) => (cursor ? [...old, ...data.groups] : data.groups));
    setNext(data.nextCursor);
    setSearchedPath(data.path);
  }
  return (
    <section
      className="space-y-4 rounded-xl border p-4"
      aria-label="Duplicate finder"
    >
      <h2 className="font-semibold">Duplicate finder</h2>
      <p className="text-sm text-muted-foreground">
        Find nonempty files with matching stored checksums and byte sizes. These
        are duplicate candidates; review contents before deleting. Extra live
        bytes exclude one copy per group; retained versions and snapshots may
        continue using storage.
      </p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(() => scan());
        }}
      >
        <Field
          label="Duplicate search folder"
          required
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <Button disabled={action.busy}>Find duplicates</Button>
      </form>
      {action.error ? <p role="alert">{action.error}</p> : null}
      {searchedPath ? (
        <p role="status" className="text-sm break-all">
          {groups.length} groups loaded in {searchedPath} ·{" "}
          {formatBytes(groups.reduce((sum, g) => sum + g.extraBytes, 0))} extra
          live bytes
        </p>
      ) : null}
      {searchedPath && !groups.length ? (
        <p className="text-sm text-muted-foreground">
          No matching checksum groups found.
        </p>
      ) : null}
      {groups.map((g) => (
        <Disclosure key={g.etag + ":" + g.size} className="">
          <DisclosureSummary className="cursor-pointer">
            {g.count} files · {formatBytes(g.size)} each ·{" "}
            {formatBytes(g.extraBytes)} extra
          </DisclosureSummary>
          <p className="my-2 font-mono text-xs break-all">Checksum: {g.etag}</p>
          <ul className="space-y-2">
            {g.files.map((f) => (
              <li key={f.id}>
                <a
                  className="font-mono text-sm underline break-all"
                  href={
                    "/api/v1/fs/download?path=" + encodeURIComponent(f.path)
                  }
                >
                  {f.path}
                </a>
              </li>
            ))}
          </ul>
          {g.count > g.files.length ? (
            <p className="mt-2 text-sm">
              Showing the first 50 paths. Narrow the folder to inspect
              additional files.
            </p>
          ) : null}
        </Disclosure>
      ))}
      {next ? (
        <Button
          disabled={action.busy}
          variant="outline"
          onClick={() => void action.run(() => scan(next))}
        >
          Load more duplicate groups
        </Button>
      ) : null}
    </section>
  );
}
