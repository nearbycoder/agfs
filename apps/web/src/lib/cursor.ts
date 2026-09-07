import { errorResponse } from "./http";
export function encodeCursor(value: unknown) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value))));
}
export function decodeCursor<T>(
  value: string | undefined,
  valid: (v: any) => boolean,
): T | undefined {
  if (!value) return undefined;
  try {
    if (value.length > 4096) throw new Error();
    const v = JSON.parse(decodeURIComponent(escape(atob(value))));
    if (!valid(v)) throw new Error();
    return v;
  } catch {
    throw errorResponse(400, "Invalid pagination cursor");
  }
}
export function timeCursor(value?: string) {
  return decodeCursor<{ at: number; id: string }>(
    value,
    (v) =>
      v &&
      Number.isSafeInteger(v.at) &&
      typeof v.id === "string" &&
      v.id.length < 128,
  );
}
export function page<T extends Record<string, any>>(items: T[], limit = 50) {
  const results = items.slice(0, limit),
    last = results.at(-1);
  return {
    results,
    nextCursor:
      items.length > limit && last
        ? encodeCursor({ at: last.created_at, id: last.id })
        : null,
  };
}
