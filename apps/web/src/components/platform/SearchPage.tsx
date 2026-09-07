import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Page, Field, platform, useAction, Empty } from "./shared";
export function SearchPage() {
  const [q, setQ] = useState(""),
    [path, setPath] = useState("/"),
    [type, setType] = useState(""),
    [tag, setTag] = useState(""),
    [items, setItems] = useState<any[]>([]),
    [next, setNext] = useState<number | null>(null),
    [searched, setSearched] = useState(false),
    [tagPath, setTagPath] = useState(""),
    [tags, setTags] = useState("");
  const action = useAction();
  async function search(offset = 0) {
    const data = await platform(
      "/search?" +
        new URLSearchParams({
          q,
          path,
          ...(type ? { type } : {}),
          ...(tag ? { tag } : {}),
          offset: String(offset),
        }),
    );
    setItems((old) => (offset ? [...old, ...data.results] : data.results));
    setNext(data.nextOffset);
    setSearched(true);
  }
  return (
    <Page
      title="Search"
      description="Find files by name, text, type, or tags. Text files up to 1 MiB are indexed within a minute."
      error={action.error}
      notice={action.notice}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(() => search());
        }}
      >
        <Field
          label="Search files"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="release notes"
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Folder"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            required
          />
          <Field
            label="Content type (optional)"
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="text/plain"
          />
          <Field
            label="Tag (optional)"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
          />
        </div>
        <Button disabled={action.busy}>Search</Button>
      </form>
      {items.length ? (
        <ul className="divide-y">
          {items.map((item) => (
            <li className="space-y-2 py-4" key={item.id}>
              <a
                className="font-mono text-sm underline break-all"
                href={
                  "/api/v1/fs/download?path=" + encodeURIComponent(item.path)
                }
              >
                {item.path}
              </a>
              <p className="text-xs text-zinc-500">
                {item.contentType ?? item.kind} · {item.tags.join(", ")}
              </p>
              {item.excerpt ? (
                <p className="whitespace-pre-wrap break-words text-sm text-zinc-500">
                  {item.excerpt}
                </p>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setTagPath(item.path);
                  setTags(item.tags.join(", "));
                }}
              >
                Edit tags
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty
          loading={action.busy}
          text={
            searched
              ? "No files match these filters."
              : "Enter a search, or leave it blank to browse files."
          }
        />
      )}
      {next !== null ? (
        <Button
          disabled={action.busy}
          variant="outline"
          onClick={() => void action.run(() => search(next))}
        >
          Load more
        </Button>
      ) : null}
      <form
        className="grid gap-4 rounded-xl border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await platform("/tags", "PUT", {
              path: tagPath,
              tags: tags
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
            });
            action.setNotice("Tags saved. Search will update within a minute.");
          });
        }}
      >
        <h2 className="font-semibold">File tags</h2>
        <Field
          label="File path"
          required
          value={tagPath}
          onChange={(e) => setTagPath(e.target.value)}
        />
        <Field
          label="Tags, separated by commas"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
        <Button disabled={action.busy} className="w-fit">
          Save tags
        </Button>
      </form>
    </Page>
  );
}
