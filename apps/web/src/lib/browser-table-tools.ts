import { parseCsv } from "./csv-inspector";
import { exportCsv } from "./csv-download";
import { parseExactJson } from "./lossless-json";
import {
  boundedText,
  compareDecimal,
  decimal,
  featureResult,
  isObject,
  requireChoice,
  workBudget,
  FEATURE_BYTES,
  type Decimal,
  reportWriter,
} from "./browser-feature-core";

function table(source: string, delimiter: string) {
  boundedText(source);
  const rows = parseCsv(source, delimiter);
  if (
    !rows.length ||
    rows[0].some((h) => !h.trim()) ||
    new Set(rows[0]).size !== rows[0].length
  )
    throw new Error("Use a header row with nonempty, unique column names.");
  if (rows.some((r) => r.length !== rows[0].length))
    throw new Error(
      "Every row must have the same number of columns as the header.",
    );
  return { headers: rows[0], rows: rows.slice(1) };
}
function columns(source: string, headers: string[], allowEmpty = false) {
  const names = source === "" ? [] : source.split(/\r\n|\r|\n/);
  if (
    (!names.length && !allowEmpty) ||
    names.length > 200 ||
    new Set(names).size !== names.length
  )
    throw new Error("Choose distinct column names, one per line.");
  return names.map((name) => {
    const index = headers.indexOf(name);
    if (index < 0)
      throw new Error(
        `Unknown column: ${name.slice(0, 100)}. Column names are case-sensitive.`,
      );
    return index;
  });
}
/** Check the protected CSV's byte count before handing each row to the writer. */
function exportTable(rows: Iterable<string[]>, delimiter: string) {
  const encoder = new TextEncoder();
  function* bounded() {
    let bytes = 3,
      count = 0;
    for (const row of rows) {
      if (++count > 5000)
        throw new Error(
          "Output exceeds 5,000 rows including the header. Use fewer records or measures.",
        );
      if (row.length > 200) throw new Error("Output exceeds 200 columns.");
      bytes += Math.max(0, row.length - 1) + 2;
      for (const cell of row) {
        bytes +=
          encoder.encode(cell).length +
          2 +
          (cell.match(/"/g)?.length ?? 0) +
          (/^[\s]*[=+@-]/.test(cell) ? 1 : 0);
        if (bytes > FEATURE_BYTES)
          throw new Error(
            "CSV output exceeds 256 KiB. Use fewer rows or columns.",
          );
      }
      yield row;
    }
  }
  return exportCsv(bounded(), delimiter);
}
type Sum = { value: bigint; scale: number };
function add(sum: Sum, value: Decimal): Sum {
  if (value.scale < -1000n || value.scale > 1000n)
    throw new Error(
      "Summation supports decimal exponents from -1,000 to 1,000 after normalization.",
    );
  if (!value.sign) return sum;
  const scale = Math.min(sum.scale, Number(value.scale));
  const leftShift = sum.scale - scale,
    rightShift = Number(value.scale) - scale;
  if (
    leftShift + sum.value.toString().length > 2048 ||
    rightShift + value.digits.length > 2048
  )
    throw new Error(
      "Exact sum exceeds the 2,048-digit working limit. Use a narrower numeric range.",
    );
  const total =
    sum.value * 10n ** BigInt(leftShift) +
    BigInt(value.sign) * BigInt(value.digits) * 10n ** BigInt(rightShift);
  if (total.toString().length > 2048)
    throw new Error("Exact sum exceeds 2,048 digits.");
  return { value: total, scale };
}
function sumText(sum: Sum) {
  const negative = sum.value < 0,
    raw = (negative ? -sum.value : sum.value).toString();
  if (sum.value === 0n) return "0";
  const digits = sum.scale < 0 ? raw.padStart(-sum.scale + 1, "0") : raw;
  const point = digits.length + sum.scale;
  const result =
    sum.scale >= 0
      ? digits + "0".repeat(sum.scale)
      : (digits.slice(0, point) + "." + digits.slice(point))
          .replace(/0+$/, "")
          .replace(/\.$/, "");
  return (negative ? "-" : "") + result;
}

export function runTableTool(
  id: string,
  input: string,
  secondary: string,
  options: Record<string, string>,
) {
  boundedText(secondary, "Additional input");
  const delimiter = options.delimiter ?? ",",
    source = table(input, delimiter),
    tick = workBudget();
  let rows: Iterable<string[]> = [],
    summary = "";
  if (id === "table-sort") {
    const [column] = columns(options.column ?? "", source.headers);
    requireChoice(options.type, ["text", "number"], "sort type");
    requireChoice(options.direction, ["asc", "desc"], "sort direction");
    const ordered = source.rows.map((row, index) => ({
      row,
      index,
      number: options.type === "number" ? decimal(row[column]) : null,
    }));
    ordered.sort((a, b) => {
      tick();
      const comparison =
        a.number && b.number
          ? compareDecimal(a.number, b.number)
          : a.row[column] === b.row[column]
            ? 0
            : a.row[column] < b.row[column]
              ? -1
              : 1;
      return (
        (options.direction === "desc" ? -comparison : comparison) ||
        a.index - b.index
      );
    });
    rows = [source.headers, ...ordered.map((r) => r.row)];
    summary = `${source.rows.length} rows sorted; equal keys keep source order.`;
  } else if (id === "table-dedupe") {
    const keys = columns(options.columns ?? "", source.headers);
    requireChoice(options.keep, ["first", "last"], "survivor policy");
    const selected = new Map<string, number>();
    source.rows.forEach((row, index) => {
      tick(keys.length);
      const key = JSON.stringify(keys.map((i) => row[i]));
      if (options.keep === "last" || !selected.has(key))
        selected.set(key, index);
    });
    const indices = new Set(selected.values());
    rows = [source.headers, ...source.rows.filter((_, i) => indices.has(i))];
    summary = `${source.rows.length - indices.size} duplicate rows removed; ${indices.size} survivors remain in source order.`;
  } else if (id === "table-group") {
    const keys = columns(options.columns ?? "", source.headers, true);
    const sumColumn = options.sum
      ? columns(options.sum, source.headers)[0]
      : -1;
    const headers = keys
      .map((i) => source.headers[i])
      .concat(
        "row_count",
        ...(sumColumn >= 0 ? ["sum:" + source.headers[sumColumn]] : []),
      );
    if (new Set(headers).size !== headers.length)
      throw new Error(
        "A grouping column conflicts with row_count or the generated sum header. Rename it first.",
      );
    const groups = new Map<
      string,
      { key: string[]; count: number; sum: Sum }
    >();
    for (const row of source.rows) {
      tick(keys.length + 1);
      const key = keys.map((i) => row[i]),
        identity = JSON.stringify(key),
        group = groups.get(identity) ?? {
          key,
          count: 0,
          sum: { value: 0n, scale: 0 },
        };
      group.count++;
      if (sumColumn >= 0) group.sum = add(group.sum, decimal(row[sumColumn]));
      groups.set(identity, group);
    }
    rows = (function* () {
      yield headers;
      for (const group of groups.values())
        yield [
          ...group.key,
          String(group.count),
          ...(sumColumn >= 0 ? [sumText(group.sum)] : []),
        ];
    })();
    summary = `${source.rows.length} rows summarized into ${groups.size} groups${sumColumn >= 0 ? " with exact decimal sums" : ""}.`;
  } else if (id === "table-unpivot") {
    const identities = columns(options.columns ?? "", source.headers, true),
      measures = columns(options.measures ?? "", source.headers);
    if (measures.some((m) => identities.includes(m)))
      throw new Error("Identity and measure columns must be disjoint.");
    const headers = identities
      .map((i) => source.headers[i])
      .concat("field", "value");
    if (new Set(headers).size !== headers.length)
      throw new Error(
        "Identity columns cannot be named field or value. Rename them first.",
      );
    if (source.rows.length * measures.length + 1 > 5000)
      throw new Error(
        "Reshaping would exceed 5,000 rows. Select fewer rows or measures.",
      );
    rows = (function* () {
      yield headers;
      for (const row of source.rows)
        for (const measure of measures) {
          tick(identities.length + 1);
          yield [
            ...identities.map((i) => row[i]),
            source.headers[measure],
            row[measure],
          ];
        }
    })();
    summary = `${source.rows.length} wide rows become ${source.rows.length * measures.length} field/value rows.`;
  } else if (id === "table-append") {
    const additional = table(secondary, delimiter);
    requireChoice(options.mode, ["strict", "union"], "schema policy");
    if (source.rows.length + additional.rows.length + 1 > 5000)
      throw new Error(
        "Combined table exceeds 5,000 rows including the header.",
      );
    const headers = [...source.headers];
    for (const header of additional.headers)
      if (!headers.includes(header)) headers.push(header);
    if (
      options.mode === "strict" &&
      (headers.length !== source.headers.length ||
        headers.length !== additional.headers.length)
    )
      throw new Error(
        "Strict append requires the same header names in both tables; their order may differ.",
      );
    if (headers.length > 200)
      throw new Error("Combined schema exceeds 200 columns.");
    rows = (function* () {
      yield headers;
      for (const data of [source, additional]) {
        const indices = headers.map((h) => data.headers.indexOf(h));
        for (const row of data.rows) {
          tick(indices.length);
          yield indices.map((i) => (i < 0 ? "" : row[i]));
        }
      }
    })();
    summary = `${source.rows.length + additional.rows.length} rows aligned by header name. Missing union columns become empty cells.`;
  } else if (id === "table-rename") {
    const mapping = parseExactJson(secondary);
    if (
      !isObject(mapping) ||
      !Object.keys(mapping).length ||
      Object.keys(mapping).length > 200
    )
      throw new Error(
        "Provide an object mapping 1–200 existing headers to new names.",
      );
    for (const [name, next] of Object.entries(mapping)) {
      if (!source.headers.includes(name))
        throw new Error(`Unknown header: ${name.slice(0, 100)}.`);
      if (typeof next !== "string" || !next.trim())
        throw new Error("New header names must be nonempty strings.");
    }
    const headers = source.headers.map((name) =>
      Object.hasOwn(mapping, name) ? (mapping[name] as string) : name,
    );
    if (new Set(headers).size !== headers.length)
      throw new Error(
        "The mapping creates duplicate headers. Choose distinct destinations.",
      );
    rows = [headers, ...source.rows];
    summary = `${Object.keys(mapping).length} headers renamed. Row values are unchanged before CSV formula protection.`;
  } else if (id === "table-reconcile") {
    const after = table(secondary, delimiter),
      [leftKey] = columns(options.column ?? "", source.headers),
      [rightKey] = columns(options.column ?? "", after.headers);
    if (
      source.headers.length !== after.headers.length ||
      source.headers.some((h) => !after.headers.includes(h))
    )
      throw new Error(
        "Reconciliation requires matching header names; order may differ. Align schemas first.",
      );
    const reorder = source.headers.map((h) => after.headers.indexOf(h));
    const index = (data: typeof source, key: number) => {
      const result = new Map<string, { row: string[]; line: number }>();
      data.rows.forEach((row, i) => {
        if (!row[key] || result.has(row[key]))
          throw new Error(
            `Row ${i + 2}: reconciliation keys must be nonempty and unique in each input.`,
          );
        result.set(row[key], { row, line: i + 2 });
      });
      return result;
    };
    const beforeIndex = index(source, leftKey),
      afterIndex = index(after, rightKey);
    const review: string[][] = [],
      writer = reportWriter();
    writer.raw('{"columns":');
    writer.json(source.headers);
    writer.raw(',"changes":[');
    let added = 0,
      removed = 0,
      changed = 0;
    for (const key of new Set([...beforeIndex.keys(), ...afterIndex.keys()])) {
      tick(source.headers.length);
      const before = beforeIndex.get(key),
        next = afterIndex.get(key),
        nextRow = next ? reorder.map((i) => next.row[i]) : null;
      const different = source.headers.filter(
        (_, i) => !before || !nextRow || before.row[i] !== nextRow[i],
      );
      if (!different.length) continue;
      const status = !before ? "added" : !next ? "removed" : "changed";
      if (status === "added") added++;
      else if (status === "removed") removed++;
      else changed++;
      if (review.length) writer.raw(",");
      writer.json({
        key,
        status,
        beforeRow: before?.line ?? null,
        afterRow: next?.line ?? null,
        before: before?.row ?? null,
        after: nextRow,
        changedColumns: different,
      });
      review.push([
        key,
        status,
        before ? String(before.line) : "—",
        next ? String(next.line) : "—",
        different.join(", "),
      ]);
    }
    writer.raw("]}");
    return featureResult(
      writer.finish(),
      "table-reconciliation.json",
      `${added} added · ${removed} removed · ${changed} changed. Row numbers count parsed records, including the header.`,
      {
        columns: [
          "Key",
          "Change",
          "Before row",
          "After row",
          "Changed columns",
        ],
        rows: review,
      },
    );
  } else throw new Error("Choose a table preparation task.");
  return featureResult(
    exportTable(rows, delimiter),
    id + ".csv",
    summary + " CSV export protects spreadsheet formulas.",
  );
}
