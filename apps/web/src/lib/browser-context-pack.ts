import { browserTaskPool } from "./browser-task-pool";
import type { ContextFile } from "./agent-context";

export function readContextFiles(
  paths: string[],
  read: (path: string, signal: AbortSignal) => Promise<ContextFile>,
  signal: AbortSignal,
) {
  if (
    !paths.length ||
    paths.length > 20 ||
    new Set(paths).size !== paths.length ||
    paths.some((p) => !p.startsWith("/"))
  )
    throw new Error("Provide 1–20 distinct absolute file paths.");
  let bytes = 0;
  const encoder = new TextEncoder();
  return browserTaskPool(
    paths,
    async (path, signal) => {
      const file = await read(path, signal);
      signal.throwIfAborted();
      bytes += encoder.encode(file.text).length;
      if (bytes > 262144)
        throw new Error(
          "Combined source files exceed 256 KiB. Narrow the selection.",
        );
      return file;
    },
    { signal, shouldStop: () => bytes > 262144 },
  );
}
