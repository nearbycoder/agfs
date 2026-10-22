import { JsonNumber, type JsonValue } from "./lossless-json";

export const FEATURE_BYTES = 262144;
const encoder = new TextEncoder();
export function boundedText(text: string, label = "Input") {
  if (
    text.length > FEATURE_BYTES ||
    encoder.encode(text).length > FEATURE_BYTES
  )
    throw new Error(`${label} exceeds 256 KiB. Use a smaller selection.`);
  return text;
}
export function workBudget(limit = 500000) {
  let remaining = limit;
  return (amount = 1) => {
    remaining -= amount;
    if (remaining < 0)
      throw new Error(
        "Preview work limit reached. Use fewer records, rules, or operations.",
      );
  };
}
export type Budget = ReturnType<typeof workBudget>;

/** Count JSON string escapes and UTF-8 without first allocating the escaped string. */
export function jsonStringBytes(text: string) {
  let bytes = 2;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      code === 34 ||
      code === 92 ||
      code === 8 ||
      code === 9 ||
      code === 10 ||
      code === 12 ||
      code === 13
    )
      bytes += 2;
    else if (code < 32) bytes += 6;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      text.charCodeAt(i + 1) >= 0xdc00 &&
      text.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      i++;
    } else if (code >= 0xd800 && code <= 0xdfff) bytes += 6;
    else bytes += code < 128 ? 1 : code < 2048 ? 2 : 3;
  }
  return bytes;
}
type ReportValue =
  | null
  | boolean
  | number
  | string
  | ReportValue[]
  | { [key: string]: ReportValue };
/** Every fragment is charged before allocation/retention; the final join is <= limit. */
export function reportWriter(limit = FEATURE_BYTES) {
  const chunks: string[] = [];
  let bytes = 0;
  const charge = (amount: number) => {
    if (amount > limit - bytes)
      throw new Error("Output exceeds 256 KiB. Use fewer records or fields.");
    bytes += amount;
  };
  const raw = (text: string) => {
    charge(encoder.encode(text).length);
    chunks.push(text);
  };
  const string = (text: string) => {
    charge(jsonStringBytes(text));
    chunks.push(JSON.stringify(text));
  };
  const json = (value: ReportValue, depth = 0) => {
    if (depth > 40) throw new Error("Report exceeds 40 nesting levels.");
    if (typeof value === "string") string(value);
    else if (Array.isArray(value)) {
      raw("[");
      value.forEach((item, i) => {
        if (i) raw(",");
        json(item, depth + 1);
      });
      raw("]");
    } else if (value !== null && typeof value === "object") {
      raw("{");
      Object.entries(value).forEach(([key, item], i) => {
        if (i) raw(",");
        string(key);
        raw(":");
        json(item, depth + 1);
      });
      raw("}");
    } else raw(JSON.stringify(value));
  };
  return {
    raw,
    string,
    json,
    get bytes() {
      return bytes;
    },
    finish: () => chunks.join(""),
  };
}
export function reportArray() {
  const writer = reportWriter();
  writer.raw("[");
  let count = 0;
  return {
    push(value: ReportValue) {
      if (count) writer.raw(",");
      writer.json(value);
      count++;
    },
    finish() {
      writer.raw("]");
      return writer.finish();
    },
  };
}
export function isObject(value: JsonValue): value is Record<string, JsonValue> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof JsonNumber)
  );
}

/** Exponents are compared, never expanded. Even 1e999999 stays a small token. */
export function decimal(raw: string) {
  if (
    raw.length > 1024 ||
    !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)
  )
    throw new Error(
      "Use decimal numbers with at most 1,024 characters; blanks and non-finite values are not numbers.",
    );
  const negative = raw[0] === "-";
  const [mantissa, exponent = "0"] = (negative ? raw.slice(1) : raw)
    .toLowerCase()
    .split("e");
  const fraction = mantissa.includes(".")
    ? mantissa.length - mantissa.indexOf(".") - 1
    : 0;
  const original = mantissa.replace(".", "").replace(/^0+/, "");
  if (!original) return { sign: 0, digits: "0", scale: 0n };
  const digits = original.replace(/0+$/, "");
  return {
    sign: negative ? -1 : 1,
    digits,
    scale:
      BigInt(exponent) -
      BigInt(fraction) +
      BigInt(original.length - digits.length),
  };
}
export type Decimal = ReturnType<typeof decimal>;
export function compareDecimal(a: Decimal, b: Decimal) {
  if (a.sign !== b.sign) return a.sign - b.sign;
  if (!a.sign) return 0;
  const magnitudeA = a.scale + BigInt(a.digits.length),
    magnitudeB = b.scale + BigInt(b.digits.length);
  if (magnitudeA !== magnitudeB)
    return (magnitudeA < magnitudeB ? -1 : 1) * a.sign;
  const length = Math.max(a.digits.length, b.digits.length);
  const left = a.digits.padEnd(length, "0"),
    right = b.digits.padEnd(length, "0");
  return (left === right ? 0 : left < right ? -1 : 1) * a.sign;
}
function numberKey(raw: string) {
  const d = decimal(raw);
  return d.sign ? `${d.sign < 0 ? "-" : ""}${d.digits}e${d.scale}` : "0";
}

/** Enforces output size, depth and node ceilings while writing, before joining. */
export function exactOutput(
  value: JsonValue,
  tick = workBudget(),
  canonical = false,
) {
  const chunks: string[] = [];
  let bytes = 0,
    nodes = 0;
  const append = (part: string) => {
    bytes += encoder.encode(part).length;
    if (bytes > FEATURE_BYTES)
      throw new Error("Output exceeds 256 KiB. Use fewer records or fields.");
    chunks.push(part);
  };
  const appendString = (text: string) => {
    if (jsonStringBytes(text) > FEATURE_BYTES - bytes)
      throw new Error("Output exceeds 256 KiB. Use fewer records or fields.");
    append(JSON.stringify(text));
  };
  const visit = (item: JsonValue, depth: number) => {
    tick();
    if (++nodes > 10000 || depth > 40)
      throw new Error(
        "Output exceeds 10,000 values or 40 nesting levels. Narrow the preview.",
      );
    if (item instanceof JsonNumber)
      append(canonical ? numberKey(item.raw) : item.raw);
    else if (Array.isArray(item)) {
      append("[");
      item.forEach((child, i) => {
        if (i) append(",");
        visit(child, depth + 1);
      });
      append("]");
    } else if (isObject(item)) {
      append("{");
      const keys = Object.keys(item);
      if (canonical) keys.sort();
      keys.forEach((key, i) => {
        if (i) append(",");
        appendString(key);
        append(":");
        visit(item[key], depth + 1);
      });
      append("}");
    } else if (typeof item === "string") appendString(item);
    else append(JSON.stringify(item));
  };
  visit(value, 0);
  return chunks.join("");
}
export const exactKey = (value: JsonValue, tick?: Budget) =>
  exactOutput(value, tick, true);

export type FeatureResult = {
  output: string;
  filename: string;
  summary: string;
  columns?: string[];
  rows?: string[][];
};
export function featureResult(
  output: string,
  filename: string,
  summary: string,
  review?: { columns: string[]; rows: string[][] },
): FeatureResult {
  boundedText(output, "Output");
  return { output, filename, summary, ...review };
}
export function requireChoice(
  value: string,
  choices: readonly string[],
  label: string,
) {
  if (!choices.includes(value)) throw new Error(`Choose a valid ${label}.`);
  return value;
}
