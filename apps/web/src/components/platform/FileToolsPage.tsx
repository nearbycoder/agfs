import { JsonInspector } from "./JsonInspector";
import { CsvInspector } from "./CsvInspector";
import { Page } from "./shared";
import { FileNotes } from "./FileNotes";
import { TextEditor } from "./TextEditor";
import { FileTemplates } from "./FileTemplates";
export function FileToolsPage() {
  return (
    <Page
      title="File tools"
      description="Inspect and annotate files without leaving your workspace."
    >
      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer font-semibold">File notes</summary>
        <div className="mt-4">
          <FileNotes />
        </div>
      </details>
      <details open className="rounded-xl border p-4">
        <summary className="cursor-pointer font-semibold">Text editor</summary>
        <div className="mt-4">
          <TextEditor />
        </div>
      </details>
      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer font-semibold">
          File templates
        </summary>
        <div className="mt-4">
          <FileTemplates />
        </div>
      </details>
      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer font-semibold">
          CSV inspector
        </summary>
        <div className="mt-4">
          <CsvInspector />
        </div>
      </details>
      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer font-semibold">
          JSON inspector
        </summary>
        <div className="mt-4">
          <JsonInspector />
        </div>
      </details>
    </Page>
  );
}
