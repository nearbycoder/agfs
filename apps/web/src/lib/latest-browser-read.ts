/** A component-owned read lane. Never caches private data or shares it across mounts. */
export function createLatestBrowserRead() {
  let current: AbortController | null = null;
  function cancel() {
    current?.abort();
    current = null;
  }
  async function run<T>(
    read: (signal: AbortSignal) => Promise<T>,
    handlers: {
      success: (value: T) => void;
      error: (cause: unknown) => void;
      settled: () => void;
    },
  ) {
    cancel();
    const request = new AbortController();
    current = request;
    const active = () => current === request && !request.signal.aborted;
    try {
      const value = await read(request.signal);
      if (active()) handlers.success(value);
    } catch (cause) {
      if (active()) handlers.error(cause);
    } finally {
      if (active()) {
        current = null;
        handlers.settled();
      }
    }
  }
  return { run, cancel };
}
