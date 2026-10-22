import type { FsEntry } from "@agfs/contracts";
import { GoToFolder } from "./GoToFolder";
import { FolderUpload } from "./FolderUpload";
import { DirectoryExport } from "./DirectoryExport";

export function FileAdvancedTools({
  folder,
  entries,
  page,
  loading,
  filtering,
  onNavigate,
  onComplete,
}: {
  folder: string;
  entries: FsEntry[];
  page: FsEntry[];
  loading: boolean;
  filtering: boolean;
  onNavigate: (path: string) => void;
  onComplete: () => Promise<void>;
}) {
  return (
    <>
      <GoToFolder path={folder} onNavigate={onNavigate} />
      <FolderUpload destination={folder} onComplete={onComplete} />
      {!loading ? (
        <DirectoryExport
          entries={entries}
          page={page}
          folder={folder}
          disabled={filtering}
        />
      ) : null}
    </>
  );
}
