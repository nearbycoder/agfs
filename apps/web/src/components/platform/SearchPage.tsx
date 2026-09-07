import { FileLink } from "~/components/ui/file-link";
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { Select, SelectItem } from "~/components/ui/select";
import { useState } from "react";
import { SavedSearches, type SearchFilters } from "./SavedSearches";
import { Button } from "~/components/ui/button";
import { Page, Field, platform, useAction, Empty } from "./shared";
const empty: SearchFilters = {
  q: "",
  path: "/",
  type: "",
  tag: "",
  minSize: "",
  maxSize: "",
  after: "",
  before: "",
  kind: "",
};
export function SearchPage() {
  const [filters, setFilters] = useState<SearchFilters>(empty),
    [active, setActive] = useState<SearchFilters | null>(null),
    [items, setItems] = useState<any[]>([]),
    [next, setNext] = useState<string | null>(null),
    [searched, setSearched] = useState(false),
    [tagPath, setTagPath] = useState(""),
    [tags, setTags] = useState("");
  const action = useAction();
  function change(key: keyof SearchFilters, value: string) {
    setFilters((old) => ({ ...old, [key]: value }));
  }
  async function search(cursor?: string, values: SearchFilters = filters) {
    if (
      values.minSize &&
      values.maxSize &&
      Number(values.minSize) > Number(values.maxSize)
    )
      throw new Error("Minimum bytes must not exceed maximum bytes.");
    if (values.after && values.before && values.after > values.before)
      throw new Error("The start date must not be after the end date.");
    const query = new URLSearchParams({ q: values.q, path: values.path });
    for (const key of ["type", "tag", "kind", "minSize", "maxSize"] as const)
      if (values[key]) query.set(key, values[key]!);
    if (values.after)
      query.set(
        "modifiedAfter",
        String(Date.parse(values.after + "T00:00:00Z")),
      );
    if (values.before)
      query.set(
        "modifiedBefore",
        String(Date.parse(values.before + "T23:59:59.999Z")),
      );
    if (cursor) query.set("cursor", cursor);
    const data = await platform("/search?" + query);
    setItems((old) => (cursor ? [...old, ...data.results] : data.results));
    setNext(data.nextCursor);
    setSearched(true);
    setActive({ ...values });
  }
  return (
    <Page
      title="Search"
      description="Find files by name, text, tags, size, or modification date. Text files up to 1 MiB are indexed within a minute."
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
          value={filters.q}
          maxLength={200}
          onChange={(e) => change("q", e.target.value)}
          placeholder="release notes"
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Folder"
            required
            value={filters.path}
            onChange={(e) => change("path", e.target.value)}
          />
          <Field
            label="Content type (optional)"
            value={filters.type}
            onChange={(e) => change("type", e.target.value)}
            placeholder="text/plain"
          />
          <Field
            label="Tag (optional)"
            value={filters.tag}
            onChange={(e) => change("tag", e.target.value)}
          />
        </div>
        <Disclosure>
          <DisclosureSummary>Advanced filters</DisclosureSummary>
          <div className="mt-4">
            {" "}
            <fieldset className="grid gap-4 rounded-xl border p-4 sm:grid-cols-3">
              <legend className="sr-only">Advanced filters</legend>
              <label className="grid gap-2 text-sm">
                Entry kind
                <Select
                  placeholder="Files and folders"
                  aria-label="Entry kind"
                  value={filters.kind ?? ""}
                  onValueChange={(value) => change("kind", value)}
                >
                  <SelectItem value="">Files and folders</SelectItem>
                  <SelectItem value="file">Files only</SelectItem>
                  <SelectItem value="folder">Folders only</SelectItem>
                </Select>
              </label>
              <Field
                label="Minimum bytes"
                type="number"
                min="0"
                step="1"
                value={filters.minSize ?? ""}
                onChange={(e) => change("minSize", e.target.value)}
              />
              <Field
                label="Maximum bytes"
                type="number"
                min="0"
                step="1"
                value={filters.maxSize ?? ""}
                onChange={(e) => change("maxSize", e.target.value)}
              />
              <Field
                label="Modified on/after (UTC)"
                type="date"
                value={filters.after ?? ""}
                onChange={(e) => change("after", e.target.value)}
              />
              <Field
                label="Modified on/before (UTC)"
                type="date"
                value={filters.before ?? ""}
                onChange={(e) => change("before", e.target.value)}
              />
            </fieldset>
          </div>
        </Disclosure>
        <div className="flex gap-3">
          <Button disabled={action.busy}>Search</Button>
          <Button
            type="button"
            variant="outline"
            disabled={action.busy}
            onClick={() => {
              setFilters(empty);
              setActive(null);
              setItems([]);
              setNext(null);
              setSearched(false);
            }}
          >
            Reset filters
          </Button>
        </div>
      </form>
      <SavedSearches
        filters={filters}
        busy={action.busy}
        onApply={(saved) => {
          const values = { ...empty, ...saved };
          setFilters(values);
          void action.run(() => search(undefined, values));
        }}
      />
      {active && JSON.stringify(active) !== JSON.stringify(filters) ? (
        <p role="status" className="text-sm text-muted-foreground">
          Showing the last search. Press Search to apply your changed filters.
        </p>
      ) : null}
      {items.length ? (
        <ul className="divide-y">
          {items.map((item) => (
            <li className="space-y-2 py-4" key={item.id}>
              <FileLink path={item.path} kind={item.kind} />
              <p className="text-xs text-muted-foreground">
                {item.contentType ?? item.kind} · {item.size ?? 0} bytes ·{" "}
                {new Date(item.updatedAt).toLocaleString()} ·{" "}
                {item.tags.join(", ")}
              </p>
              {item.excerpt ? (
                <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
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
      {next && active ? (
        <Button
          disabled={action.busy}
          variant="outline"
          onClick={() => void action.run(() => search(next, active))}
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
