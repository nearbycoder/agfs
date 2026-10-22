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
          if (!failed) failure = error;
          failed = true;
        }
      }
    }),
  );
  if (failed) throw failure;
  return output;
}

/** Ordered lazy mapping with at most `limit` inputs/results retained. */
export async function* mapConcurrentIterable<T, R>(
  items: Iterable<T> | AsyncIterable<T>,
  limit: number,
  work: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): AsyncGenerator<R> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 8)
    throw new Error("Concurrency must be 1–8");
  const asyncIterator = (items as AsyncIterable<T>)[Symbol.asyncIterator];
  const iterator = asyncIterator
    ? asyncIterator.call(items) : (items as Iterable<T>)[Symbol.iterator]();
  type Result = { value: R } | { error: unknown };
  type Task = { promise: Promise<void>; result?: Result };
  const pending: Task[] = [];
  let index = 0, exhausted = false, stopped = false, failed = false,
    propagated = false, failure: unknown, pulling: Promise<void> | undefined;
  const fail = (error: unknown) => {
    if (!failed) failure = error;
    failed = true;
  };
  const pull = () => {
    if (pulling || exhausted || stopped || failed || pending.length >= limit) return;
    // Only one next() is active. Its reserved slot plus pending work/results is
    // bounded by limit; a ready ordered result never waits for this source pull.
    pulling = Promise.resolve().then(() => {
      signal?.throwIfAborted();
      return iterator.next();
    }).then((next) => {
      if (next.done) { exhausted = true; return; }
      if (stopped || failed) return;
      const position = index++;
      const task: Task = { promise: Promise.resolve() };
      task.promise = Promise.resolve().then(() => {
        signal?.throwIfAborted();
        return work(next.value, position);
      }).then((value) => { task.result = { value }; }, (error) => {
        fail(error);
        task.result = { error };
      });
      pending.push(task);
    }, fail).catch(fail).finally(() => { pulling = undefined; });
  };
  try {
    for (;;) {
      signal?.throwIfAborted();
      if (failed) throw failure;
      const head = pending[0];
      if (head?.result) {
        pending.shift();
        if ("error" in head.result) throw head.result.error;
        yield head.result.value;
        continue;
      }
      pull();
      if (head) await Promise.race(pulling ? [head.promise, pulling] : [head.promise]);
      else if (pulling) await pulling;
      else return;
    }
  } catch (error) {
    fail(error);
    propagated = true;
    throw failure;
  } finally {
    stopped = true;
    // Keep source-owned resources alive until callbacks already using them finish.
    await Promise.all(pending.map((task) => task.promise));
    let closeFailure: unknown, closeFailed = false;
    // Ask the source to close before joining its outstanding pull. Cooperative
    // iterators can use return() to release a blocked next(). Async generators
    // awaiting external I/O still need that I/O to support cancellation.
    let closing: Promise<unknown> = Promise.resolve();
    try {
      if (!exhausted) closing = Promise.resolve(iterator.return?.()).catch((error) => {
        closeFailed = true; closeFailure = error;
      });
    } catch (error) { closeFailed = true; closeFailure = error; }
    await Promise.all([pulling, closing]);
    if (failed && !propagated) throw failure;
    if (!failed && closeFailed) throw closeFailure;
  }
}
