import { Page } from "./shared";
import { FileNotes } from "./FileNotes";
export function FileToolsPage() {
  return (
    <Page
      title="File tools"
      description="Inspect and annotate files without leaving your workspace."
    >
      <FileNotes />
    </Page>
  );
}
