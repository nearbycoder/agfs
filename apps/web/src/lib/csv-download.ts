export function exportCsv(rows: Iterable<string[]>, delimiter = ",") {
  if (![",", ";", "\t"].includes(delimiter))
    throw new Error("Unsupported delimiter.");
  let output = "\ufeff";
  let bytes = 3;
  const encoder = new TextEncoder();
  let count = 0;
  for (const row of rows) {
    if (++count > 5001)
      throw new Error(
        "CSV export supports at most 5,001 rows including headers.",
      );
    if (row.length > 200)
      throw new Error("CSV export supports at most 200 columns.");
    const line =
      row
        .map((value) => {
          const safe = /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
          return '"' + safe.replaceAll('"', '""') + '"';
        })
        .join(delimiter) + "\r\n";
    bytes += encoder.encode(line).length;
    if (bytes > 1048576)
      throw new Error("CSV export exceeds 1 MiB. Narrow the selection.");
    output += line;
  }
  return output;
}
