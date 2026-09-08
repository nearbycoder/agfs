import {
  type JsonValue,
  JsonNumber,
  stringifyExactJson,
} from "./lossless-json";
import { exportCsv } from "./csv-download";
export function jsonToCsv(value: JsonValue, delimiter = ",") {
  if (!Array.isArray(value) || value.length > 5000)
    throw new Error("Choose a JSON array with at most 5,000 objects.");
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const record of value) {
    if (
      record === null ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      record instanceof JsonNumber
    )
      throw new Error("Every array item must be an object.");
    for (const key of Object.keys(record))
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
        if (headers.length > 200)
          throw new Error(
            "JSON conversion supports at most 200 distinct columns.",
          );
      }
  }
  if (!headers.length)
    throw new Error("No object fields are available to export.");
  let cells = 0;
  const rows = value.map((record) =>
    headers.map((key) => {
      const v = (record as { [key: string]: JsonValue })[key];
      const text =
        v === undefined
          ? ""
          : typeof v === "string"
            ? v
            : stringifyExactJson(v);
      cells += new TextEncoder().encode(text).length + 3;
      if (cells > 1048576) throw new Error("CSV output exceeds 1 MiB.");
      return text;
    }),
  );
  return {
    text: exportCsv([headers, ...rows], delimiter),
    rows: rows.length,
    headers,
  };
}
