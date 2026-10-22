/** Component-owned work only. Stop scheduling on failure, drain active tasks,
 * propagate cancellation, and retain caller order without batch barriers. */
export async function browserTaskPool<T, R>(
  items: readonly T[],
  work: (item: T, signal: AbortSignal) => Promise<R>,
  options: {
    concurrency?: number;
    signal?: AbortSignal;
    shouldStop?: () => boolean;
  } = {},
): Promise<R[]> {
  const concurrency = options.concurrency ?? 3;
  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 8 ||
    items.length > 500
  )
    throw new Error("Use 1–8 workers for at most 500 browser tasks.");
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const results: R[] = new Array(items.length);
  let cursor = 0,
    failed = false,
    failure: unknown;
  async function worker() {
    while (
      !controller.signal.aborted &&
      !options.shouldStop?.() &&
      cursor < items.length
    ) {
      const index = cursor++;
      try {
        results[index] = await work(items[index], controller.signal);
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
        controller.abort(error);
      }
    }
  }
  try {
    await Promise.all(
      Array.from({ length: Math.min(concurrency, items.length) }, worker),
    );
    if (failed) throw failure;
    if (controller.signal.aborted)
      throw (
        controller.signal.reason ?? new DOMException("Cancelled", "AbortError")
      );
    return results;
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
}
