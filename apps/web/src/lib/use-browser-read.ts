import { useCallback, useEffect, useState } from "react";
import { createLatestBrowserRead } from "./latest-browser-read";

/** Read-only requests; mutations keep their existing completion semantics. */
export function useBrowserRead() {
  const [reader] = useState(createLatestBrowserRead);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => reader.cancel(), [reader]);
  const run = useCallback(
    <T>(
      load: (signal: AbortSignal) => Promise<T>,
      onLoad: (value: T) => void,
    ) => {
      setBusy(true);
      setError("");
      return reader.run(load, {
        success: onLoad,
        error: (cause) =>
          setError(
            cause instanceof Error ? cause.message : "Could not load file",
          ),
        settled: () => setBusy(false),
      });
    },
    [reader],
  );
  function cancel() {
    reader.cancel();
    setBusy(false);
  }
  return { run, cancel, busy, error };
}
