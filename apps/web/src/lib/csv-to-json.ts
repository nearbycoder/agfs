export function csvToJson(rows: string[][]) {
  if (!rows.length) throw new Error("CSV needs a header row.");
  const headers = rows[0].map((h) => h.trim());
  if (!headers.length || headers.length > 200 || headers.some((h) => !h))
    throw new Error("Headers must be nonempty, with at most 200 columns.");
  if (new Set(headers).size !== headers.length)
    throw new Error("Headers must be unique after trimming.");
  if (rows.length > 5000)
    throw new Error("Conversion supports up to 5,000 CSV rows.");
  let bytes = 4;
  const encoder = new TextEncoder();
  const records = rows.slice(1).map((row, i) => {
    if (row.length !== headers.length)
      throw new Error(
        `CSV row ${i + 2} has ${row.length} cells; expected ${headers.length}.`,
      );
    const record = Object.fromEntries(headers.map((h, j) => [h, row[j]]));
    const text = JSON.stringify(record);
    bytes += encoder.encode(text).length + 4;
    if (bytes > 1048576) throw new Error("JSON output exceeds 1 MiB.");
    return text;
  });
  return {
    text: "[\n" + records.map((r) => "  " + r).join(",\n") + "\n]",
    rows: records.length,
    columns: headers.length,
  };
}
