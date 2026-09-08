import { useId, useState } from "react";
import { Button } from "~/components/ui/button";
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { TextToolSource } from "./TextToolSource";
import { markdownDocument } from "~/lib/markdown-reader";
import { downloadText } from "~/lib/download-text";
export function MarkdownReader() {
  const id = useId();
  const [loaded, setLoaded] = useState<
    | ({ path: string; text: string } & ReturnType<typeof markdownDocument>)
    | null
  >(null);
  return (
    <section aria-label="Markdown reading room" className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Read headings, lists, paragraphs, and fenced code with an outline. HTML,
        links, and images remain inert text. Up to 256 KiB and 1,500 blocks.
      </p>
      <TextToolSource
        label="Markdown"
        onLoad={(file) =>
          setLoaded({ ...file, ...markdownDocument(file.text) })
        }
      />
      {loaded ? (
        <>
          <h3 className="font-mono break-all">{loaded.path}</h3>
          <p role="status" className="text-sm">
            {loaded.words} words · About {loaded.minutes} min at 200 words/min ·{" "}
            {loaded.headings.length} headings · {loaded.codeBlocks} code blocks
          </p>
          <Disclosure>
            <DisclosureSummary>Document outline</DisclosureSummary>
            {loaded.headings.length ? (
              <nav aria-label="Document outline" className="grid gap-1">
                {loaded.headings.map((h) => (
                  <button
                    className="text-left text-sm underline underline-offset-4 break-all"
                    key={h.index}
                    style={{ paddingInlineStart: (h.level - 1) * 12 }}
                    onClick={() => {
                      const target = document.getElementById(
                        id + "-" + h.index,
                      );
                      target?.focus({ preventScroll: true });
                      target?.scrollIntoView({ block: "nearest" });
                    }}
                  >
                    {h.text}
                  </button>
                ))}
              </nav>
            ) : (
              <p>No headings in this document.</p>
            )}
            <Button
              variant="outline"
              onClick={() =>
                downloadText(
                  "markdown-outline.txt",
                  loaded.headings
                    .map((h) => "  ".repeat(h.level - 1) + h.text)
                    .join("\n"),
                  "text/plain",
                )
              }
            >
              Download outline
            </Button>
          </Disclosure>
          <article
            aria-label="Markdown document"
            className="space-y-4 rounded-xl border bg-card p-5"
          >
            {loaded.blocks.length ? (
              loaded.blocks.map((block, i) =>
                block.kind === "heading" ? (
                  <div
                    role="heading"
                    aria-level={block.level}
                    tabIndex={-1}
                    id={id + "-" + i}
                    key={i}
                    className={
                      block.level === 1
                        ? "text-2xl font-semibold break-words"
                        : "text-lg font-semibold break-words"
                    }
                  >
                    {block.text}
                  </div>
                ) : block.kind === "code" ? (
                  <pre
                    key={i}
                    className="max-h-80 overflow-auto rounded-lg bg-muted p-4 text-xs"
                  >
                    {block.text}
                  </pre>
                ) : (
                  <p
                    key={i}
                    className="whitespace-pre-wrap break-words text-sm leading-7"
                  >
                    {block.kind === "list" ? "• " : ""}
                    {block.text}
                  </p>
                ),
              )
            ) : (
              <p>This document is empty.</p>
            )}
          </article>
          <Disclosure>
            <DisclosureSummary>Markdown source</DisclosureSummary>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">
              {loaded.text}
            </pre>
          </Disclosure>
        </>
      ) : null}
    </section>
  );
}
