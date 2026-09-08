import { parseExactJson, JsonNumber, type JsonValue } from "./lossless-json";
export function jsonlRecords(text: string) {
  if (new TextEncoder().encode(text).length > 262144)
    throw new Error("JSONL input exceeds 256 KiB.");
  const lines = text.split(/\r?\n/);
  if (lines.length > 5000) throw new Error("JSONL supports up to 5,000 lines.");
  return lines.flatMap((raw, index) => {
    if (!raw.trim()) return [];
    try {
      const value = parseExactJson(raw);
      let level = "unclassified";
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !(value instanceof JsonNumber)
      ) {
        const candidate = value.level ?? value.severity;
        if (typeof candidate === "string")
          level = candidate.trim().toLowerCase().slice(0, 80) || "unclassified";
      }
      return [
        {
          line: index + 1,
          raw,
          level,
          error: "",
          value: value as JsonValue | null,
        },
      ];
    } catch (e) {
      return [
        {
          line: index + 1,
          raw,
          level: "invalid",
          error: e instanceof Error ? e.message : "Invalid JSON",
          value: null,
        },
      ];
    }
  });
}
export function filterJsonl(
  records: ReturnType<typeof jsonlRecords>,
  query: string,
  level: string | null,
) {
  const needle = query.trim().toLowerCase();
  return records.filter(
    (r) =>
      (level === null || r.level === level) &&
      r.raw.toLowerCase().includes(needle),
  );
}
