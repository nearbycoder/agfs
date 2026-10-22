/** Join every active operation before returning, and stop claiming work on failure. */
export async function forEachConcurrent<T>(items: readonly T[], concurrency: number, task: (item: T) => Promise<void>) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3)
    throw new RangeError("Server concurrency must be between one and three");
  let next = 0, failed = false, firstError: unknown;
  async function worker() {
    while (!failed && next < items.length) {
      const item = items[next++];
      try { await task(item); }
      catch (error) {
        if (!failed) { failed = true; firstError = error; }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failed) throw firstError;
}
