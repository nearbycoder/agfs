/** Stop scheduling after failure; wait for in-flight work before rejecting. */
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 8)
    throw new Error("Concurrency must be 1–8");
  const output: R[] = new Array(items.length);
  let next = 0,
    failed = false,
    failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (!failed) {
        const i = next++;
        if (i >= items.length) return;
        try {
          signal?.throwIfAborted();
          output[i] = await work(items[i], i);
        } catch (error) {
          failed = true;
          failure = error;
        }
      }
    }),
  );
  if (failed) throw failure;
  return output;
}
