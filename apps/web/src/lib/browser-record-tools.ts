import {
  JsonNumber,
  jsonKind,
  parseExactJson,
  type JsonValue,
} from "./lossless-json";
import { pointerSegments, resolvePointerSegments } from "./json-pointer";
import {
  boundedText,
  compareDecimal,
  decimal,
  exactKey,
  exactOutput,
  featureResult,
  isObject,
  requireChoice,
  workBudget,
  type Budget,
  reportArray,
  reportWriter,
} from "./browser-feature-core";

function required(
  root: JsonValue,
  path: string[],
  tick: Budget,
  context = "Record",
) {
  tick(path.length + 1);
  const result = resolvePointerSegments(root, path);
  if (!result.found)
    throw new Error(
      `${context}: field pointer is missing. Check the pointer or input.`,
    );
  return result.value;
}
function records(source: string) {
  const value = parseExactJson(source);
  if (!Array.isArray(value)) throw new Error("Use a JSON array of records.");
  return value;
}

export function previewJsonPatch(source: string, patchSource: string) {
  let root = parseExactJson(source);
  const operations = parseExactJson(patchSource),
    tick = workBudget();
  if (!Array.isArray(operations) || operations.length > 100)
    throw new Error("Use a JSON Patch array with at most 100 operations.");
  const clone = (value: JsonValue) => parseExactJson(exactOutput(value, tick));
  function edit(
    path: string[],
    mode: "add" | "remove" | "replace",
    value: JsonValue = null,
  ) {
    if (!path.length) {
      if (mode === "remove")
        throw new Error(
          "Removing the root document is not supported: there would be no JSON output. Replace the root instead.",
        );
      root = value;
      return;
    }
    const parent = required(root, path.slice(0, -1), tick, "Parent"),
      key = path.at(-1)!;
    if (Array.isArray(parent)) {
      const append = key === "-" && mode === "add";
      if (!append && !/^(0|[1-9]\d*)$/.test(key))
        throw new Error(
          "Array paths need canonical indices; '-' is allowed only for add.",
        );
      const index = append ? parent.length : Number(key);
      if (
        !Number.isSafeInteger(index) ||
        index > parent.length ||
        (mode !== "add" && index === parent.length)
      )
        throw new Error("Array index is outside the document.");
      tick(parent.length - index + 1);
      if (mode === "add") parent.splice(index, 0, value);
      else if (mode === "remove") parent.splice(index, 1);
      else parent[index] = value;
    } else if (isObject(parent)) {
      if (mode !== "add" && !Object.hasOwn(parent, key))
        throw new Error("Target field does not exist.");
      if (mode === "remove") delete parent[key];
      else parent[key] = value;
    } else
      throw new Error("The parent path must reference an object or array.");
  }
  operations.forEach((operation, index) => {
    try {
      if (
        !isObject(operation) ||
        typeof operation.op !== "string" ||
        typeof operation.path !== "string"
      )
        throw new Error("Each operation needs string op and path fields.");
      const op = requireChoice(
        operation.op,
        ["add", "remove", "replace", "test", "copy", "move"],
        "patch operation",
      );
      const path = pointerSegments(operation.path);
      if (op === "add" || op === "replace" || op === "test") {
        if (!Object.hasOwn(operation, "value"))
          throw new Error("This operation requires a value field.");
        if (op === "test") {
          if (
            exactKey(required(root, path, tick), tick) !==
            exactKey(operation.value, tick)
          )
            throw new Error("Test failed. No output was produced.");
        } else edit(path, op, clone(operation.value));
      } else if (op === "remove") edit(path, "remove");
      else {
        if (typeof operation.from !== "string")
          throw new Error("Copy and move require a string from pointer.");
        const from = pointerSegments(operation.from),
          value = required(root, from, tick, "Source");
        const same =
          from.length === path.length && from.every((v, i) => v === path[i]);
        if (op === "move" && same) return;
        if (
          op === "move" &&
          path.length > from.length &&
          from.every((v, i) => v === path[i])
        )
          throw new Error("Cannot move a value into one of its descendants.");
        const copied = clone(value);
        if (op === "move") edit(from, "remove");
        edit(path, "add", copied);
      }
      // Bound every intermediate tree: repeated copies cannot grow without limit.
      exactOutput(root, tick);
    } catch (error) {
      throw new Error(
        `Operation ${index + 1}: ${error instanceof Error ? error.message : "Invalid patch"}`,
      );
    }
  });
  return featureResult(
    exactOutput(root, tick),
    "patched.json",
    `${operations.length} operations applied to the preview. Source unchanged.`,
  );
}

