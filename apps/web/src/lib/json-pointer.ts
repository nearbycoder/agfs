import { type JsonValue, JsonNumber } from "./lossless-json";
export function pointerSegments(pointer: string) {
  if (pointer.length > 4096)
    throw new Error("JSON Pointer exceeds 4,096 characters.");
  if (pointer === "") return [];
  if (!pointer.startsWith("/"))
    throw new Error("Use an empty pointer for root, or start with /.");
  return pointer
    .slice(1)
    .split("/")
    .map((part) => {
      if (/~(?![01])/g.test(part))
        throw new Error("Only ~0 and ~1 are valid pointer escapes.");
      return part.replaceAll("~1", "/").replaceAll("~0", "~");
    });
}
export function resolvePointer(
  root: JsonValue,
  pointer: string,
): { found: true; value: JsonValue } | { found: false } {
  let current = root;
  for (const segment of pointerSegments(pointer)) {
    if (
      current === null ||
      typeof current !== "object" ||
      current instanceof JsonNumber
    )
      return { found: false };
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(segment) || !Object.hasOwn(current, segment))
        return { found: false };
      current = current[Number(segment)];
    } else {
      if (!Object.hasOwn(current, segment)) return { found: false };
      current = current[segment];
    }
  }
  return { found: true, value: current };
}
export function pointerEscape(key: string) {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}
