/** Merge progress patches by key; retain at most one patch per active item. */
export function createFrameBatch<K, V extends object>(
  apply: (patches: ReadonlyMap<K, Partial<V>>) => void,
  request: (callback: () => void) => number = requestAnimationFrame,
  cancel: (handle: number) => void = cancelAnimationFrame,
) {
  let handle: number | undefined;
  let pending = new Map<K, Partial<V>>();
  let disposed = false;
  function flush() {
    if (handle !== undefined) cancel(handle);
    handle = undefined;
    if (!pending.size || disposed) return;
    const patches = pending;
    pending = new Map();
    apply(patches);
  }
  return {
    push(key: K, patch: Partial<V>) {
      if (disposed) return;
      pending.set(key, { ...pending.get(key), ...patch });
      if (handle === undefined) handle = request(flush);
    },
    flush,
    dispose() {
      disposed = true;
      if (handle !== undefined) cancel(handle);
      handle = undefined;
      pending.clear();
    },
  };
}
