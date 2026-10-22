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
  let cursor = 0,
    values = 0;
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  function whitespace() {
    while (cursor < source.length && /[ \t\r\n]/.test(source[cursor])) cursor++;
  }
  function invalid(): never {
    throw new Error("Invalid JSON at position " + cursor);
  }
  function string(): string {
    const start = cursor++;
    while (cursor < source.length) {
      const c = source[cursor++];
      if (c === '"') return JSON.parse(source.slice(start, cursor));
      if (c === "\\") cursor++;
    }
    return invalid();
  }
  function parse(depth: number): JsonValue {
    if (depth > 40 || ++values > 10000)
      throw new Error(
        "JSON supports at most 40 nesting levels and 10,000 values.",
      );
    whitespace();
    const token = source[cursor];
    if (token === "{") {
      cursor++;
      const object: { [key: string]: JsonValue } = Object.create(null);
      whitespace();
      if (source[cursor] === "}") {
        cursor++;
        return object;
      }
      while (true) {
        whitespace();
        if (source[cursor] !== '"') return invalid();
        const key = string();
        if (Object.hasOwn(object, key))
          throw new Error("Duplicate JSON key: " + key.slice(0, 100));
        whitespace();
        if (source[cursor++] !== ":") return invalid();
        object[key] = parse(depth + 1);
        whitespace();
        const delimiter = source[cursor++];
        if (delimiter === "}") return object;
        if (delimiter !== ",") return invalid();
      }
    }
    if (token === "[") {
      cursor++;
      const array: JsonValue[] = [];
      whitespace();
      if (source[cursor] === "]") {
        cursor++;
        return array;
      }
      while (true) {
        array.push(parse(depth + 1));
        whitespace();
        const delimiter = source[cursor++];
        if (delimiter === "]") return array;
        if (delimiter !== ",") return invalid();
      }
    }
    if (token === '"') return string();
    for (const literal of ["null", "true", "false"])
      if (source.startsWith(literal, cursor)) {
        cursor += literal.length;
        return literal === "null" ? null : literal === "true";
      }
    number.lastIndex = cursor;
    const match = number.exec(source);
    if (!match) return invalid();
    const raw = match[0];
    if (raw.length > 1024)
      throw new Error("JSON number tokens are limited to 1,024 characters.");
    cursor = number.lastIndex;
    return new JsonNumber(raw);
  }
  const result = parse(0);
  whitespace();
  if (cursor !== source.length) return invalid();
  return result;
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
