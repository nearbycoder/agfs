import { DetailSurface } from "./shared";
import { Badge } from "~/components/ui/badge";
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { Select, SelectItem } from "~/components/ui/select";
import { LineDiff } from "./LineDiff";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Page, Field, platform, useAction, useData, Empty } from "./shared";
export function DraftsPage() {
  const data = useData("/drafts", "drafts"),
    action = useAction(),
    [name, setName] = useState(""),
    [folder, setFolder] = useState("/"),
    [draft, setDraft] = useState<any>(null),
    [path, setPath] = useState(""),
    [operation, setOperation] = useState("write"),
    [content, setContent] = useState(""),
    [comment, setComment] = useState("");
  async function reload() {
    if (draft) setDraft(await platform("/drafts/" + draft.id));
    await data.refresh();
  }
  return (
    <Page
      title="Draft changes"
      description="Propose text edits without changing live files. Review the before and after, approve, then apply every file together. Conflicts stop the entire change set."
      error={action.error || data.error}
      notice={action.notice}
    >
      <Disclosure>
        <DisclosureSummary>
          <span>
            <span className="block font-semibold">Create a draft</span>
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              Propose changes before applying them to live files.
            </span>
          </span>
        </DisclosureSummary>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              const d = await platform("/drafts", "POST", {
                name,
                path: folder,
              });
              setDraft(await platform("/drafts/" + d.id));
              await data.refresh();
            });
          }}
        >
          <Field
            label="Draft name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Field
            label="Folder"
            required
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
          />
          <Button disabled={action.busy}>New draft</Button>
        </form>
      </Disclosure>
      {data.nextCursor ? (
        <Button
          variant="outline"
          disabled={data.loading}
          onClick={() => void data.loadMore()}
        >
          Load more
        </Button>
      ) : null}
      {data.items.length ? (
        <ul className="divide-y">
          {data.items.map((d) => (
            <li key={d.id} className="flex justify-between gap-3 py-3">
              <span>
                {d.name}{" "}
                <span className="text-muted-foreground">· {d.status}</span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () =>
                    setDraft(await platform("/drafts/" + d.id)),
                  )
                }
              >
                Review
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty loading={data.loading} text="No proposed changes yet." />
      )}
      {draft ? (
        <DetailSurface key={draft.id} label="Draft review">
          <h2 className="text-lg font-semibold">
            {draft.name} · {draft.status}
          </h2>
          {["open", "changes_requested"].includes(draft.status) ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void action.run(async () => {
                  await platform("/drafts/" + draft.id + "/changes", "PUT", {
                    path,
                    operation,
                    content,
                  });
                  await reload();
                  action.setNotice("Change saved in the draft.");
                });
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="File path"
                  required
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                />
                <label className="grid gap-2 text-sm">
                  Operation
                  <Select
                    aria-label="Draft operation"
                    value={operation}
                    onValueChange={(value) => setOperation(value)}
                  >
                    <SelectItem value="write">Write text</SelectItem>
                    <SelectItem value="delete">Delete file</SelectItem>
                  </Select>
                </label>
              </div>
              {operation === "write" ? (
                <label className="grid gap-2 text-sm">
                  Proposed content
                  <textarea
                    className="min-h-40 rounded-md border bg-transparent p-3 font-mono text-sm"
                    maxLength={8192}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                  />
                </label>
              ) : null}
              <Button disabled={action.busy}>Save draft change</Button>
            </form>
          ) : null}
          {draft.changes.map((c: any) => (
            <article className="space-y-3" key={c.path}>
              <h3 className="break-all font-mono text-sm">
                {c.operation} {c.path}
              </h3>
              <LineDiff
                before={c.base_content ?? ""}
                after={c.operation === "delete" ? "" : (c.content ?? "")}
              />
              <Disclosure>
                <DisclosureSummary>Full before and after</DisclosureSummary>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div>
                    <h4 className="mb-2 text-xs uppercase text-muted-foreground">
                      Before{c.base_exists ? "" : " · new file"}
                    </h4>
                    <pre className="max-h-64 overflow-auto rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-950 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
                      {c.base_content || "(empty)"}
                    </pre>
                  </div>
                  <div>
                    <h4 className="mb-2 text-xs uppercase text-muted-foreground">
                      After
                    </h4>
                    <pre className="max-h-64 overflow-auto rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-green-950 dark:border-green-900 dark:bg-green-950/30 dark:text-green-100">
                      {c.operation === "delete"
                        ? "(deleted)"
                        : c.content || "(empty)"}
                    </pre>
                  </div>
                </div>
              </Disclosure>
              {["open", "changes_requested"].includes(draft.status) ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPath(c.path);
                    setOperation(c.operation);
                    setContent(c.content ?? "");
                  }}
                >
                  Edit proposal
                </Button>
              ) : null}
            </article>
          ))}
          {draft.status === "open" && draft.changes.length ? (
            <div className="flex gap-3">
              <Button
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await platform("/drafts/" + draft.id + "/review", "POST", {
                      accept: true,
                    });
                    await reload();
                  })
                }
              >
                Approve changes
              </Button>
              <Button
                disabled={action.busy}
                variant="outline"
                onClick={() =>
                  void action.run(async () => {
                    await platform("/drafts/" + draft.id + "/review", "POST", {
                      accept: false,
                    });
                    await reload();
                  })
                }
              >
                Reject
              </Button>
            </div>
          ) : null}
          <section className="space-y-3">
            <h3 className="font-semibold">Review discussion</h3>
            {draft.comments?.map((c: any) => (
              <div key={c.id} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">
                  {c.author} · {new Date(c.created_at).toLocaleString()}
                </p>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </div>
            ))}
            <Field
              label="Comment or requested changes"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={4000}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={action.busy || !comment.trim()}
                onClick={() =>
                  void action.run(async () => {
                    await platform(
                      "/drafts/" + draft.id + "/comments",
                      "POST",
                      { body: comment },
                    );
                    setComment("");
                    await reload();
                  })
                }
              >
                Add comment
              </Button>
              {draft.status === "open" ? (
                <Button
                  variant="outline"
                  disabled={action.busy || !comment.trim()}
                  onClick={() =>
                    void action.run(async () => {
                      await platform(
                        "/drafts/" + draft.id + "/request-changes",
                        "POST",
                        { body: comment },
                      );
                      setComment("");
                      await reload();
                    })
                  }
                >
                  Request changes
                </Button>
              ) : null}
              {draft.status === "changes_requested" ? (
                <Button
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await platform(
                        "/drafts/" + draft.id + "/resubmit",
                        "POST",
                        {},
                      );
                      await reload();
                    })
                  }
                >
                  Resubmit for review
                </Button>
              ) : null}
            </div>
          </section>
          {draft.status === "approved" ? (
            <Button
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await platform("/drafts/" + draft.id + "/apply", "POST", {});
                  await reload();
                  action.setNotice(
                    "All changes applied. Previous versions are available in Trash & versions.",
                  );
                })
              }
            >
              Apply approved changes
            </Button>
          ) : null}
        </DetailSurface>
      ) : null}
    </Page>
  );
}
