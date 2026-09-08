import { platform } from "~/components/platform/shared";
import { fileSearchCommands } from "~/lib/command-search";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
type Command = { label: string; href: string; keywords?: string; id?: string };
const tools: Command[] = [
  { label: "Encoding workbench", href: "/app/tools#encoding-workbench" },
  { label: "SHA-256 verification", href: "/app/tools#file-integrity" },
  { label: "JSON structural comparison", href: "/app/tools#json-compare" },
  { label: "JSON Pointer extraction", href: "/app/tools#json-pointer" },
  { label: "JSONL log explorer", href: "/app/tools#jsonl-explorer" },
  { label: "JSON to CSV", href: "/app/tools#json-to-csv" },
  { label: "CSV to JSON", href: "/app/tools#csv-to-json" },
  { label: "Markdown reading room", href: "/app/tools#markdown-reader" },
  {
    label: "Write or edit text",
    href: "/app/tools#text-editor",
    keywords: "new file",
  },
  { label: "Create from template", href: "/app/tools#file-templates" },
  {
    label: "Inspect CSV",
    href: "/app/tools#csv-inspector",
    keywords: "table spreadsheet",
  },
  {
    label: "Inspect JSON",
    href: "/app/tools#json-inspector",
    keywords: "validate format",
  },
  {
    label: "Compare text files",
    href: "/app/tools#text-comparison",
    keywords: "diff",
  },
  {
    label: "Annotate a file",
    href: "/app/tools#file-notes",
    keywords: "notes",
  },
];
export function CommandPalette({ navigation }: { navigation: Command[] }) {
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [remote, setRemote] = useState<{
    query: string;
    commands: Command[];
    error: string;
    more: boolean;
  } | null>(null);
  const needle = query.trim();
  const navigate = useNavigate();
  useEffect(() => {
    if (!isOpen || needle.length < 2) {
      setRemote(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const data = await platform(
          "/search?" + new URLSearchParams({ q: needle, path: "/" }),
          "GET",
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted)
          setRemote({
            query: needle,
            commands: fileSearchCommands(data.results),
            error: "",
            more: (data.results?.length ?? 0) > 20 || !!data.nextCursor,
          });
      } catch (error) {
        if (!controller.signal.aborted)
          setRemote({
            query: needle,
            commands: [],
            error:
              error instanceof Error
                ? error.message
                : "File search unavailable.",
            more: false,
          });
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, needle]);
  const localCommands = [...navigation, ...tools].filter((c) =>
    (c.label + " " + (c.keywords ?? ""))
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const currentRemote = isOpen && remote?.query === needle ? remote : null;
  const commands = [...localCommands, ...(currentRemote?.commands ?? [])];
  const selected = Math.min(active, Math.max(0, commands.length - 1));
  function open() {
    setRemote(null);
    setIsOpen(true);
    setQuery("");
    setActive(0);
    dialog.current?.showModal();
    input.current?.focus();
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "k" &&
        !e.altKey &&
        !e.isComposing
      ) {
        e.preventDefault();
        dialog.current?.open ? dialog.current.close() : open();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (dialog.current?.open)
      document
        .getElementById("command-" + selected)
        ?.scrollIntoView({ block: "nearest" });
  }, [selected, query, commands.length]);
  function execute(command: Command) {
    dialog.current?.close();
    const target = new URL(command.href, window.location.origin);
    void navigate({
      to: target.pathname,
      hash: target.hash.slice(1),
      search: Object.fromEntries(target.searchParams),
    });
  }
  return (
    <>
      <Button
        variant="outline"
        aria-label="Find a command"
        className="gap-3 px-3"
        onClick={open}
      >
        <Search />
        <span className="hidden md:inline">Find a command</span>
        <kbd className="hidden rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
          ⌘ / Ctrl K
        </kbd>
      </Button>
      <dialog
        ref={dialog}
        onClose={() => {
          setIsOpen(false);
          setRemote(null);
        }}
        aria-labelledby="commands-title"
        className="m-auto w-[calc(100%_-_2rem)] max-w-[34rem] rounded-xl border bg-white p-5 text-zinc-950 shadow-xl backdrop:bg-black/60 dark:bg-zinc-950 dark:text-zinc-100"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current.close();
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="commands-title" className="font-semibold">
            Commands & files
          </h2>
          <Button variant="ghost" onClick={() => dialog.current?.close()}>
            Close
          </Button>
        </div>
        <label className="grid gap-2 text-sm">
          Search commands and files
          <input
            ref={input}
            maxLength={200}
            className="rounded-lg border bg-transparent p-3"
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-results"
            aria-autocomplete="list"
            aria-activedescendant={
              commands.length ? "command-" + selected : undefined
            }
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) =>
                  commands.length
                    ? (selected +
                        (e.key === "ArrowDown" ? 1 : -1) +
                        commands.length) %
                      commands.length
                    : 0,
                );
              } else if (e.key === "Enter" && commands[selected]) {
                e.preventDefault();
                execute(commands[selected]);
              }
            }}
          />
        </label>
        <ul
          id="command-results"
          role="listbox"
          aria-label="Matching commands"
          className="mt-3 max-h-80 overflow-auto"
        >
          {commands.map((c, i) => (
            <li
              id={"command-" + i}
              role="option"
              aria-selected={selected === i}
              key={c.id ?? c.href}
            >
              <button
                type="button"
                className={
                  "w-full rounded-lg px-3 py-2 text-left text-sm break-all " +
                  (selected === i ? "bg-zinc-100 dark:bg-zinc-800" : "")
                }
                onMouseEnter={() => setActive(i)}
                onClick={() => execute(c)}
              >
                {c.label}
              </button>
            </li>
          ))}
        </ul>
        {searching ? (
          <p role="status" className="py-2 text-sm">
            Searching workspace files…
          </p>
        ) : null}
        {currentRemote?.error ? (
          <p role="alert" className="py-2 text-sm">
            {currentRemote.error}
          </p>
        ) : null}
        {currentRemote?.more ? (
          <p className="py-2 text-xs text-muted-foreground">
            Showing the first 20 file matches. Refine your query or use the
            Search page for more results.
          </p>
        ) : null}
        {!commands.length && !searching ? (
          <p role="status" className="py-4 text-sm">
            No matching commands or files.
          </p>
        ) : null}
        <p className="mt-3 text-xs text-zinc-500">
          Type 2 characters to search this workspace. File results open their
          containing folder. ↑ ↓ to choose · Enter to open · Escape to close
        </p>
      </dialog>
    </>
  );
}
