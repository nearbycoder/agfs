import {
  JsonNumber,
  jsonKind,
  parseExactJson,
  stringifyExactJson,
  type JsonValue,
} from "./lossless-json";
import { pointerEscape, pointerSegments, resolvePointer } from "./json-pointer";

const object = (v: JsonValue): v is { [key: string]: JsonValue } =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  !(v instanceof JsonNumber);

/** RFC 7396: objects merge recursively; null deletes; other values replace. */
export function mergePatch(target: JsonValue, patch: JsonValue): JsonValue {
  if (!object(patch)) return patch;
  const output: { [key: string]: JsonValue } = Object.assign(
    Object.create(null),
    object(target) ? target : {},
  );
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete output[key];
    else output[key] = mergePatch(output[key] ?? null, value);
  }
  return output;
}

export function redactJson(source: string, pointers: string[]) {
  let root = parseExactJson(source);
  if (!pointers.length || pointers.length > 100)
    throw new Error("Provide 1–100 JSON Pointers, one per line.");
  // Validate every pointer before producing any output. Missing paths are errors.
  for (const pointer of pointers)
    if (!resolvePointer(root, pointer).found)
      throw new Error("Missing redaction path: " + pointer);
  // Children first so a parent redaction doesn't invalidate a selected child.
  for (const pointer of [...new Set(pointers)].sort(
    (a, b) => pointerSegments(b).length - pointerSegments(a).length,
  )) {
    const segments = pointerSegments(pointer);
    if (!segments.length) {
      root = "[REDACTED]";
      continue;
    }
    const parent = resolvePointer(
      root,
      "/" + segments.slice(0, -1).map(pointerEscape).join("/"),
    );
    const container =
      segments.length === 1 ? root : parent.found ? parent.value : null;
    if (Array.isArray(container))
      container[Number(segments.at(-1))] = "[REDACTED]";
    else if (container && object(container))
      container[segments.at(-1)!] = "[REDACTED]";
  }
  return stringifyExactJson(root);
}

export function jsonShape(source: string) {
  const root = parseExactJson(source),
    counts = new Map<string, { types: Set<string>; occurrences: number }>();
  function visit(value: JsonValue, path: string) {
    const info = counts.get(path) ?? {
      types: new Set<string>(),
      occurrences: 0,
    };
    info.types.add(jsonKind(value));
    info.occurrences++;
    counts.set(path, info);
    if (Array.isArray(value))
      for (const item of value) visit(item, path + "/*");
    else if (object(value))
      for (const [key, item] of Object.entries(value))
        visit(item, path + "/" + pointerEscape(key));
  }
  visit(root, "");
  return [...counts].map(([path, v]) => ({
    path,
    types: [...v.types].sort(),
    occurrences: v.occurrences,
  }));
}

export function selectJsonRecords(
  source: string,
  pointer: string,
  expected: string,
  mode: string,
) {
  const root = parseExactJson(source);
  if (!Array.isArray(root)) throw new Error("Input must be a JSON array.");
  pointerSegments(pointer);
  if (!["equals", "contains", "exists", "missing"].includes(mode))
    throw new Error("Unsupported record filter.");
  const expectedValue =
    mode === "equals" ? stringifyExactJson(parseExactJson(expected)) : expected;
  return root.filter((record) => {
    const result = resolvePointer(record, pointer);
    if (mode === "exists") return result.found;
    if (mode === "missing") return !result.found;
    if (!result.found) return false;
    return mode === "equals"
      ? stringifyExactJson(result.value) === expectedValue
      : (typeof result.value === "string"
          ? result.value
          : stringifyExactJson(result.value)
        ).includes(expectedValue);
  });
}

export function arrayToJsonl(source: string) {
  const value = parseExactJson(source);
  if (!Array.isArray(value)) throw new Error("Input must be a JSON array.");
  return value.map(stringifyExactJson).join("\n") + (value.length ? "\n" : "");
}
export function jsonlToArray(source: string) {
  if (new TextEncoder().encode(source).length > 262144)
    throw new Error("Input exceeds 256 KiB.");
  const lines = source.split(/\r\n|\n|\r/);
  if (lines.length > 5001)
    throw new Error("JSONL supports at most 5,000 lines.");
  const records: JsonValue[] = [];
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    try {
      records.push(parseExactJson(line));
    } catch (e) {
      throw new Error(
        `Line ${index + 1}: ${e instanceof Error ? e.message : "Invalid JSON"}`,
      );
    }
  });
  // Enforce the aggregate depth/value limits, too.
  return stringifyExactJson(parseExactJson(stringifyExactJson(records)));
}