export function runRecordTool(
  id: string,
  input: string,
  secondary: string,
  options: Record<string, string>,
) {
  boundedText(input);
  boundedText(secondary, "Configuration");
  if (id === "record-patch") return previewJsonPatch(input, secondary);
  const source = records(input),
    tick = workBudget();
  let output: JsonValue;
  let summary = "";
  if (id === "record-project") {
    const mapping = parseExactJson(secondary);
    if (
      !isObject(mapping) ||
      !Object.keys(mapping).length ||
      Object.keys(mapping).length > 30
    )
      throw new Error(
        "Map 1–30 output names to JSON Pointer strings in an object.",
      );
    const fields = Object.entries(mapping).map(([name, pointer]) => {
      if (!name || typeof pointer !== "string")
        throw new Error(
          "Output names must be nonempty and pointer values must be strings.",
        );
      return { name, path: pointerSegments(pointer) };
    });
    requireChoice(
      options.missing,
      ["error", "null", "omit"],
      "missing-field policy",
    );
    let projectedValues = source.length + 1;
    output = source.map((record, i) => {
      const result: Record<string, JsonValue> = Object.create(null);
      for (const field of fields) {
        tick(field.path.length + 1);
        const found = resolvePointerSegments(record, field.path);
        if (found.found || options.missing === "null") {
          if (++projectedValues > 10000)
            throw new Error(
              "Projection would exceed 10,000 output values. Select fewer records or fields.",
            );
          result[field.name] = found.found ? found.value : null;
        } else if (options.missing === "error")
          throw new Error(`Record ${i + 1}: missing field for ${field.name}.`);
      }
      return result;
    });
    summary = `${source.length} records projected into ${fields.length} named fields.`;
  } else if (id === "record-dedupe") {
    requireChoice(options.keep, ["first", "last"], "survivor policy");
    const path = pointerSegments(options.pointer ?? ""),
      selected = new Map<string, number>();
    source.forEach((record, index) => {
      tick(path.length + 1);
      const found = resolvePointerSegments(record, path);
      const key = found.found
        ? "value:" + exactKey(found.value, tick)
        : "missing";
      if (options.keep === "last" || !selected.has(key))
        selected.set(key, index);
    });
    const indices = new Set(selected.values());
    output = source.filter((_, index) => indices.has(index));
    summary = `${source.length - output.length} duplicates removed; ${output.length} survivors retain source order and numeric literals.`;
  } else if (id === "record-group") {
    const path = pointerSegments(options.pointer ?? ""),
      groups = new Map<string, { key: JsonValue; records: JsonValue[] }>();
    source.forEach((record, index) => {
      const key = required(record, path, tick, `Record ${index + 1}`);
      if (Array.isArray(key) || isObject(key))
        throw new Error(`Record ${index + 1}: choose a scalar grouping field.`);
      const identity = exactKey(key, tick),
        group = groups.get(identity) ?? { key, records: [] };
      group.records.push(record);
      groups.set(identity, group);
    });
    output = [...groups.values()];
    summary = `${source.length} records in ${groups.size} groups. First-seen key literals and group order are preserved.`;
  } else if (id === "record-sort") {
    requireChoice(options.direction, ["asc", "desc"], "sort direction");
    const path = pointerSegments(options.pointer ?? "");
    const rows = source.map((record, index) => {
      const value = required(record, path, tick, `Record ${index + 1}`),
        kind = jsonKind(value);
      if (!["null", "boolean", "number", "string"].includes(kind))
        throw new Error("Sort keys must be scalar values.");
      return {
        record,
        value,
        kind,
        index,
        number: value instanceof JsonNumber ? decimal(value.raw) : null,
      };
    });
    const order = ["null", "boolean", "number", "string"];
    rows.sort((a, b) => {
      tick();
      let result = order.indexOf(a.kind) - order.indexOf(b.kind);
      if (!result)
        result =
          a.number && b.number
            ? compareDecimal(a.number, b.number)
            : a.value === b.value
              ? 0
              : a.value! < b.value!
                ? -1
                : 1;
      return (
        (options.direction === "desc" ? -result : result) || a.index - b.index
      );
    });
    output = rows.map((row) => row.record);
    summary = `${source.length} records sorted. Equal keys keep source order; numbers are compared without rounding.`;
  } else if (id === "record-index") {
    const path = pointerSegments(options.pointer ?? ""),
      index: Record<string, JsonValue> = Object.create(null);
    source.forEach((record, i) => {
      const key = required(record, path, tick, `Record ${i + 1}`);
      if (typeof key !== "string")
        throw new Error(`Record ${i + 1}: index keys must be strings.`);
      if (Object.hasOwn(index, key))
        throw new Error(
          `Record ${i + 1}: duplicate index key ${key.slice(0, 100)}.`,
        );
      index[key] = record;
    });
    output = index;
    summary = `${source.length} records indexed by unique string keys.`;
  } else if (id === "record-audit") {
    const rules = parseExactJson(secondary);
    if (!Array.isArray(rules) || !rules.length || rules.length > 30)
      throw new Error(
        "Provide 1–30 rules with pointer, type and optional required fields.",
      );
    const compiled = rules.map((rule, i) => {
      if (
        !isObject(rule) ||
        typeof rule.pointer !== "string" ||
        typeof rule.type !== "string" ||
        (Object.hasOwn(rule, "required") && typeof rule.required !== "boolean")
      )
        throw new Error(
          `Rule ${i + 1}: use string pointer/type and boolean required.`,
        );
      requireChoice(
        rule.type,
        ["null", "boolean", "number", "string", "array", "object"],
        "JSON type",
      );
      return {
        pointer: rule.pointer,
        path: pointerSegments(rule.pointer),
        type: rule.type,
        required: rule.required !== false,
      };
    });
    const findings: string[][] = [],
      entries = reportArray();
    let total = 0;
    source.forEach((record, index) => {
      for (const rule of compiled) {
        tick(rule.path.length + 1);
        const result = resolvePointerSegments(record, rule.path);
        const actual = result.found ? jsonKind(result.value) : "missing";
        if (result.found ? actual !== rule.type : rule.required) {
          total++;
          if (findings.length < 1000) {
            entries.push({
              record: index + 1,
              pointer: rule.pointer || "(root)",
              expected: rule.type,
              actual,
            });
            findings.push([
              String(index + 1),
              rule.pointer || "(root)",
              rule.type,
              actual,
            ]);
          }
        }
      }
    });
    const report = {
      records: source.length,
      rules: rules.length,
      totalFindings: total,
      reportedFindings: findings.length,
      complete: total === findings.length,
    };
    const writer = reportWriter();
    writer.raw('{"records":');
    writer.json(report.records);
    writer.raw(',"rules":');
    writer.json(report.rules);
    writer.raw(',"totalFindings":');
    writer.json(report.totalFindings);
    writer.raw(',"reportedFindings":');
    writer.json(report.reportedFindings);
    writer.raw(',"complete":');
    writer.json(report.complete);
    writer.raw(',"findings":');
    writer.raw(entries.finish());
    writer.raw("}");
    return featureResult(
      writer.finish(),
      "record-audit.json",
      `${total} findings across ${source.length} records. ${total > 1000 ? "First 1,000 findings reported; narrow the input for the rest." : "All findings included."}`,
      { columns: ["Record", "Pointer", "Expected", "Actual"], rows: findings },
    );
  } else throw new Error("Choose a record preparation task.");
  return featureResult(exactOutput(output, tick), id + ".json", summary);
}
