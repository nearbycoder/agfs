import { uploadResumable } from "@agfs/contracts";
import { saveBrowserText } from "./browser-text";
import { browserTaskPool } from "./browser-task-pool";

export type FolderTransferItem = {
  file: File;
  path: string;
  status: "queued" | "uploading" | "done" | "failed";
  bytes: number;
  error?: string;
};
export function uploadFolderItems(
  items: readonly FolderTransferItem[],
  options: {
    signal: AbortSignal;
    shouldStop: () => boolean;
    pause: (reason: string) => void;
    update: (path: string, patch: Partial<FolderTransferItem>) => void;
    request?: typeof fetch;
  },
) {
  const request: typeof fetch = async (input, init) => {
    options.signal.throwIfAborted();
    const response = await (options.request ?? fetch)(input, {
      ...init,
      signal: options.signal,
    });
    if ([401, 403, 429, 507].includes(response.status))
      options.pause(
        "Paused after an authentication, permission, rate-limit or storage response. Resolve the reported error before retrying.",
      );
    return response;
  };
  return browserTaskPool(
    items.filter((item) => item.status !== "done"),
    async (item) => {
      options.update(item.path, {
        status: "uploading",
        error: undefined,
        bytes: 0,
      });
      try {
        if (item.file.size === 0)
          await saveBrowserText(
            item.path,
            "",
            null,
            item.file.type || "application/octet-stream",
            request,
          );
        else
          await uploadResumable({
            path: item.path,
            contentType: item.file.type || "application/octet-stream",
            size: item.file.size,
            ifMatch: null,
            fingerprint: `${item.file.size}:${item.file.lastModified}:${item.path}`,
            request,
            read: async (start, end) => {
              options.signal.throwIfAborted();
              const bytes = await item.file.slice(start, end).arrayBuffer();
              options.signal.throwIfAborted();
              return bytes;
            },
            progress: (bytes) => options.update(item.path, { bytes }),
          });
        options.update(item.path, { status: "done", bytes: item.file.size });
      } catch (error) {
        if (options.signal.aborted) throw error;
        options.update(item.path, {
          status: "failed",
          error: error instanceof Error ? error.message : "Upload failed",
        });
      }
    },
    { signal: options.signal, shouldStop: options.shouldStop },
  );
}
