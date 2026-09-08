import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { LoadingState } from "./shared";
import {
  BookOpen,
  FileJson,
  TableProperties,
  Logs,
  LocateFixed,
  GitCompareArrows,
  ShieldCheck,
  Binary,
  FilePenLine,
  StickyNote,
  LayoutTemplate,
  Table2,
  Braces,
  GitCompare,
} from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { useLocation } from "@tanstack/react-router";
const loadTextCompare = () => import("./TextCompare");
const TextCompare = lazy(() =>
  loadTextCompare().then((module) => ({ default: module.TextCompare })),
);
const loadJsonInspector = () => import("./JsonInspector");
const JsonInspector = lazy(() =>
  loadJsonInspector().then((module) => ({ default: module.JsonInspector })),
);
const loadCsvInspector = () => import("./CsvInspector");
const CsvInspector = lazy(() =>
  loadCsvInspector().then((module) => ({ default: module.CsvInspector })),
);
const loadFileNotes = () => import("./FileNotes");
const FileNotes = lazy(() =>
  loadFileNotes().then((module) => ({ default: module.FileNotes })),
);
const loadTextEditor = () => import("./TextEditor");
const TextEditor = lazy(() =>
  loadTextEditor().then((module) => ({ default: module.TextEditor })),
);
const loadFileTemplates = () => import("./FileTemplates");
const FileTemplates = lazy(() =>
  loadFileTemplates().then((module) => ({ default: module.FileTemplates })),
);
const loadMarkdownReader = () => import("./MarkdownReader");
const MarkdownReader = lazy(() =>
  loadMarkdownReader().then((m) => ({ default: m.MarkdownReader })),
);
const loadCsvToJson = () => import("./CsvToJson");
const CsvToJson = lazy(() =>
  loadCsvToJson().then((m) => ({ default: m.CsvToJson })),
);
const loadJsonToCsv = () => import("./JsonToCsv");
const JsonToCsv = lazy(() =>
  loadJsonToCsv().then((m) => ({ default: m.JsonToCsv })),
);
const loadJsonlExplorer = () => import("./JsonlExplorer");
const JsonlExplorer = lazy(() =>
  loadJsonlExplorer().then((m) => ({ default: m.JsonlExplorer })),
);
const loadJsonPointer = () => import("./JsonPointer");
const JsonPointer = lazy(() =>
  loadJsonPointer().then((m) => ({ default: m.JsonPointer })),
);
const loadJsonCompare = () => import("./JsonCompare");
const JsonCompare = lazy(() =>
  loadJsonCompare().then((m) => ({ default: m.JsonCompare })),
);
const loadFileIntegrity = () => import("./FileIntegrity");
const FileIntegrity = lazy(() =>
  loadFileIntegrity().then((m) => ({ default: m.FileIntegrity })),
);
const loadEncodingWorkbench = () => import("./EncodingWorkbench");
const EncodingWorkbench = lazy(() =>
  loadEncodingWorkbench().then((m) => ({ default: m.EncodingWorkbench })),
);
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
      id: "encoding-workbench",
      label: "Encoding workbench",
      description: "Convert UTF-8, Base64, and hex with strict validation.",
      icon: Binary,
      component: EncodingWorkbench,
      preload: loadEncodingWorkbench,
    },
    {
      id: "file-integrity",
      label: "SHA-256 verification",
      description: "Check local file integrity without uploading.",
      icon: ShieldCheck,
      component: FileIntegrity,
      preload: loadFileIntegrity,
    },
    {
      id: "json-compare",
      label: "JSON structural comparison",
      description: "Review added, removed, and changed values.",
      icon: GitCompareArrows,
      component: JsonCompare,
      preload: loadJsonCompare,
    },
    {
      id: "json-pointer",
      label: "JSON Pointer extraction",
      description: "Extract exactly the value you need.",
      icon: LocateFixed,
      component: JsonPointer,
      preload: loadJsonPointer,
    },
    {
      id: "jsonl-explorer",
      label: "JSONL log explorer",
      description: "Find signals in line-delimited event logs.",
      icon: Logs,
      component: JsonlExplorer,
      preload: loadJsonlExplorer,
    },
    {
      id: "json-to-csv",
      label: "JSON to CSV",
      description: "Turn object arrays into spreadsheet-ready tables.",
      icon: TableProperties,
      component: JsonToCsv,
      preload: loadJsonToCsv,
    },
    {
      id: "csv-to-json",
      label: "CSV to JSON",
      description: "Turn rows into portable JSON records.",
      icon: FileJson,
      component: CsvToJson,
      preload: loadCsvToJson,
    },
    {
      id: "markdown-reader",
      label: "Markdown reading room",
      description: "Read documents with an outline and quiet typography.",
      icon: BookOpen,
      component: MarkdownReader,
      preload: loadMarkdownReader,
    },
    {
      id: "text-editor",
      label: "Text editor",
      description: "Write, edit, and save files safely.",
      icon: FilePenLine,
      component: TextEditor,
      preload: loadTextEditor,
    },
    {
      id: "file-notes",
      label: "File notes",
      description: "Leave context for your next review.",
      icon: StickyNote,
      component: FileNotes,
      preload: loadFileNotes,
    },
    {
      id: "file-templates",
      label: "File templates",
      description: "Start with a reusable structure.",
      icon: LayoutTemplate,
      component: FileTemplates,
      preload: loadFileTemplates,
    },
    {
      id: "csv-inspector",
      label: "CSV inspector",
      description: "Explore rows, columns, and values.",
      icon: Table2,
      component: CsvInspector,
      preload: loadCsvInspector,
    },
    {
      id: "json-inspector",
      label: "JSON inspector",
      description: "Validate, format, and explore JSON.",
      icon: Braces,
      component: JsonInspector,
      preload: loadJsonInspector,
    },
    {
      id: "text-comparison",
      label: "Text comparison",
      description: "See exactly what changed between files.",
      icon: GitCompare,
      component: TextCompare,
      preload: loadTextCompare,
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
          <Disclosure
            key={tool.id}
            id={tool.id}
            defaultOpen={tool.id === "text-editor"}
            lazy
            onPointerEnter={() => {
              void tool.preload().catch(() => {});
            }}
            onFocus={() => {
              void tool.preload().catch(() => {});
            }}
            className="tool-workbench"
          >
            <DisclosureSummary>
              <span className="rounded-lg bg-accent p-2.5 text-accent-foreground">
                <tool.icon className="size-4" />
              </span>
              <span>
                <span className="block font-semibold">{tool.label}</span>
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  {tool.description}
                </span>
              </span>
            </DisclosureSummary>
            <Suspense
              fallback={
                <LoadingState label={"Opening " + tool.label.toLowerCase()} />
              }
            >
              <tool.component />
            </Suspense>
          </Disclosure>
        ))}
      </div>
    </section>
  );
}
