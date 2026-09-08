import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
type Command = { label: string; href: string; keywords?: string };
const tools: Command[] = [
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
  const navigate = useNavigate();
  const commands = [...navigation, ...tools].filter((c) =>
    (c.label + " " + (c.keywords ?? ""))
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  function open() {
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
        .getElementById("command-" + active)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, query]);
  function execute(command: Command) {
    dialog.current?.close();
    const [to, hash] = command.href.split("#");
    void navigate({ to, hash });
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
        aria-labelledby="commands-title"
        className="m-auto w-[calc(100%_-_2rem)] max-w-[34rem] rounded-xl border bg-white p-5 text-zinc-950 shadow-xl backdrop:bg-black/60 dark:bg-zinc-950 dark:text-zinc-100"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current.close();
        }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="commands-title" className="font-semibold">
            Commands
          </h2>
          <Button variant="ghost" onClick={() => dialog.current?.close()}>
            Close
          </Button>
        </div>
        <label className="grid gap-2 text-sm">
          Search commands
          <input
            ref={input}
            className="rounded-lg border bg-transparent p-3"
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-results"
            aria-autocomplete="list"
            aria-activedescendant={
              commands.length ? "command-" + active : undefined
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
                    ? (i + (e.key === "ArrowDown" ? 1 : -1) + commands.length) %
                      commands.length
                    : 0,
                );
              } else if (e.key === "Enter" && commands[active]) {
                e.preventDefault();
                execute(commands[active]);
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
              aria-selected={active === i}
              key={c.href}
            >
              <button
                type="button"
                className={
                  "w-full rounded-lg px-3 py-2 text-left text-sm " +
                  (active === i ? "bg-zinc-100 dark:bg-zinc-800" : "")
                }
                onMouseEnter={() => setActive(i)}
                onClick={() => execute(c)}
              >
                {c.label}
              </button>
            </li>
          ))}
        </ul>
        {!commands.length ? (
          <p role="status" className="py-4 text-sm">
            No matching commands.
          </p>
        ) : null}
        <p className="mt-3 text-xs text-zinc-500">
          ↑ ↓ to choose · Enter to open · Escape to close
        </p>
      </dialog>
    </>
  );
}
