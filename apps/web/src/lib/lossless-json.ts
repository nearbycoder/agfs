/** Exact number tokens avoid silent rounding while converting or comparing JSON. */
export class JsonNumber {
  constructor(readonly raw: string) {}
}
export type JsonValue =
  | null
  | boolean
  | string
  | JsonNumber
  | JsonValue[]
  | { [key: string]: JsonValue };
export function parseExactJson(source: string): JsonValue {
  if (new TextEncoder().encode(source).length > 262144)
    throw new Error("JSON input exceeds 256 KiB.");
  JSON.parse(source);
  const tokens =
    source.match(
      /"(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/gs,
    ) ?? [];
  let cursor = 0,
    values = 0;
  function parse(depth: number): JsonValue {
    if (depth > 40 || ++values > 10000)
      throw new Error(
        "JSON supports at most 40 nesting levels and 10,000 values.",
      );
    const token = tokens[cursor++];
    if (token === "{") {
      const object: { [key: string]: JsonValue } = Object.create(null);
      if (tokens[cursor] === "}") {
        cursor++;
        return object;
      }
      while (true) {
        const key = JSON.parse(tokens[cursor++]) as string;
        if (Object.hasOwn(object, key))
          throw new Error("Duplicate JSON key: " + key.slice(0, 100));
        cursor++;
        object[key] = parse(depth + 1);
        if (tokens[cursor++] === "}") return object;
      }
    }
    if (token === "[") {
      const array: JsonValue[] = [];
      if (tokens[cursor] === "]") {
        cursor++;
        return array;
      }
      while (true) {
        array.push(parse(depth + 1));
        if (tokens[cursor++] === "]") return array;
      }
    }
    if (token.startsWith('"')) return JSON.parse(token);
    if (token === "null") return null;
    if (token === "true" || token === "false") return token === "true";
    if (token.length > 1024)
      throw new Error("JSON number tokens are limited to 1,024 characters.");
    return new JsonNumber(token);
  }
  return parse(0);
}
export function stringifyExactJson(value: JsonValue): string {
  if (value instanceof JsonNumber) return value.raw;
  if (Array.isArray(value))
    return "[" + value.map(stringifyExactJson).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .map(([key, v]) => JSON.stringify(key) + ":" + stringifyExactJson(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function jsonKind(value: JsonValue) {
  return value === null
    ? "null"
    : value instanceof JsonNumber
      ? "number"
      : Array.isArray(value)
        ? "array"
        : typeof value;
}
