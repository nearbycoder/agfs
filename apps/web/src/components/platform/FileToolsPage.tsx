import {
  FilePenLine,
  StickyNote,
  LayoutTemplate,
  Table2,
  Braces,
  GitCompare,
} from "lucide-react";
import { useEffect } from "react";
import { useLocation } from "@tanstack/react-router";
import { TextCompare } from "./TextCompare";
import { JsonInspector } from "./JsonInspector";
import { CsvInspector } from "./CsvInspector";
import { FileNotes } from "./FileNotes";
import { TextEditor } from "./TextEditor";
import { FileTemplates } from "./FileTemplates";
export function FileToolsPage() {
  const location = useLocation();
  useEffect(() => {
    if (!location.hash) return;
    const target = document.getElementById(location.hash.replace(/^#/, ""));
    if (target instanceof HTMLDetailsElement) {
      target.open = true;
      target.scrollIntoView({ block: "start" });
    }
  }, [location.hash]);
  const tools = [
    {
      id: "text-editor",
      label: "Text editor",
      description: "Write, edit, and save files safely.",
      icon: FilePenLine,
      component: TextEditor,
    },
    {
      id: "file-notes",
      label: "File notes",
      description: "Leave context for your next review.",
      icon: StickyNote,
      component: FileNotes,
    },
    {
      id: "file-templates",
      label: "File templates",
      description: "Start with a reusable structure.",
      icon: LayoutTemplate,
      component: FileTemplates,
    },
    {
      id: "csv-inspector",
      label: "CSV inspector",
      description: "Explore rows, columns, and values.",
      icon: Table2,
      component: CsvInspector,
    },
    {
      id: "json-inspector",
      label: "JSON inspector",
      description: "Validate, format, and explore JSON.",
      icon: Braces,
      component: JsonInspector,
    },
    {
      id: "text-comparison",
      label: "Text comparison",
      description: "See exactly what changed between files.",
      icon: GitCompare,
      component: TextCompare,
    },
  ];
  return (
    <section className="workspace-page">
      <header className="workspace-page-heading">
        <h1 className="dashboard-title">File tools</h1>
        <p className="section-copy">
          A workbench for inspecting, editing, and understanding your files.
        </p>
      </header>
      <nav aria-label="File tools" className="flex flex-wrap gap-2">
        {tools.map((tool) => (
          <a
            className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs font-medium hover:bg-accent"
            key={tool.id}
            href={"#" + tool.id}
          >
            <tool.icon className="size-3.5" />
            {tool.label}
          </a>
        ))}
      </nav>
      <div className="space-y-4">
        {tools.map((tool) => (
          <details
            key={tool.id}
            id={tool.id}
            open={tool.id === "text-editor" ? true : undefined}
            className="tool-panel"
          >
            <summary>
              <span className="rounded-lg bg-accent p-2.5 text-accent-foreground">
                <tool.icon className="size-4" />
              </span>
              <span>
                <span className="block font-semibold">{tool.label}</span>
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  {tool.description}
                </span>
              </span>
            </summary>
            <div className="tool-panel-body">
              <tool.component />
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
