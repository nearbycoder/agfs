import { useEffect } from "react";
import { useLocation } from "@tanstack/react-router";
import { TextCompare } from "./TextCompare";
import { JsonInspector } from "./JsonInspector";
import { CsvInspector } from "./CsvInspector";
import { Page } from "./shared";
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
  return (
    <Page
      title="File tools"
      description="Inspect and annotate files without leaving your workspace."
    >
      <details id="file-notes" className="rounded-xl border p-4">
        <summary className="cursor-pointer font-semibold">File notes</summary>
        <div className="mt-4">
          <FileNotes />
        </div>
      </details>
      <details id="text-editor" open className="rounded-xl border p-4">
        <summary className="cursor-pointer font-semibold">Text editor</summary>
        <div className="mt-4">
          <TextEditor />
        </div>
      </details>
      <details id="file-templates" className="rounded-xl border p-4">
        <summary className="cursor-pointer font-semibold">
          File templates
        </summary>
        <div className="mt-4">
          <FileTemplates />
        </div>
      </details>
      <details id="csv-inspector" className="rounded-xl border p-4">
        <summary className="cursor-pointer font-semibold">
          CSV inspector
        </summary>
        <div className="mt-4">
          <CsvInspector />
        </div>
      </details>
      <details id="json-inspector" className="rounded-xl border p-4">
        <summary className="cursor-pointer font-semibold">
          JSON inspector
        </summary>
        <div className="mt-4">
          <JsonInspector />
        </div>
      </details>
      <details id="text-comparison" className="rounded-xl border p-4">
        <summary className="cursor-pointer font-semibold">
          Text comparison
        </summary>
        <div className="mt-4">
          <TextCompare />
        </div>
      </details>
    </Page>
  );
}
